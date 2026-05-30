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
 * const rows = await search.getSuggestionSupporterDetails(suggestionId, { forumId: 1 });
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

// Re-export so callers can reference level names without a second import
export { LOG_LEVELS } from './logger.js';

// Simple RFC-5322-ish email detection — good enough for routing decisions.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class UserVoiceSearch {
  /**
   * @param {object}   config
   * @param {string}   config.subdomain        Your UserVoice subdomain (e.g. "mycompany")
   * @param {string}   config.token            OAuth bearer token
   *
   * @param {string}   [config.logLevel]       Log verbosity. One of:
   *                                             'silent'  — no output (default)
   *                                             'error'   — hard errors only
   *                                             'warn'    — errors + non-fatal warnings
   *                                             'info'    — progress, totals, timing
   *                                             'debug'   — strategy events, request URLs,
   *                                                         redacted headers, response metadata
   *                                             'verbose' — everything in debug, plus full
   *                                                         decoded query params and full
   *                                                         response bodies
   *                                           Takes precedence over `debug` when both are set.
   * @param {boolean}  [config.debug]          Backward-compatible alias for logLevel:'debug'.
   *                                           Ignored when `logLevel` is also specified.
   * @param {number}   [config.logBodyLimit=4096]
   *                                           Maximum characters printed per response body
   *                                           at verbose level. Bodies longer than this are
   *                                           truncated with a notice.
   *
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
    logLevel,
    debug = false,
    logBodyLimit,
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

    // logLevel takes precedence; fall back to debug boolean for backward compat
    const effectiveLevel = logLevel ?? (debug ? 'debug' : 'silent');
    const loggerOpts = logBodyLimit != null ? { bodyLimit: logBodyLimit } : {};
    this._logger = createLogger(effectiveLevel, loggerOpts);
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
    const t0 = Date.now();
    this._logger.info(`findByEmail("${trimmed}")`);

    const results = await this._runStrategies(this._emailStrategies, trimmed);
    const user = results[0] ?? null;
    this._logger.info(
      user
        ? `findByEmail → user #${user.id} "${user.name}" in ${Date.now() - t0}ms`
        : `findByEmail → no match in ${Date.now() - t0}ms`,
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
    const t0 = Date.now();
    this._logger.info(`findByName("${trimmed}", all=${all})`);

    const results = all
      ? await this._runAllStrategies(this._nameStrategies, trimmed)
      : await this._runStrategies(this._nameStrategies, trimmed);

    this._logger.info(`findByName → ${results.length} result(s) in ${Date.now() - t0}ms`);
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
   * @param {number|string} [opts.forumId]     The UserVoice forum (project) ID the suggestion
   *                                           belongs to. When supplied the scoped path
   *                                           `/api/v2/admin/forums/:forumId/suggestions/…`
   *                                           is used, with automatic fallback to the unscoped
   *                                           path on 404. Strongly recommended — most UserVoice
   *                                           instances return 404 without it.
   * @param {number}        [opts.perPage=100]  Records per API page (max 100)
   * @param {number|null}   [opts.limit=null]   Total supporter cap (null = all)
   * @returns {Promise<import('./normalizer.js').NormalizedSupporter[]>}
   */
  async getSuggestionSupporters(suggestionId, opts = {}) {
    if (!suggestionId) {
      throw new TypeError('`suggestionId` is required.');
    }
    const t0 = Date.now();
    this._logger.info(`getSuggestionSupporters: suggestion #${suggestionId}`);

    const supporters = await fetchSuggestionSupporters(
      this._client,
      suggestionId,
      this._logger,
      opts,
    );

    this._logger.info(
      `getSuggestionSupporters → ${supporters.length} supporter(s) in ${Date.now() - t0}ms`,
    );
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
    const t0 = Date.now();
    this._logger.info(`getAccountDetails: account #${accountId}`);
    const account = await fetchAccount(this._client, accountId, this._logger);
    this._logger.info(
      `getAccountDetails → "${account.name}" (${Object.keys(account.customFields).length} custom field(s)) in ${Date.now() - t0}ms`,
    );
    return account;
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
   * @param {number|string} [opts.forumId]           The UserVoice forum (project) ID the suggestion
   *                                                 belongs to. Strongly recommended — most UserVoice
   *                                                 instances return 404 without it. When supplied the
   *                                                 scoped path is tried first, with automatic fallback
   *                                                 to the unscoped path on 404.
   * @param {number}        [opts.perPage=100]       Supporter records per API page
   * @param {number|null}   [opts.limit=null]        Cap total supporters (null = all)
   * @param {number}        [opts.concurrency]       Max parallel account requests
   *                                                 (overrides constructor default)
   * @returns {Promise<import('./normalizer.js').NormalizedSupporter[]>}
   *
   * @example
   * const rows = await search.getSuggestionSupporterDetails(12345, { forumId: 1 });
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

    const t0 = Date.now();
    this._logger.info(`getSuggestionSupporterDetails: suggestion #${suggestionId}`);

    // Step 1 — all supporters (auto-paginated)
    const supporters = await fetchSuggestionSupporters(
      this._client,
      suggestionId,
      this._logger,
      supporterOpts,
    );

    if (supporters.length === 0) {
      this._logger.info(
        `getSuggestionSupporterDetails → 0 supporters in ${Date.now() - t0}ms`,
      );
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
      `getSuggestionSupporterDetails: ${supporters.length} supporter(s), ` +
      `${accountIds.length} unique account(s) to enrich`,
    );

    // Step 3 — parallel account fetch (concurrency-limited, partial-failure tolerant)
    const accountMap = await fetchAccounts(this._client, accountIds, this._logger, { concurrency });

    // Step 4 — merge full account data onto each supporter
    const enriched = mergeAccountsIntoSupporters(supporters, accountMap);

    const enrichedCount = enriched.filter((s) => s.account?.customFields).length;
    this._logger.info(
      `getSuggestionSupporterDetails → ${enriched.length} row(s), ` +
      `${accountMap.size}/${accountIds.length} accounts enriched in ${Date.now() - t0}ms`,
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
