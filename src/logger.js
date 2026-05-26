/**
 * Lightweight debug logger.
 *
 * When debug is disabled every method is a no-op, so call-site code pays
 * zero overhead without conditional guards everywhere.
 */

const PREFIX = '[uservoice-user-search]';

/**
 * @param {boolean} enabled
 * @returns {Logger}
 */
export function createLogger(enabled) {
  if (!enabled) {
    return {
      info: noop,
      warn: noop,
      error: noop,
      request: noop,
      response: noop,
      strategy: noop,
    };
  }

  return {
    /**
     * General informational message.
     * @param {string} message
     * @param {...*} args
     */
    info(message, ...args) {
      console.log(`${PREFIX} [INFO]  ${message}`, ...args);
    },

    /**
     * Non-fatal warning.
     * @param {string} message
     * @param {...*} args
     */
    warn(message, ...args) {
      console.warn(`${PREFIX} [WARN]  ${message}`, ...args);
    },

    /**
     * Error details.
     * @param {string} message
     * @param {...*} args
     */
    error(message, ...args) {
      console.error(`${PREFIX} [ERROR] ${message}`, ...args);
    },

    /**
     * Log an outgoing HTTP request.
     * @param {string} method
     * @param {string} url
     * @param {Record<string,string>} [headers]
     */
    request(method, url, headers = {}) {
      const safeHeaders = { ...headers };
      if (safeHeaders['Authorization']) {
        safeHeaders['Authorization'] = safeHeaders['Authorization'].replace(
          /Bearer\s+\S+/i,
          'Bearer [REDACTED]',
        );
      }
      console.log(`${PREFIX} [REQ]   ${method} ${url}`);
      console.log(`${PREFIX} [REQ]   headers: ${JSON.stringify(safeHeaders)}`);
    },

    /**
     * Log an incoming HTTP response.
     * @param {string} url
     * @param {number} status
     * @param {number} resultCount   number of users in the payload (-1 if unknown)
     * @param {number} durationMs
     */
    response(url, status, resultCount, durationMs) {
      const countLabel = resultCount >= 0 ? `${resultCount} result(s)` : 'unknown result count';
      console.log(
        `${PREFIX} [RES]   ${status} ${url} — ${countLabel} in ${durationMs}ms`,
      );
    },

    /**
     * Log a strategy attempt.
     * @param {string} strategyName
     * @param {'start'|'success'|'empty'|'error'} event
     * @param {string} [detail]
     */
    strategy(strategyName, event, detail = '') {
      const icons = { start: '▶', success: '✓', empty: '○', error: '✗' };
      const icon = icons[event] ?? '?';
      console.log(
        `${PREFIX} [STRAT] ${icon} ${strategyName}${detail ? ` — ${detail}` : ''}`,
      );
    },
  };
}

function noop() {}
