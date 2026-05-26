import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger } from '../src/logger.js';

describe('createLogger (debug=false)', () => {
  it('all methods are no-ops — console is never called', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = createLogger(false);

    logger.info('hello');
    logger.warn('warning');
    logger.error('error');
    logger.request('GET', 'https://x.uservoice.com/api/v2/admin/users', {});
    logger.response('https://x.uservoice.com', 200, 3, 42);
    logger.strategy('myStrategy', 'start', 'detail');

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('createLogger (debug=true)', () => {
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

  it('info() calls console.log', () => {
    const logger = createLogger(true);
    logger.info('test message');
    expect(logSpy).toHaveBeenCalledOnce();
  });

  it('warn() calls console.warn', () => {
    const logger = createLogger(true);
    logger.warn('a warning');
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it('error() calls console.error', () => {
    const logger = createLogger(true);
    logger.error('an error');
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it('request() redacts bearer token', () => {
    const logger = createLogger(true);
    logger.request('GET', 'https://example.com', {
      Authorization: 'Bearer super-secret-token',
    });
    const logged = logSpy.mock.calls.flat().join(' ');
    expect(logged).not.toContain('super-secret-token');
    expect(logged).toContain('REDACTED');
  });

  it('response() includes status, result count, and duration', () => {
    const logger = createLogger(true);
    logger.response('https://example.com/api', 200, 5, 123);
    const logged = logSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('200');
    expect(logged).toContain('5 result');
    expect(logged).toContain('123ms');
  });

  it('strategy() includes the strategy name and event icon', () => {
    const logger = createLogger(true);
    logger.strategy('myStrategy', 'success', 'all good');
    const logged = logSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('myStrategy');
    expect(logged).toContain('✓');
    expect(logged).toContain('all good');
  });
});
