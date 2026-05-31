import { describe, it, expect, vi } from 'vitest';
import {
  v2AdminFilterEmail,
  v2AdminFilterEmailOrId,
  v2AdminQueryEmail,
  v1SearchEmail,
} from '../src/strategies/email.js';
import {
  rawV2User,
  rawV1User,
  v2Response,
  v1Response,
  silentLogger,
} from './helpers.js';

// ─── v2AdminFilterEmail ───────────────────────────────────────────────────────

describe('v2AdminFilterEmail', () => {
  it('returns matching users', async () => {
    const client = { get: vi.fn().mockResolvedValue(v2Response([rawV2User()])) };
    const users = await v2AdminFilterEmail(client, 'alice@example.com', silentLogger);

    expect(users).toHaveLength(1);
    expect(users[0].email).toBe('alice@example.com');
    expect(client.get).toHaveBeenCalledWith('/api/v2/admin/users', {
      'filter[email]': 'alice@example.com',
      per_page: 10,
    });
  });

  it('returns [] when response contains no users', async () => {
    const client = { get: vi.fn().mockResolvedValue(v2Response([])) };
    const users = await v2AdminFilterEmail(client, 'nobody@example.com', silentLogger);
    expect(users).toEqual([]);
  });

  it('returns [] when the server ignores the filter and returns unrelated users', async () => {
    // On some instances (e.g. ideas.ringcentral.com) filter[email] is silently
    // ignored and the response contains arbitrary users — guard against returning
    // the wrong person.
    const client = {
      get: vi.fn().mockResolvedValue(
        v2Response([rawV2User({ id: 99, email: 'someone_else@example.com' })]),
      ),
    };
    const users = await v2AdminFilterEmail(client, 'alice@example.com', silentLogger);
    expect(users).toEqual([]);
  });

  it('bubbles errors from the client', async () => {
    const err = new Error('network fail');
    const client = { get: vi.fn().mockRejectedValue(err) };
    await expect(v2AdminFilterEmail(client, 'x@x.com', silentLogger)).rejects.toThrow('network fail');
  });
});

// ─── v2AdminFilterEmailOrId ───────────────────────────────────────────────────

describe('v2AdminFilterEmailOrId', () => {
  it('calls the correct filter param', async () => {
    const client = { get: vi.fn().mockResolvedValue(v2Response([rawV2User()])) };
    await v2AdminFilterEmailOrId(client, 'alice@example.com', silentLogger);

    expect(client.get).toHaveBeenCalledWith('/api/v2/admin/users', {
      'filter[email_or_external_id]': 'alice@example.com',
      per_page: 10,
    });
  });

  it('returns [] when the server ignores the filter and returns unrelated users', async () => {
    const client = {
      get: vi.fn().mockResolvedValue(
        v2Response([rawV2User({ id: 99, email: 'someone_else@example.com' })]),
      ),
    };
    const users = await v2AdminFilterEmailOrId(client, 'alice@example.com', silentLogger);
    expect(users).toEqual([]);
  });
});

// ─── v2AdminQueryEmail ────────────────────────────────────────────────────────

describe('v2AdminQueryEmail', () => {
  it('post-filters to exact email match', async () => {
    const client = {
      get: vi.fn().mockResolvedValue(
        v2Response([
          rawV2User({ id: 1, email: 'alice@example.com' }),
          rawV2User({ id: 2, email: 'alicejr@example.com' }), // partial match — must be excluded
        ]),
      ),
    };
    const users = await v2AdminQueryEmail(client, 'alice@example.com', silentLogger);
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe(1);
  });

  it('is case-insensitive in post-filter', async () => {
    const client = {
      get: vi.fn().mockResolvedValue(v2Response([rawV2User({ email: 'ALICE@EXAMPLE.COM' })])),
    };
    const users = await v2AdminQueryEmail(client, 'alice@example.com', silentLogger);
    expect(users).toHaveLength(1);
  });

  it('returns [] when no exact match found', async () => {
    const client = {
      get: vi.fn().mockResolvedValue(v2Response([rawV2User({ email: 'other@example.com' })])),
    };
    const users = await v2AdminQueryEmail(client, 'alice@example.com', silentLogger);
    expect(users).toEqual([]);
  });
});

// ─── v1SearchEmail ────────────────────────────────────────────────────────────

describe('v1SearchEmail', () => {
  it('uses v1 endpoint and post-filters', async () => {
    const client = {
      get: vi.fn().mockResolvedValue(
        v1Response([
          rawV1User({ id: 1, email: 'alice@example.com' }),
          rawV1User({ id: 2, email: 'bob@example.com' }),
        ]),
      ),
    };
    const users = await v1SearchEmail(client, 'alice@example.com', silentLogger);

    expect(users).toHaveLength(1);
    expect(users[0].id).toBe(1);
    expect(client.get).toHaveBeenCalledWith('/api/v1/users/search.json', {
      query: 'alice@example.com',
      per_page: 25,
      page: 1,
    });
  });

  it('handles { users: [...] } v1 shape as fallback', async () => {
    const client = {
      get: vi.fn().mockResolvedValue({ users: [rawV1User()] }),
    };
    const users = await v1SearchEmail(client, 'alice@example.com', silentLogger);
    expect(users).toHaveLength(1);
  });
});
