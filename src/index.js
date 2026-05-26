/**
 * uservoice-user-search
 *
 * Reliable multi-strategy user lookup for the UserVoice API.
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
 * const user  = await search.findByEmail('alice@example.com');
 * const users = await search.findByName('Alice Smith');
 * const any   = await search.find('alice@example.com');
 * ```
 */

import { Client } from './client.js';
import { createLogger } from './logger.js';
import { EMAIL_STRATEGIES } from './strategies/email.js';
import { NAME_STRATEGIES } from './strategies/name.js';
import { UserVoiceApiError, UserVoiceRateLimitError, UserVoiceConfigError } from './errors.js';

// Simple RFC-5322-ish email detection — good enough for routing decisions.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class UserVoiceSearch {
  /**
   * @param {object}   config
   * @param {string}   config.subdomain   Your UserVoice subdomain (e.g. "mycompany")
   * @param {string}   config.token       OAuth bearer token
   * @param {boolean}  [config.debug]     Enable verbose console logging (default: false)
   * @param {number}   [config.timeoutMs] HTTP request timeout in ms (default: 15 000)
   * @param {object}   [config.strategies]   Override which strategies to use
   * @param {Array}    [config.strategies.email]  Custom email strategy list
   * @param {Array}    [config.strategies.name]   Custom name strategy list
   */
  constructor({
    subdomain,
    token,
    debug = false,
    timeoutMs,
    strategies = {},
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

    this._logger.info(`Initialized for subdomain "${subdomain}"`);
  }

  // ─── Public API ────────────────────────────────────────────────────────────

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
   * @param {boolean} [opts.all=false]  If false (default), return after the
   *                                    first strategy that yields any results.
   *                                    If true, run all strategies and merge.
   * @returns {Promise<import('./normalizer.js').NormalizedUser[]>}
   */
  async findByName(name, { all = false } = {}) {
    if (!name || typeof name !== 'string') {
      throw new TypeError('`name` must be a non-empty string.');
    }
    const trimmed = name.trim();
    this._logger.info(`findByName("${trimmed}", all=${all})`);

    let results;
    if (all) {
      results = await this._runAllStrategies(this._nameStrategies, trimmed);
    } else {
      results = await this._runStrategies(this._nameStrategies, trimmed);
    }

    this._logger.info(`findByName resolved → ${results.length} result(s)`);
    return results;
  }

  /**
   * Convenience method: auto-detects whether `query` looks like an email
   * address and delegates to `findByEmail` or `findByName` accordingly.
   *
   * - Email-like input → calls `findByEmail`, wraps the single result in an
   *   array (or returns `[]`).
   * - Everything else → calls `findByName`.
   *
   * @param {string}  query
   * @param {object}  [opts]          Forwarded to `findByName` when applicable
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

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Run strategies in order; stop and return as soon as one yields results.
   * Errors from individual strategies are caught and logged; we fall through
   * to the next strategy unless *all* strategies fail (in which case the last
   * error is re-thrown).
   *
   * @param {Array<{name: string, fn: Function}>} strategies
   * @param {string} query
   * @returns {Promise<import('./normalizer.js').NormalizedUser[]>}
   */
  async _runStrategies(strategies, query) {
    let lastError = null;

    for (const { name, fn } of strategies) {
      try {
        const results = await fn(this._client, query, this._logger);
        if (results.length > 0) {
          return results;
        }
        // Empty result — try next strategy
      } catch (err) {
        lastError = err;
        this._logger.strategy(name, 'error', err.message);
        // Only bail out immediately on rate limit — there's no point hammering
        // remaining endpoints if the whole tenant is rate-limited.
        if (err instanceof UserVoiceRateLimitError) throw err;
        // Otherwise fall through to the next strategy
      }
    }

    // If every strategy returned empty but at least one errored, surface it.
    if (lastError && !(lastError instanceof UserVoiceApiError)) {
      throw lastError;
    }

    return [];
  }

  /**
   * Run ALL strategies, merge and deduplicate results by user ID.
   *
   * @param {Array<{name: string, fn: Function}>} strategies
   * @param {string} query
   * @returns {Promise<import('./normalizer.js').NormalizedUser[]>}
   */
  async _runAllStrategies(strategies, query) {
    const seen = new Map(); // id → NormalizedUser
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

    if (seen.size === 0 && errors.length === strategies.length) {
      // Every strategy failed — throw the first error
      throw errors[0];
    }

    return [...seen.values()];
  }
}

// ─── Re-export errors so callers can instanceof-check without a second import

export { UserVoiceApiError, UserVoiceRateLimitError, UserVoiceConfigError };

// ─── Default export for CJS convenience

export default UserVoiceSearch;
