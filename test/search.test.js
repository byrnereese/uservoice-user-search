/**
 * Integration-style tests for UserVoiceSearch — the main orchestrator.
 *
 * We inject custom strategy lists so we can control exactly which strategies
 * fire and what they return, without mocking at the HTTP level.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UserVoiceSearch } from '../src/index.js';
import { UserVoiceApiError, UserVoiceRateLimitError, UserVoiceConfigError } from '../src/errors.js';
import { rawV2User } from './helpers.js';
import { normalizeUser } from '../src/normalizer.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeUser(id, overrides = {}) {
  return normalizeUser(rawV2User({ id, ...overrides }));
}

/** Strategy fn that always resolves with `users`. */
function alwaysReturns(users) {
  return vi.fn().mockResolvedValue(users);
}

/** Strategy fn that always resolves empty. */
function alwaysEmpty() {
  return vi.fn().mockResolvedValue([]);
}

/** Strategy fn that always rejects with `error`. */
function alwaysThrows(error) {
  return vi.fn().mockRejectedValue(error);
}

/** Build a UserVoiceSearch with custom strategy lists (no real HTTP calls). */
function makeSearch({ emailStrategies, nameStrategies } = {}) {
  return new UserVoiceSearch({
    subdomain: 'test',
    token: 'test-token',
    strategies: {
      email: emailStrategies,
      name: nameStrategies,
    },
  });
}

// ─── Constructor validation ───────────────────────────────────────────────────

describe('UserVoiceSearch constructor', () => {
  it('throws UserVoiceConfigError when subdomain is missing', () => {
    expect(() => new UserVoiceSearch({ token: 'x' })).toThrow(UserVoiceConfigError);
  });

  it('throws UserVoiceConfigError when token is missing', () => {
    expect(() => new UserVoiceSearch({ subdomain: 'x' })).toThrow(UserVoiceConfigError);
  });

  it('accepts valid config without throwing', () => {
    expect(() => new UserVoiceSearch({ subdomain: 'x', token: 'y' })).not.toThrow();
  });
});

// ─── findByEmail ─────────────────────────────────────────────────────────────

describe('findByEmail', () => {
  it('returns the first result from the first successful strategy', async () => {
    const user = makeUser(1);
    const strat1 = { name: 's1', fn: alwaysReturns([user]) };
    const strat2 = { name: 's2', fn: alwaysEmpty() };

    const search = makeSearch({ emailStrategies: [strat1, strat2] });
    const result = await search.findByEmail('alice@example.com');

    expect(result).toEqual(user);
    expect(strat2.fn).not.toHaveBeenCalled(); // short-circuits
  });

  it('falls through to the next strategy when the first returns empty', async () => {
    const user = makeUser(2);
    const strat1 = { name: 's1', fn: alwaysEmpty() };
    const strat2 = { name: 's2', fn: alwaysReturns([user]) };

    const search = makeSearch({ emailStrategies: [strat1, strat2] });
    const result = await search.findByEmail('alice@example.com');

    expect(result?.id).toBe(2);
    expect(strat1.fn).toHaveBeenCalled();
    expect(strat2.fn).toHaveBeenCalled();
  });

  it('falls through when a strategy errors', async () => {
    const user = makeUser(3);
    const strat1 = { name: 's1', fn: alwaysThrows(new UserVoiceApiError('bad filter')) };
    const strat2 = { name: 's2', fn: alwaysReturns([user]) };

    const search = makeSearch({ emailStrategies: [strat1, strat2] });
    const result = await search.findByEmail('alice@example.com');

    expect(result?.id).toBe(3);
  });

  it('returns null when all strategies are empty', async () => {
    const search = makeSearch({
      emailStrategies: [
        { name: 's1', fn: alwaysEmpty() },
        { name: 's2', fn: alwaysEmpty() },
      ],
    });
    const result = await search.findByEmail('nobody@example.com');
    expect(result).toBeNull();
  });

  it('immediately rethrows UserVoiceRateLimitError', async () => {
    const rl = new UserVoiceRateLimitError(60, 'https://test.uservoice.com/api/v2/admin/users');
    const strat1 = { name: 's1', fn: alwaysThrows(rl) };
    const strat2 = { name: 's2', fn: alwaysReturns([makeUser(1)]) };

    const search = makeSearch({ emailStrategies: [strat1, strat2] });
    await expect(search.findByEmail('alice@example.com')).rejects.toThrow(UserVoiceRateLimitError);
    expect(strat2.fn).not.toHaveBeenCalled();
  });

  it('throws TypeError for non-string email', async () => {
    const search = makeSearch({ emailStrategies: [] });
    await expect(search.findByEmail(null)).rejects.toThrow(TypeError);
  });
});

// ─── findByName ───────────────────────────────────────────────────────────────

describe('findByName', () => {
  it('returns results from the first successful strategy', async () => {
    const users = [makeUser(1), makeUser(2)];
    const strat1 = { name: 's1', fn: alwaysReturns(users) };
    const strat2 = { name: 's2', fn: alwaysEmpty() };

    const search = makeSearch({ nameStrategies: [strat1, strat2] });
    const result = await search.findByName('Alice');

    expect(result).toHaveLength(2);
    expect(strat2.fn).not.toHaveBeenCalled();
  });

  it('falls through strategies until results found', async () => {
    const user = makeUser(5);
    const search = makeSearch({
      nameStrategies: [
        { name: 's1', fn: alwaysEmpty() },
        { name: 's2', fn: alwaysEmpty() },
        { name: 's3', fn: alwaysReturns([user]) },
      ],
    });
    const result = await search.findByName('Alice');
    expect(result[0].id).toBe(5);
  });

  it('returns [] when all strategies empty', async () => {
    const search = makeSearch({
      nameStrategies: [{ name: 's1', fn: alwaysEmpty() }],
    });
    const result = await search.findByName('Zaphod');
    expect(result).toEqual([]);
  });

  it('with all=true: merges results across all strategies and deduplicates', async () => {
    const user1 = makeUser(1);
    const user2 = makeUser(2);
    const user1Dup = makeUser(1); // same id — should be deduped

    const search = makeSearch({
      nameStrategies: [
        { name: 's1', fn: alwaysReturns([user1]) },
        { name: 's2', fn: alwaysReturns([user1Dup, user2]) },
      ],
    });
    const result = await search.findByName('Alice', { all: true });

    expect(result).toHaveLength(2);
    const ids = result.map((u) => u.id).sort();
    expect(ids).toEqual([1, 2]);
  });

  it('throws TypeError for non-string name', async () => {
    const search = makeSearch({ nameStrategies: [] });
    await expect(search.findByName(undefined)).rejects.toThrow(TypeError);
  });
});

// ─── find (auto-routing) ──────────────────────────────────────────────────────

describe('find', () => {
  it('routes email-like query to findByEmail', async () => {
    const user = makeUser(1, { email: 'alice@example.com' });
    const emailFn = alwaysReturns([user]);
    const nameFn = alwaysEmpty();

    const search = makeSearch({
      emailStrategies: [{ name: 'e1', fn: emailFn }],
      nameStrategies: [{ name: 'n1', fn: nameFn }],
    });

    const result = await search.find('alice@example.com');
    expect(result).toHaveLength(1);
    expect(emailFn).toHaveBeenCalled();
    expect(nameFn).not.toHaveBeenCalled();
  });

  it('routes plain name query to findByName', async () => {
    const user = makeUser(2);
    const emailFn = alwaysEmpty();
    const nameFn = alwaysReturns([user]);

    const search = makeSearch({
      emailStrategies: [{ name: 'e1', fn: emailFn }],
      nameStrategies: [{ name: 'n1', fn: nameFn }],
    });

    const result = await search.find('Alice Smith');
    expect(result).toHaveLength(1);
    expect(nameFn).toHaveBeenCalled();
    expect(emailFn).not.toHaveBeenCalled();
  });

  it('returns [] when email search finds nothing', async () => {
    const search = makeSearch({
      emailStrategies: [{ name: 'e1', fn: alwaysEmpty() }],
      nameStrategies: [],
    });
    const result = await search.find('nobody@example.com');
    expect(result).toEqual([]);
  });

  it('throws TypeError for empty query', async () => {
    const search = makeSearch({ emailStrategies: [], nameStrategies: [] });
    await expect(search.find('')).rejects.toThrow(TypeError);
  });
});

// ─── Error re-exports ─────────────────────────────────────────────────────────

describe('error exports', () => {
  it('exports UserVoiceApiError', () => {
    expect(new UserVoiceApiError('x')).toBeInstanceOf(Error);
    expect(new UserVoiceApiError('x').name).toBe('UserVoiceApiError');
  });

  it('exports UserVoiceRateLimitError as subclass of UserVoiceApiError', () => {
    const err = new UserVoiceRateLimitError(30, 'https://x.uservoice.com');
    expect(err).toBeInstanceOf(UserVoiceApiError);
    expect(err.retryAfter).toBe(30);
  });

  it('exports UserVoiceConfigError', () => {
    expect(new UserVoiceConfigError('bad config').name).toBe('UserVoiceConfigError');
  });
});
