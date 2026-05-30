import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, resolveLevel, LOG_LEVELS } from '../src/logger.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

let logSpy, warnSpy, errorSpy;

beforeEach(() => {
  logSpy   = vi.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy  = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

const allCalls = () => [
  ...logSpy.mock.calls,
  ...warnSpy.mock.calls,
  ...errorSpy.mock.calls,
].flat().join(' ');

// ─── resolveLevel ─────────────────────────────────────────────────────────────

describe('resolveLevel', () => {
  it('maps level name strings', () => {
    expect(resolveLevel('silent')).toBe(0);
    expect(resolveLevel('error')).toBe(1);
    expect(resolveLevel('warn')).toBe(2);
    expect(resolveLevel('info')).toBe(3);
    expect(resolveLevel('debug')).toBe(4);
    expect(resolveLevel('verbose')).toBe(5);
  });

  it('is case-insensitive', () => {
    expect(resolveLevel('VERBOSE')).toBe(5);
    expect(resolveLevel('Debug')).toBe(4);
    expect(resolveLevel('INFO')).toBe(3);
  });

  it('maps true → debug (backward compat)', () => {
    expect(resolveLevel(true)).toBe(LOG_LEVELS.debug);
  });

  it('maps false → silent', () => {
    expect(resolveLevel(false)).toBe(LOG_LEVELS.silent);
  });

  it('maps null/undefined → silent', () => {
    expect(resolveLevel(null)).toBe(LOG_LEVELS.silent);
    expect(resolveLevel(undefined)).toBe(LOG_LEVELS.silent);
  });

  it('accepts numeric levels', () => {
    expect(resolveLevel(4)).toBe(4);
    expect(resolveLevel(5)).toBe(5);
  });

  it('clamps numeric levels to [0, 5]', () => {
    expect(resolveLevel(-1)).toBe(0);
    expect(resolveLevel(99)).toBe(5);
  });

  it('returns silent for unrecognised strings', () => {
    expect(resolveLevel('trace')).toBe(LOG_LEVELS.silent);
    expect(resolveLevel('wtf')).toBe(LOG_LEVELS.silent);
  });
});

// ─── Level LOG_LEVELS export ──────────────────────────────────────────────────

describe('LOG_LEVELS', () => {
  it('exports the expected numeric values', () => {
    expect(LOG_LEVELS.silent).toBe(0);
    expect(LOG_LEVELS.verbose).toBe(5);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(LOG_LEVELS)).toBe(true);
  });
});

// ─── silent level ─────────────────────────────────────────────────────────────

describe('createLogger(silent)', () => {
  it('emits nothing for any method', () => {
    const logger = createLogger('silent');
    logger.error('e');
    logger.warn('w');
    logger.info('i');
    logger.request('GET', 'https://x.com', {});
    logger.response('https://x.com', 200, 3, 100, { users: [] });
    logger.strategy('s', 'start');
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('backward compat: createLogger(false) is also silent', () => {
    const logger = createLogger(false);
    logger.error('e'); logger.warn('w'); logger.info('i');
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

// ─── error level ──────────────────────────────────────────────────────────────

describe('createLogger(error)', () => {
  it('emits errors', () => {
    createLogger('error').error('boom');
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('suppresses warn, info, debug, verbose', () => {
    const logger = createLogger('error');
    logger.warn('w');
    logger.info('i');
    logger.request('GET', 'https://x.com', {});
    logger.response('https://x.com', 200, 1, 10, {});
    logger.strategy('s', 'start');
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });
});

// ─── warn level ───────────────────────────────────────────────────────────────

describe('createLogger(warn)', () => {
  it('emits errors and warnings', () => {
    const logger = createLogger('warn');
    logger.error('err'); logger.warn('wrn');
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('suppresses info and above', () => {
    const logger = createLogger('warn');
    logger.info('i');
    logger.request('GET', 'https://x.com', {});
    expect(logSpy).not.toHaveBeenCalled();
  });
});

// ─── info level ───────────────────────────────────────────────────────────────

describe('createLogger(info)', () => {
  it('emits error, warn, and info', () => {
    const logger = createLogger('info');
    logger.error('e'); logger.warn('w'); logger.info('i');
    expect(errorSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(logSpy).toHaveBeenCalledOnce();
  });

  it('suppresses debug/verbose output (request, strategy)', () => {
    const logger = createLogger('info');
    logger.request('GET', 'https://x.com', {});
    logger.strategy('s', 'start');
    logger.response('https://x.com', 200, 1, 10, { big: 'body' });
    expect(logSpy).not.toHaveBeenCalled();
  });
});

// ─── debug level ──────────────────────────────────────────────────────────────

describe('createLogger(debug)', () => {
  it('backward compat: createLogger(true) maps to debug', () => {
    const logger = createLogger(true);
    logger.request('GET', 'https://x.com/api', { Authorization: 'Bearer tok' });
    expect(logSpy).toHaveBeenCalled();
  });

  it('logs request URL and redacted auth header', () => {
    const logger = createLogger('debug');
    logger.request('GET', 'https://x.com/api', { Authorization: 'Bearer super-secret' });
    const output = allCalls();
    expect(output).toContain('https://x.com/api');
    expect(output).not.toContain('super-secret');
    expect(output).toContain('REDACTED');
  });

  it('logs response status, result count, and timing', () => {
    const logger = createLogger('debug');
    logger.response('https://x.com/api', 200, 7, 88);
    const output = allCalls();
    expect(output).toContain('200');
    expect(output).toContain('7 result(s)');
    expect(output).toContain('88ms');
  });

  it('does NOT log response body at debug level', () => {
    const logger = createLogger('debug');
    logger.response('https://x.com/api', 200, 1, 10, { secret: 'payload' });
    expect(allCalls()).not.toContain('secret');
  });

  it('logs strategy events', () => {
    const logger = createLogger('debug');
    logger.strategy('v2AdminFilterEmail', 'success', '1 result(s)');
    const output = allCalls();
    expect(output).toContain('v2AdminFilterEmail');
    expect(output).toContain('✓');
  });

  it('does NOT log query params breakdown at debug level', () => {
    const logger = createLogger('debug');
    logger.request('GET', 'https://x.com/api?filter%5Bemail%5D=alice%40example.com', {});
    // Should see the URL but NOT a "params:" breakdown section
    const lines = logSpy.mock.calls.flat();
    const hasParamsSection = lines.some((l) => typeof l === 'string' && l.includes('query params:'));
    expect(hasParamsSection).toBe(false);
  });
});

// ─── verbose level ────────────────────────────────────────────────────────────

describe('createLogger(verbose)', () => {
  it('logs full response body', () => {
    const logger = createLogger('verbose');
    logger.response('https://x.com/api', 200, 1, 10, { users: [{ id: 1 }] });
    const output = allCalls();
    expect(output).toContain('"users"');
    expect(output).toContain('"id": 1');
  });

  it('logs decoded query params', () => {
    const logger = createLogger('verbose');
    logger.request('GET', 'https://x.com/api?filter%5Bemail%5D=alice%40example.com&per_page=10', {});
    const output = allCalls();
    expect(output).toContain('filter[email]');
    expect(output).toContain('alice@example.com');
    expect(output).toContain('per_page');
  });

  it('still redacts bearer token at verbose level', () => {
    const logger = createLogger('verbose');
    logger.request('GET', 'https://x.com', { Authorization: 'Bearer my-secret-token' });
    expect(allCalls()).not.toContain('my-secret-token');
    expect(allCalls()).toContain('REDACTED');
  });

  it('truncates large response bodies', () => {
    const logger = createLogger('verbose', { bodyLimit: 50 });
    const bigBody = { data: 'x'.repeat(200) };
    logger.response('https://x.com', 200, 1, 10, bigBody);
    const output = allCalls();
    expect(output).toContain('[output truncated]');
    // Should report actual byte length
    expect(output).toMatch(/full size: \d+ chars/);
  });

  it('does not truncate bodies within the limit', () => {
    const logger = createLogger('verbose', { bodyLimit: 10_000 });
    logger.response('https://x.com', 200, 1, 10, { small: true });
    expect(allCalls()).not.toContain('[output truncated]');
  });

  it('handles null body gracefully', () => {
    const logger = createLogger('verbose');
    expect(() => logger.response('https://x.com', 200, 0, 5, null)).not.toThrow();
    // Null body → no body block logged
    const output = allCalls();
    expect(output).not.toContain('response body');
  });

  it('logs strategy and request metadata (inherits debug behaviour)', () => {
    const logger = createLogger('verbose');
    logger.strategy('v1SearchName', 'empty', '0 result(s)');
    expect(allCalls()).toContain('v1SearchName');
    expect(allCalls()).toContain('○');
  });
});

// ─── logBodyLimit option ──────────────────────────────────────────────────────

describe('logBodyLimit option', () => {
  it('customises truncation threshold', () => {
    const logger = createLogger('verbose', { bodyLimit: 20 });
    logger.response('https://x.com', 200, 1, 5, { key: 'a'.repeat(100) });
    expect(allCalls()).toContain('[output truncated]');
  });
});
