import { describe, it, expect, vi } from 'vitest';
import { fetchAccount, fetchAccounts, mergeAccountsIntoSupporters } from '../src/accounts.js';
import { UserVoiceApiError } from '../src/errors.js';
import { silentLogger } from './helpers.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rawAccount(id, customFields = {}) {
  return {
    id,
    name: `Company ${id}`,
    external_id: `SF_00${id}`,
    created_at: '2022-01-01T00:00:00Z',
    users_count: 5,
    custom_fields: customFields,
  };
}

function accountResponse(raw) {
  return { account: raw };
}

function makeSupporter(id, accountId) {
  return {
    id,
    userId: id * 10,
    name: `User ${id}`,
    email: `user${id}@example.com`,
    createdAt: '2023-01-01T00:00:00Z',
    avatarUrl: null,
    state: 'active',
    roles: null,
    votes: 1,
    supportedAt: '2024-01-01T00:00:00Z',
    account: accountId ? { id: accountId, name: `Company ${accountId}`, externalId: null, createdAt: null, memberCount: null, customFields: {}, _raw: {} } : null,
    _raw: {},
  };
}

// ─── fetchAccount ─────────────────────────────────────────────────────────────

describe('fetchAccount', () => {
  it('fetches and normalises a single account', async () => {
    const raw = rawAccount(789, { ARR: 50000, Plan: 'Enterprise' });
    const client = { get: vi.fn().mockResolvedValue(accountResponse(raw)) };

    const account = await fetchAccount(client, 789, silentLogger);

    expect(client.get).toHaveBeenCalledWith('/api/v2/admin/accounts/789');
    expect(account.id).toBe(789);
    expect(account.name).toBe('Company 789');
    expect(account.externalId).toBe('SF_00789');
    expect(account.memberCount).toBe(5);
    expect(account.customFields).toEqual({ ARR: 50000, Plan: 'Enterprise' });
    expect(account._raw).toBe(raw);
  });

  it('handles response where account is at root (no wrapper)', async () => {
    const raw = rawAccount(1);
    const client = { get: vi.fn().mockResolvedValue(raw) };

    const account = await fetchAccount(client, 1, silentLogger);
    expect(account.id).toBe(1);
  });

  it('handles custom_fields as array of { name, value } objects', async () => {
    const raw = rawAccount(2, undefined);
    raw.custom_fields = [
      { name: 'Industry', value: 'Technology' },
      { name: 'ARR', value: 120000 },
    ];
    const client = { get: vi.fn().mockResolvedValue(accountResponse(raw)) };

    const account = await fetchAccount(client, 2, silentLogger);
    expect(account.customFields).toEqual({ Industry: 'Technology', ARR: 120000 });
  });

  it('returns empty customFields when custom_fields is missing', async () => {
    const raw = { id: 3, name: 'Minimal Corp' };
    const client = { get: vi.fn().mockResolvedValue(accountResponse(raw)) };

    const account = await fetchAccount(client, 3, silentLogger);
    expect(account.customFields).toEqual({});
  });

  it('throws UserVoiceApiError on unexpected response body', async () => {
    const client = { get: vi.fn().mockResolvedValue(null) };
    await expect(fetchAccount(client, 1, silentLogger)).rejects.toThrow(UserVoiceApiError);
  });

  it('bubbles client errors', async () => {
    const client = { get: vi.fn().mockRejectedValue(new Error('timeout')) };
    await expect(fetchAccount(client, 1, silentLogger)).rejects.toThrow('timeout');
  });
});

// ─── fetchAccounts (batch) ────────────────────────────────────────────────────

describe('fetchAccounts', () => {
  it('fetches multiple accounts and returns a Map keyed by id', async () => {
    const client = {
      get: vi.fn((path) => {
        const id = Number(path.split('/').pop());
        return Promise.resolve(accountResponse(rawAccount(id)));
      }),
    };

    const map = await fetchAccounts(client, [1, 2, 3], silentLogger);

    expect(map.size).toBe(3);
    expect(map.get('1').name).toBe('Company 1');
    expect(map.get('2').name).toBe('Company 2');
    expect(map.get('3').name).toBe('Company 3');
  });

  it('deduplicates account IDs', async () => {
    const client = {
      get: vi.fn().mockResolvedValue(accountResponse(rawAccount(10))),
    };

    await fetchAccounts(client, [10, 10, 10], silentLogger);
    expect(client.get).toHaveBeenCalledOnce();
  });

  it('tolerates individual account fetch failures (partial failure)', async () => {
    const warnLogger = { ...silentLogger, warn: vi.fn(), info: vi.fn() };
    const client = {
      get: vi.fn((path) => {
        const id = Number(path.split('/').pop());
        if (id === 2) return Promise.reject(new UserVoiceApiError('not found', { status: 404 }));
        return Promise.resolve(accountResponse(rawAccount(id)));
      }),
    };

    const map = await fetchAccounts(client, [1, 2, 3], warnLogger);

    // Only 2 should succeed
    expect(map.size).toBe(2);
    expect(map.has('1')).toBe(true);
    expect(map.has('2')).toBe(false);  // failed silently
    expect(map.has('3')).toBe(true);
    expect(warnLogger.warn).toHaveBeenCalled();
  });

  it('respects concurrency limit', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const client = {
      get: vi.fn(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
        return accountResponse(rawAccount(1));
      }),
    };

    await fetchAccounts(client, [1, 2, 3, 4, 5, 6], silentLogger, { concurrency: 2 });
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('returns empty Map for empty input', async () => {
    const client = { get: vi.fn() };
    const map = await fetchAccounts(client, [], silentLogger);
    expect(map.size).toBe(0);
    expect(client.get).not.toHaveBeenCalled();
  });
});

// ─── mergeAccountsIntoSupporters ─────────────────────────────────────────────

describe('mergeAccountsIntoSupporters', () => {
  it('replaces account stub with full account data', () => {
    const supporters = [
      makeSupporter(1, 100),
      makeSupporter(2, 200),
    ];

    const accountMap = new Map([
      ['100', { id: 100, name: 'Co A', customFields: { ARR: 50000 }, _raw: {} }],
      ['200', { id: 200, name: 'Co B', customFields: { ARR: 99000 }, _raw: {} }],
    ]);

    const merged = mergeAccountsIntoSupporters(supporters, accountMap);

    expect(merged[0].account.customFields.ARR).toBe(50000);
    expect(merged[1].account.customFields.ARR).toBe(99000);
  });

  it('leaves supporters unchanged when their account is not in the map', () => {
    const supporters = [makeSupporter(1, 100)];
    const accountMap = new Map(); // empty

    const merged = mergeAccountsIntoSupporters(supporters, accountMap);

    // Account stub is preserved as-is
    expect(merged[0].account?.id).toBe(100);
    expect(merged[0].account?.customFields).toEqual({});
  });

  it('leaves supporters with no account unchanged', () => {
    const supporters = [makeSupporter(1, null)]; // no account
    const accountMap = new Map([['1', { id: 1, name: 'Co', customFields: {} }]]);

    const merged = mergeAccountsIntoSupporters(supporters, accountMap);

    expect(merged[0].account).toBeNull();
  });

  it('does not mutate the original supporter objects', () => {
    const supporters = [makeSupporter(1, 100)];
    const accountMap = new Map([
      ['100', { id: 100, name: 'Co A', customFields: { Plan: 'Pro' } }],
    ]);

    const merged = mergeAccountsIntoSupporters(supporters, accountMap);

    // Original is unchanged
    expect(supporters[0].account.customFields).toEqual({});
    // Merged copy has the full data
    expect(merged[0].account.customFields.Plan).toBe('Pro');
  });
});
