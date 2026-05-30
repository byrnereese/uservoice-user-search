import { describe, it, expect, vi } from 'vitest';
import { fetchSuggestionSupporters } from '../src/supporters.js';
import { silentLogger } from './helpers.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rawSupporter(id, overrides = {}) {
  return {
    id,
    votes: 1,
    created_at: '2024-01-15T10:00:00Z',
    supported_at: '2024-01-15T10:00:00Z',
    user: {
      id: id * 10,
      name: `User ${id}`,
      email: `user${id}@example.com`,
      created_at: '2023-06-01T00:00:00Z',
      account: {
        id: id * 100,
        name: `Company ${id}`,
        external_id: `SF_00${id}`,
      },
    },
    ...overrides,
  };
}

function supporterPage(supporters, page, perPage, total) {
  return {
    supporters,
    pagination: { page, per_page: perPage, total_records: total },
  };
}

// ─── fetchSuggestionSupporters ────────────────────────────────────────────────

describe('fetchSuggestionSupporters', () => {
  it('fetches a single page of supporters', async () => {
    const raw = [rawSupporter(1), rawSupporter(2)];
    const client = { get: vi.fn().mockResolvedValue(supporterPage(raw, 1, 100, 2)) };

    const result = await fetchSuggestionSupporters(client, 42, silentLogger);

    expect(result).toHaveLength(2);
    expect(client.get).toHaveBeenCalledOnce();
    expect(client.get).toHaveBeenCalledWith('/api/v2/admin/suggestions/42/supporters', {
      page: 1,
      per_page: 100,
    });
  });

  it('auto-paginates across multiple pages', async () => {
    const page1 = Array.from({ length: 3 }, (_, i) => rawSupporter(i + 1));
    const page2 = Array.from({ length: 2 }, (_, i) => rawSupporter(i + 4));

    const client = {
      get: vi.fn()
        .mockResolvedValueOnce(supporterPage(page1, 1, 3, 5))
        .mockResolvedValueOnce(supporterPage(page2, 2, 3, 5)),
    };

    const result = await fetchSuggestionSupporters(client, 99, silentLogger, { perPage: 3 });

    expect(result).toHaveLength(5);
    expect(client.get).toHaveBeenCalledTimes(2);
  });

  it('respects limit option and stops early', async () => {
    const raw = Array.from({ length: 5 }, (_, i) => rawSupporter(i + 1));
    const client = { get: vi.fn().mockResolvedValue(supporterPage(raw, 1, 100, 100)) };

    const result = await fetchSuggestionSupporters(client, 42, silentLogger, { limit: 3 });

    expect(result).toHaveLength(3);
  });

  it('stops when fewer records than perPage returned (no pagination metadata)', async () => {
    // API returns only 2 records with per_page=10 — no more pages
    const raw = [rawSupporter(1), rawSupporter(2)];
    const client = { get: vi.fn().mockResolvedValue({ supporters: raw }) };

    const result = await fetchSuggestionSupporters(client, 7, silentLogger, { perPage: 10 });

    expect(result).toHaveLength(2);
    expect(client.get).toHaveBeenCalledOnce(); // only one page fetched
  });

  it('normalises supporter records correctly', async () => {
    const client = {
      get: vi.fn().mockResolvedValue(supporterPage([rawSupporter(1)], 1, 100, 1)),
    };

    const [s] = await fetchSuggestionSupporters(client, 1, silentLogger);

    expect(s.id).toBe(1);                        // supporter record id
    expect(s.userId).toBe(10);                   // user.id hoisted
    expect(s.name).toBe('User 1');
    expect(s.email).toBe('user1@example.com');
    expect(s.votes).toBe(1);
    expect(s.supportedAt).toBe('2024-01-15T10:00:00Z');
    expect(s.account).not.toBeNull();
    expect(s.account.id).toBe(100);
    expect(s.account.name).toBe('Company 1');
    expect(s.account.externalId).toBe('SF_001');
  });

  it('handles flat supporter objects (no nested user)', async () => {
    // Some API variants return a flat user object as the supporter
    const flatSupporter = {
      id: 55,
      name: 'Flat User',
      email: 'flat@example.com',
      votes: 2,
    };
    const client = { get: vi.fn().mockResolvedValue({ supporters: [flatSupporter] }) };

    const [s] = await fetchSuggestionSupporters(client, 1, silentLogger);

    expect(s.name).toBe('Flat User');
    expect(s.votes).toBe(2);
  });

  it('returns [] and logs warning on unexpected response shape', async () => {
    const warnLogger = { ...silentLogger, warn: vi.fn() };
    const client = { get: vi.fn().mockResolvedValue({ unexpected: 'shape' }) };

    const result = await fetchSuggestionSupporters(client, 1, warnLogger);

    expect(result).toEqual([]);
    expect(warnLogger.warn).toHaveBeenCalled();
  });

  it('bubbles errors from the client', async () => {
    const client = { get: vi.fn().mockRejectedValue(new Error('network fail')) };
    await expect(fetchSuggestionSupporters(client, 1, silentLogger)).rejects.toThrow('network fail');
  });

  // ─── forumId / URL scoping ────────────────────────────────────────────────

  it('uses the scoped URL when forumId is provided', async () => {
    const raw = [rawSupporter(1)];
    const client = { get: vi.fn().mockResolvedValue(supporterPage(raw, 1, 100, 1)) };

    await fetchSuggestionSupporters(client, 42, silentLogger, { forumId: 7 });

    expect(client.get).toHaveBeenCalledWith(
      '/api/v2/admin/forums/7/suggestions/42/supporters',
      expect.any(Object),
    );
  });

  it('falls back to the unscoped URL when the scoped URL returns 404', async () => {
    const { UserVoiceApiError } = await import('../src/errors.js');
    const raw = [rawSupporter(1)];

    const client = {
      get: vi.fn()
        .mockRejectedValueOnce(Object.assign(new UserVoiceApiError('not found', { status: 404 }), {}))
        .mockResolvedValueOnce(supporterPage(raw, 1, 100, 1)),
    };

    const result = await fetchSuggestionSupporters(client, 42, silentLogger, { forumId: 7 });

    expect(result).toHaveLength(1);
    // Second call must be the unscoped path
    expect(client.get).toHaveBeenNthCalledWith(
      2,
      '/api/v2/admin/suggestions/42/supporters',
      expect.any(Object),
    );
  });

  it('uses the unscoped URL directly when forumId is omitted', async () => {
    const raw = [rawSupporter(1)];
    const client = { get: vi.fn().mockResolvedValue(supporterPage(raw, 1, 100, 1)) };

    await fetchSuggestionSupporters(client, 42, silentLogger);

    expect(client.get).toHaveBeenCalledWith(
      '/api/v2/admin/suggestions/42/supporters',
      expect.any(Object),
    );
    expect(client.get).toHaveBeenCalledTimes(1);
  });

  it('rethrows 404 when no fallback path is available (no forumId)', async () => {
    const { UserVoiceApiError } = await import('../src/errors.js');
    const err = Object.assign(new UserVoiceApiError('not found', { status: 404 }), {});

    const client = { get: vi.fn().mockRejectedValue(err) };

    await expect(fetchSuggestionSupporters(client, 42, silentLogger)).rejects.toThrow('not found');
  });
});
