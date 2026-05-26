/**
 * Custom error types for uservoice-user-search.
 *
 * Keeping errors in their own file avoids circular-import issues and makes
 * them easy to import individually in test mocks.
 */

/**
 * Thrown when the UserVoice API returns an HTTP error (4xx / 5xx) or a
 * non-JSON body.
 */
export class UserVoiceApiError extends Error {
  /**
   * @param {string}  message
   * @param {object}  [meta]
   * @param {string}  [meta.url]
   * @param {number}  [meta.status]
   * @param {unknown} [meta.body]
   * @param {Error}   [meta.cause]
   */
  constructor(message, { url, status, body, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'UserVoiceApiError';
    this.url = url ?? null;
    this.status = status ?? null;
    this.body = body ?? null;
  }
}

/**
 * Thrown when all retry attempts are exhausted after a 429 response.
 */
export class UserVoiceRateLimitError extends UserVoiceApiError {
  /**
   * @param {number} retryAfter  Seconds to wait as reported by the server
   * @param {string} url
   */
  constructor(retryAfter, url) {
    super(`Rate limit exceeded. Retry after ${retryAfter}s.`, { url, status: 429 });
    this.name = 'UserVoiceRateLimitError';
    this.retryAfter = retryAfter;
  }
}

/**
 * Thrown when the caller passes invalid configuration.
 */
export class UserVoiceConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserVoiceConfigError';
  }
}
