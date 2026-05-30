/**
 * Thin HTTP client for the UserVoice REST API.
 *
 * Handles:
 *  - Bearer auth header injection
 *  - JSON parsing with error normalisation
 *  - Automatic rate-limit retry (429 + Retry-After)
 *  - Tiered request/response logging (debug = metadata, verbose = full bodies)
 */

import { UserVoiceApiError, UserVoiceRateLimitError } from './errors.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;

export class Client {
  /**
   * @param {object}   opts
   * @param {string}   opts.subdomain    e.g. "mycompany" → mycompany.uservoice.com
   * @param {string}   opts.token        OAuth bearer token
   * @param {import('./logger.js').Logger} opts.logger
   * @param {number}   [opts.timeoutMs]  request timeout in ms (default 15 000)
   */
  constructor({ subdomain, token, logger, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    this.baseUrl = `https://${subdomain}.uservoice.com`;
    this.token = token;
    this.logger = logger;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Issue a GET request and return the parsed JSON body.
   *
   * @param {string}               path      API path, e.g. "/api/v2/admin/users"
   * @param {Record<string,string>} [params]  Query-string parameters
   * @returns {Promise<unknown>}
   */
  async get(path, params = {}) {
    const url = this._buildUrl(path, params);
    return this._fetchWithRetry('GET', url);
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  _buildUrl(path, params) {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  _headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  async _fetchWithRetry(method, url, attempt = 1) {
    const headers = this._headers();
    this.logger.request(method, url, headers);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const t0 = Date.now();

    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new UserVoiceApiError(`Request timed out after ${this.timeoutMs}ms`, { url });
      }
      throw new UserVoiceApiError(`Network error: ${err.message}`, { url, cause: err });
    } finally {
      clearTimeout(timer);
    }

    const durationMs = Date.now() - t0;

    // Handle rate limiting with automatic back-off
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('Retry-After') ?? 1);
      this.logger.warn(
        `Rate limited (429). Retry-After: ${retryAfter}s. Attempt ${attempt}/${MAX_RETRIES}.`,
      );
      if (attempt >= MAX_RETRIES) {
        throw new UserVoiceRateLimitError(retryAfter, url);
      }
      await sleep(retryAfter * 1_000);
      return this._fetchWithRetry(method, url, attempt + 1);
    }

    let body;
    const text = await response.text();
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new UserVoiceApiError(
        `Non-JSON response (status ${response.status}): ${text.slice(0, 200)}`,
        { url, status: response.status },
      );
    }

    if (!response.ok) {
      // UserVoice surfaces errors as { errors: [...] } or { error: "..." }
      const message =
        (Array.isArray(body?.errors) ? body.errors.map((e) => e.message ?? e).join('; ') : null) ??
        body?.error ??
        `HTTP ${response.status}`;

      this.logger.error(`API error ${response.status} for ${url}: ${message}`);
      throw new UserVoiceApiError(message, { url, status: response.status, body });
    }

    // Count results for logging (best-effort)
    const resultCount = countResults(body);

    // Pass the parsed body so verbose level can log it in full
    this.logger.response(url, response.status, resultCount, durationMs, body);

    return body;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Try to determine how many records are in the response body.
 * Handles user, supporter, and account collection shapes.
 * Returns -1 if the shape is unrecognised.
 */
function countResults(body) {
  if (!body || typeof body !== 'object') return -1;
  // v2 collection: { users: [...] }
  if (Array.isArray(body.users)) return body.users.length;
  // v2 supporters: { supporters: [...] }
  if (Array.isArray(body.supporters)) return body.supporters.length;
  // v2 single account: { account: {...} } — count as 1
  if (body.account && typeof body.account === 'object') return 1;
  // v1 search: { response: [...] }
  if (Array.isArray(body.response)) return body.response.length;
  // autocomplete: { autocomplete: { users: [...] } }
  if (Array.isArray(body.autocomplete?.users)) return body.autocomplete.users.length;
  return -1;
}
