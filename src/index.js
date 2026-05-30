/**
 * uservoice-user-search
 *
 * Reliable multi-strategy user lookup for the UserVoice API, plus full
 * supporter and account resolution for suggestions.
 *
 * @example
 * ```js
 * import { UserVoiceSearch } from 'uservoice-user-search';
 *
 * const search = new UserVoiceSearch({
 *   subdomain: 'mycompany',
 *   token: process.env.UV_TOKEN,
 *   debug: true,
 * });
 *
 * // User search
 * const user  = await search.findByEmail('alice@example.com');
 * const users = await search.findByName('Alice Smith');
 * const any   = await search.find('alice@example.com');
 *
 * // Suggestion supporters with full account / custom-field data
 * const rows = await search.getSuggestionSupporterDetails(suggestionId);
 * // rows[0].account.customFields → { ARR: 50000, Plan: 'Enterprise', ... }
 * ```
 */

import { Client } from './client.js';
import { createLogger } from './logger.js';
import { EMAIL_STRATEGIES } from './strategies/email.js';
import { NAME_STRATEGIES } from './strategies/name.js';
import { fetchSuggestionSupporters } from './supporters.js';
import { fetchAccount, fetchAccounts, mergeAccountsIntoSupporters } from './accounts.js';
import { UserVoiceApiError, UserVoiceRateLimitError, UserVoiceConfigError } from './errors.js';

// Simple RFC-5322-ish email detection — good enough for routing decisions.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class UserVoiceSearch {
  /**
   * @param {object}   config
   * @param {string}   config.subdomain        Your UserVoice subdomain (e.g. "mycompany")
   * @param {string}   config.token            OAuth bearer token
   * @param {boolean}  [config.debug]          Enable verbose console logging (default: false)
   * @param {number}   [config.timeoutMs]      HTTP request timeout in ms (default: 15 000)
   * @param {object}   [config.strategies]     Override which search strategies to use
   * @param {Array}    [config.strategies.email]  Custom email strategy list
   * @param {Array}    [config.strategies.name]   Custom name strategy list
   * @param {object}   [config.accounts]       Options for account fetching
   * @param {number}   [config.accounts.concurrency=5]  Max parallel account requests
   */
  constructor({
    subdomain,
    token,
    debug = false,
    timeoutMs,
    strategies = {},
    accounts: accountOpts = {},
  } = {}) {
    if (!subdomain || typeof subdomain !== 'string') {
      throw new UserVoiceConfigError('`subdomain` is required and must be a non-empty string.');
    }
    if (!token || typeof token !== 'string') {
      throw new UserVoiceConfigError('`token` is required and must be a non-empty string.');
    }

    this._logger = createLogger(!!debug);
    this._client = new Client({ subdomain, token, logger: this._logger, timeoutMs });

    this._emailStrategies = strategies.email ?? EMAIL_STRATEGIES;
    this._nameStrategies  = strategies.name  ?? NAME_STRATEGIES;
    this._accountConcurrency = accountOpts.concurrency ?? 5;

    this._logger.info(`Initialized for subdomain "${subdomain}"`);
  }

  // ─── User search ───────────────────────────────────────────────────────────

  /**
   * Search by email address. Returns the first matching user or `null`.
   *
   * Tries multiple API strategies in order of reliability. The first strategy
   * that returns a result wins; remaining strategies are skipped.
   *
   * @param {string} email
   * @returns {Promise<import('./normalizer.js').NormalizedUser | null>}
   */
  async findByEmail(email) {
    if (!email || typeof email !== 'string') {
      throw new TypeError('`email` must be a non-empty string.');
    }
    const trimmed = email.trim().toLowerCase();
    this._logger.info(`findByEmail("${trimmed}")`);

    const results = await this._runStrategies(this._emailStrategies, trimmed);
    const user = results[0] ?? null;
    this._logger.info(
      user ? `findByEmail resolved → user #${user.id} (${user.name})` : 'findByEmail resolved → null',
    );
    return user;
  }

  /**
   * Search by display name. Returns all matching users (may be empty).
   *
   * Results are deduplicated by user ID across strategies.
   *
   * @param {string}  name
   * @param {object}  [opts]
   * @param {boolean} [opts.all=false]  If false (default), return after the first
   *                                    strategy that yields results.
   *                                    If true, run all strategies and merge.
   * @returns {Promise<import('./normalizer.js').NormalizedUser[]>}
   */
  async findByName(name, { all = false } = {}) {
    if (!name || typeof name !== 'string') {
      throw new TypeError('`name` must be a non-empty string.');
    }
    const trimmed = name.trim();
    this._logger.info(`findByName("${trimmed}", all=${all})`);

    const results = all
      ? await this._runAllStrategies(this._nameStrategies, trimmed)
      : await this._runStrategies(this._nameStrategies, trimmed);

    this._logger.info(`findByName resolved → ${results.length} result(s)`);
    return results;
  }

  /**
   * Convenience method: auto-detects whether `query` looks like an email
   * address and delegates to `findByEmail` or `findByName` accordingly.
   *
   * - Email-like input → calls `findByEmail`, wraps the single result in an
   *   array (or returns `[]`).
   * - Everything else  → calls `findByName`.
   *
   * @param {string}  query
   * @param {object}  [opts]       Forwarded to `findByName` when applicable
   * @param {boolean} [opts.all]
   * @returns {Promise<import('./normalizer.js').NormalizedUser[]>}
   */
  async find(query, opts = {}) {
    if (!query || typeof query !== 'string') {
      throw new TypeError('`query` must be a non-empty string.');
    }
    if (EMAIL_RE.test(query.trim())) {
      const user = await this.findByEmail(query.trim());
      return user ? [user] : [];
    }
    return this.findByName(query, opts);
  }

  // ─── Suggestion supporters ────────────────────────────────────────────────

  /**
   * Fetch all supporters for a suggestion.
   *
   * Each supporter record includes the user's basic profile and a lightweight
   * account stub (id + name). Custom fields on the account are **not** included
   * here — use `getSuggestionSupporterDetails()` for that.
   *
   * @param {number|string} suggestionId
   * @param {object}        [opts]
   * @param {number}        [opts.perPage=100]  Records per API page (max 100)
   * @param {number|null}   [opts.limit=null]   Total supporter cap (null = all)
   * @returns {Promise<import('./normalizer.js').NormalizedSupporter[]>}
   */
  async getSuggestionSupporters(suggestionId, opts = {}) {
    if (!suggestionId) {
      throw new TypeError('`suggestionId` is required.');
    }
    this._logger.info(`getSuggestionSupporters: suggestion #${suggestionId}`);

    const supporters = await fetchSuggestionSupporters(
      this._client,
      suggestionId,
      this._logger,
      opts,
    );

    this._logger.info(`getSuggestionSupporters: ${supporters.length} supporter(s)`);
    return supporters;
  }

  /**
   * Fetch full account details for a single account ID.
   *
   * Returns the complete account record including all Salesforce-synced and
   * UserVoice-native custom fields under `account.customFields`.
   *
   * @param {number|string} accountId
   * @returns {Promise<import('./normalizer.js').NormalizedAccount>}
   */
  async getAccountDetails(accountId) {
    if (!accountId) {
      throw new TypeError('`accountId` is required.');
    }
    this._logger.info(`getAccountDetails: account #${accountId}`);
    return fetchAccount(this._client, accountId, this._logger);
  }

  /**
   * Fetch all supporters for a suggestion **and** enrich each one with the
   * full account record — including all custom fields.
   *
   * This is the primary method for building a supporter table where each row
   * needs account-level attributes (ARR, Plan, Industry, Salesforce fields, etc.).
   *
   * Flow:
   *  1. Fetch all supporter pages for the suggestion (auto-paginated)
   *  2. Collect unique account IDs from the supporter list
   *  3. Fetch each account in parallel (concurrency-limited)
   *  4. Merge full account data (with customFields) back onto each supporter
   *
   * @param {number|string} suggestionId
   * @param {object}        [opts]
   * @param {number}        [opts.perPage=100]      Supporter records per API page
   * @param {number|null}   [opts.limit=null]       Cap total supporters (null = all)
   * @param {number}        [opts.concurrency]      Max parallel account requests
   *                                                (overrides constructor default)
   * @returns {Promise<import('./normalizer.js').NormalizedSupporter[]>}
   *
   * @example
   * const rows = await search.getSuggestionSupporterDetails(12345);
   *
   * // Render a table
   * for (const row of rows) {
   *   console.log(
   *     row.name,
   *     row.email,
   *     row.votes,
   *     row.account?.name,
   *     row.account?.customFields?.ARR,
   *     row.account?.customFields?.Plan,
   *   );
   * }
   */
  async getSuggestionSupporterDetails(suggestionId, opts = {}) {
    if (!suggestionId) {
      throw new TypeError('`suggestionId` is required.');
    }

    const { concurrency = this._accountConcurrency, ...supporterOpts } = opts;

    this._logger.info(`getSuggestionSupporterDetails: suggestion #${suggestionId}`);

    // Step 1 — all supporters (auto-paginated)
    const supporters = await fetchSuggestionSupporters(
      this._client,
      suggestionId,
      this._logger,
      supporterOpts,
    );

    if (supporters.length === 0) {
      this._logger.info('getSuggestionSupporterDetails: no supporters, done');
      return [];
    }

    // Step 2 — collect unique account IDs (skip supporters with no account)
    const accountIds = [
      ...new Set(
        supporters
          .map((s) => s.account?.id)
          .filter((id) => id != null)
          .map(String),
      ),
    ];

    this._logger.info(
      `getSuggestionSupporterDetails: ${supporters.length} supporter(s), ${accountIds.length} unique account(s)`,
    );

    // Step 3 — parallel account fetch (concurrency-limited, partial-failure tolerant)
    const accountMap = await fetchAccounts(this._client, accountIds, this._logger, { concurrency });

    // Step 4 — merge full account data onto each supporter
    const enriched = mergeAccountsIntoSupporters(supporters, accountMap);

    this._logger.info(
      `getSuggestionSupporterDetails: done — ${enriched.length} row(s) ready`,
    );
    return enriched;
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Run strategies in order; stop and return as soon as one yields results.
   * Errors from individual strategies are caught and logged — we fall through
   * to the next strategy unless ALL strategies fail (last error re-thrown).
   */
  async _runStrategies(strategies, query) {
    let lastError = null;

    for (const { name, fn } of strategies) {
      try {
        const results = await fn(this._client, query, this._logger);
        if (results.length > 0) return results;
      } catch (err) {
        lastError = err;
        this._logger.strategy(name, 'error', err.message);
        if (err instanceof UserVoiceRateLimitError) throw err;
      }
    }

    if (lastError && !(lastError instanceof UserVoiceApiError)) throw lastError;
    return [];
  }

  /**
   * Run ALL strategies concurrently, merge and deduplicate results by user ID.
   */
  async _runAllStrategies(strategies, query) {
    const seen = new Map();
    const errors = [];

    await Promise.allSettled(
      strategies.map(async ({ name, fn }) => {
        try {
          const results = await fn(this._client, query, this._logger);
          for (const user of results) {
            const key = String(user.id ?? user.email ?? user.name);
            if (!seen.has(key)) seen.set(key, user);
          }
        } catch (err) {
          this._logger.strategy(name, 'error', err.message);
          errors.push(err);
        }
      }),
    );

    if (seen.size === 0 && errors.length === strategies.length) throw errors[0];
    return [...seen.values()];
  }
}

// ─── Re-export errors so callers can instanceof-check without a second import

export { UserVoiceApiError, UserVoiceRateLimitError, UserVoiceConfigError };

// ─── Default export for CJS convenience

export default UserVoiceSearch;
