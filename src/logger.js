/**
 * Tiered logger for uservoice-user-search.
 *
 * Six log levels control what appears on the console:
 *
 *  silent  (0)  No output whatsoever. Default when logLevel is not set.
 *  error   (1)  Hard errors — API failures, config problems.
 *  warn    (2)  Non-fatal warnings — unexpected response shapes, partial
 *               account-fetch failures, retry notices.
 *  info    (3)  Public-method entry/exit, result counts, pagination totals,
 *               per-call timing summaries.
 *  debug   (4)  Strategy events, request URLs, redacted request headers,
 *               response status codes and timing.
 *               Equivalent to the legacy `debug: true` option.
 *  verbose (5)  Everything in debug, plus: full decoded query-parameter
 *               listings and full response body (truncated at bodyLimit).
 *               Useful when diagnosing unexpected API payloads.
 *
 * Backward compatibility
 * ──────────────────────
 * Passing `debug: true` to the constructor still works and maps to level
 * `'debug'` (4).  `debug: false` (or omitted) maps to `'silent'` (0).
 *
 * @module logger
 */

const PREFIX = '[uservoice-user-search]';
const DEFAULT_BODY_LIMIT = 4_096; // characters

// ─── Level map ───────────────────────────────────────────────────────────────

/**
 * Numeric values for each named log level.
 * @type {Record<string,number>}
 */
export const LOG_LEVELS = Object.freeze({
  silent:  0,
  error:   1,
  warn:    2,
  info:    3,
  debug:   4,
  verbose: 5,
});

/**
 * Resolve a caller-supplied level value to a numeric level.
 *
 * Accepts:
 *   - A string level name: `'verbose'`, `'debug'`, …
 *   - A number: used as-is (clamped to [0, 5])
 *   - `true`: backward-compat alias for `'debug'`
 *   - `false` / `null` / `undefined`: `'silent'`
 *
 * @param {unknown} input
 * @returns {number}
 */
export function resolveLevel(input) {
  if (input === true)  return LOG_LEVELS.debug;    // backward compat
  if (!input)          return LOG_LEVELS.silent;
  if (typeof input === 'number') {
    return Math.max(LOG_LEVELS.silent, Math.min(Math.floor(input), LOG_LEVELS.verbose));
  }
  if (typeof input === 'string') {
    const n = LOG_LEVELS[input.toLowerCase()];
    return n != null ? n : LOG_LEVELS.silent;
  }
  return LOG_LEVELS.silent;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create a logger for the given level.
 *
 * @param {string|number|boolean|null|undefined} levelInput
 *   A log level name, numeric level, or boolean (backward compat).
 * @param {object}  [opts]
 * @param {number}  [opts.bodyLimit=4096]
 *   Maximum characters to print for a response body at verbose level.
 *   Bodies longer than this are truncated with a notice.
 * @returns {Logger}
 */
export function createLogger(levelInput, { bodyLimit = DEFAULT_BODY_LIMIT } = {}) {
  const level = resolveLevel(levelInput);

  // Fast path — silent level: return no-op object so call sites pay zero cost
  if (level === LOG_LEVELS.silent) return SILENT_LOGGER;

  const at = (required) => level >= required;

  return {
    // ── Standard severity ─────────────────────────────────────────────────

    /**
     * Hard error.  Always shown at level ≥ error.
     * @param {string} message
     * @param {...unknown} args
     */
    error(message, ...args) {
      console.error(`${PREFIX} [ERROR]   ${message}`, ...args);
    },

    /**
     * Non-fatal warning.  Shown at level ≥ warn.
     * @param {string} message
     * @param {...unknown} args
     */
    warn(message, ...args) {
      if (at(LOG_LEVELS.warn)) console.warn(`${PREFIX} [WARN]    ${message}`, ...args);
    },

    /**
     * General progress information.  Shown at level ≥ info.
     * @param {string} message
     * @param {...unknown} args
     */
    info(message, ...args) {
      if (at(LOG_LEVELS.info)) console.log(`${PREFIX} [INFO]    ${message}`, ...args);
    },

    // ── HTTP request / response ───────────────────────────────────────────

    /**
     * Log an outgoing HTTP request.
     *
     * At debug level: method, full URL, and redacted headers.
     * At verbose level: additionally prints each query parameter decoded.
     *
     * @param {string} method  HTTP method (always GET for this library)
     * @param {string} url     Full URL including query string
     * @param {Record<string,string>} [headers]
     */
    request(method, url, headers = {}) {
      if (!at(LOG_LEVELS.debug)) return;

      console.log(`${PREFIX} [DEBUG]   → ${method} ${url}`);
      console.log(`${PREFIX} [DEBUG]     headers: ${JSON.stringify(redactAuth(headers))}`);

      if (at(LOG_LEVELS.verbose)) {
        try {
          const params = [...new URL(url).searchParams.entries()];
          if (params.length > 0) {
            console.log(`${PREFIX} [VERBOSE]   query params:`);
            for (const [k, v] of params) {
              console.log(`${PREFIX} [VERBOSE]     ${k} = ${v}`);
            }
          }
        } catch {
          // URL parse failed — skip param breakdown
        }
      }
    },

    /**
     * Log an incoming HTTP response.
     *
     * At debug level: status, URL, result count, and duration.
     * At verbose level: additionally prints the full response body
     *                   (truncated to `bodyLimit` characters).
     *
     * @param {string}  url
     * @param {number}  status        HTTP status code
     * @param {number}  resultCount   Number of records in the payload; -1 if unknown
     * @param {number}  durationMs    Round-trip time in milliseconds
     * @param {unknown} [body]        Parsed response body (used at verbose level)
     */
    response(url, status, resultCount, durationMs, body) {
      if (!at(LOG_LEVELS.debug)) return;

      const count = resultCount >= 0 ? `${resultCount} result(s)` : 'unknown result count';
      console.log(`${PREFIX} [DEBUG]   ← ${status} ${url} — ${count} in ${durationMs}ms`);

      if (at(LOG_LEVELS.verbose) && body != null) {
        const { text, byteLength, truncated } = formatBody(body, bodyLimit);
        const notice = truncated
          ? `, truncated at ${bodyLimit} chars (full size: ${byteLength} chars)`
          : `, ${byteLength} chars`;
        console.log(`${PREFIX} [VERBOSE]   response body${notice}:`);
        console.log(text);
      }
    },

    // ── Search strategy ───────────────────────────────────────────────────

    /**
     * Log a strategy lifecycle event.
     *
     * Shown at level ≥ debug.
     *
     * @param {string} strategyName
     * @param {'start'|'success'|'empty'|'error'} event
     * @param {string} [detail]
     */
    strategy(strategyName, event, detail = '') {
      if (!at(LOG_LEVELS.debug)) return;
      const icons = { start: '▶', success: '✓', empty: '○', error: '✗' };
      const icon = icons[event] ?? '?';
      const suffix = detail ? ` — ${detail}` : '';
      console.log(`${PREFIX} [DEBUG]   [${icon}] ${strategyName}${suffix}`);
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** No-op logger returned when level is silent. */
const SILENT_LOGGER = Object.freeze({
  error:    noop,
  warn:     noop,
  info:     noop,
  request:  noop,
  response: noop,
  strategy: noop,
});

function noop() {}

/**
 * Return a copy of `headers` with the Bearer token value replaced by
 * `[REDACTED]`.  Operates on the original string in case it has mixed case.
 *
 * @param {Record<string,string>} headers
 * @returns {Record<string,string>}
 */
function redactAuth(headers) {
  const out = { ...headers };
  for (const key of Object.keys(out)) {
    if (key.toLowerCase() === 'authorization') {
      out[key] = out[key].replace(/Bearer\s+\S+/i, 'Bearer [REDACTED]');
    }
  }
  return out;
}

/**
 * Serialise a response body to a (possibly truncated) string.
 *
 * @param {unknown} body
 * @param {number}  limit  Character limit
 * @returns {{ text: string, byteLength: number, truncated: boolean }}
 */
function formatBody(body, limit) {
  let full;
  try {
    full = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  } catch {
    full = String(body);
  }

  const truncated = full.length > limit;
  return {
    text:       truncated ? `${full.slice(0, limit)}\n... [output truncated]` : full,
    byteLength: full.length,
    truncated,
  };
}
