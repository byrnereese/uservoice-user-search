/**
 * Integration-style tests for UserVoiceSearch.getSuggestionSupporterDetails()
 * — the full pipeline: supporters → account batch fetch → merged result.
 */

import { describe, it, expect, vi } from 'vitest';
import { UserVoiceSearch } from '../src/index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rawSupporter(id, accountId) {
  return {
    id,
    votes: 2,
    supported_at: '2024-03-01T00:00:00Z',
    user: {
      id: id * 10,
      name: `User ${id}`,
      email: `user${id}@example.com`,
      account: accountId ? { id: accountId, name: `Company ${accountId}` } : null,
    },
  };
}

function rawAccount(id, customFields = {}) {
  return {
    id,
    name: `Company ${id}`,
    external_id: `SF_${id}`,
    created_at: '2022-01-01T00:00:00Z',
    custom_fields: customFields,
  };
}

/**
 * Build a UserVoiceSearch with a mock client that handles both the
 * supporters endpoint and individual account endpoints.
 */
function makeSearch(supporters, accountCustomFields = {}) {
  const search = new UserVoiceSearch({ subdomain: 'test', token: 'tok' });

  search._client.get = vi.fn((path) => {
    // Supporters endpoint
    if (path.includes('/supporters')) {
      return Promise.resolve({
        supporters,
        pagination: { total_records: supporters.length, page: 1, per_page: 100 },
      });
    }

    // Account endpoint: /api/v2/admin/accounts/:id
    const idMatch = path.match(/\/accounts\/(\d+)$/);
    if (idMatch) {
      const id = Number(idMatch[1]);
      const cf = accountCustomFields[id] ?? {};
      return Promise.resolve({ account: rawAccount(id, cf) });
    }

    return Promise.resolve({});
  });

  return search;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('getSuggestionSupporterDetails', () => {
  it('returns enriched supporters with customFields', async () => {
    const search = makeSearch(
      [rawSupporter(1, 100), rawSupporter(2, 200)],
      { 100: { ARR: 50000, Plan: 'Enterprise' }, 200: { ARR: 12000, Plan: 'Starter' } },
    );

    const rows = await search.getSuggestionSupporterDetails(999);

    expect(rows).toHaveLength(2);

    const alice = rows.find((r) => r.userId === 10);
    expect(alice.name).toBe('User 1');
    expect(alice.votes).toBe(2);
    expect(alice.account.name).toBe('Company 100');
    expect(alice.account.customFields.ARR).toBe(50000);
    expect(alice.account.customFields.Plan).toBe('Enterprise');
  });

  it('deduplicates accounts (two supporters same company)', async () => {
    const search = makeSearch(
      [rawSupporter(1, 100), rawSupporter(2, 100)], // both belong to account 100
      { 100: { ARR: 75000 } },
    );

    const rows = await search.getSuggestionSupporterDetails(1);

    expect(rows).toHaveLength(2);
    // Account should have been fetched only once
    const accountGetCalls = search._client.get.mock.calls.filter(([p]) =>
      p.includes('/accounts/'),
    );
    expect(accountGetCalls).toHaveLength(1);

    expect(rows[0].account.customFields.ARR).toBe(75000);
    expect(rows[1].account.customFields.ARR).toBe(75000);
  });

  it('returns supporters with null account when fetch fails (partial failure)', async () => {
    const search = makeSearch([rawSupporter(1, 100), rawSupporter(2, 200)]);

    // Override: account 200 fails
    const originalGet = search._client.get;
    search._client.get = vi.fn((path) => {
      if (path === '/api/v2/admin/accounts/200') {
        return Promise.reject(new Error('403 Forbidden'));
      }
      return originalGet(path);
    });

    const rows = await search.getSuggestionSupporterDetails(1);

    expect(rows).toHaveLength(2);
    const row100 = rows.find((r) => r.account?.id === 100);
    const row200 = rows.find((r) => r.account?.id === 200);

    // Account 100 resolved fine
    expect(row100.account.name).toBe('Company 100');
    // Account 200 failed — stub is preserved unchanged
    expect(row200.account.id).toBe(200);
    expect(row200.account.customFields).toEqual({});
  });

  it('returns [] when suggestion has no supporters', async () => {
    const search = new UserVoiceSearch({ subdomain: 'test', token: 'tok' });
    search._client.get = vi.fn().mockResolvedValue({
      supporters: [],
      pagination: { total_records: 0, page: 1, per_page: 100 },
    });

    const rows = await search.getSuggestionSupporterDetails(404);
    expect(rows).toEqual([]);
  });

  it('supporters with no account are included without account data', async () => {
    const search = makeSearch([rawSupporter(1, null)]); // no account

    const rows = await search.getSuggestionSupporterDetails(1);

    expect(rows).toHaveLength(1);
    expect(rows[0].account).toBeNull();
  });

  it('throws TypeError when suggestionId is missing', async () => {
    const search = new UserVoiceSearch({ subdomain: 'test', token: 'tok' });
    await expect(search.getSuggestionSupporterDetails()).rejects.toThrow(TypeError);
  });
});

describe('getSuggestionSupporters (without account enrichment)', () => {
  it('returns normalised supporters without fetching accounts', async () => {
    const search = new UserVoiceSearch({ subdomain: 'test', token: 'tok' });
    search._client.get = vi.fn().mockResolvedValue({
      supporters: [rawSupporter(1, 100)],
      pagination: { total_records: 1, page: 1, per_page: 100 },
    });

    const supporters = await search.getSuggestionSupporters(42);

    expect(supporters).toHaveLength(1);
    expect(supporters[0].account.id).toBe(100);
    // customFields not populated — only stub
    expect(supporters[0].account.customFields).toEqual({});

    // Should NOT have called the accounts endpoint
    expect(search._client.get.mock.calls.every(([p]) => !p.includes('/accounts/'))).toBe(true);
  });
});

describe('getAccountDetails', () => {
  it('fetches and returns a full account', async () => {
    const search = new UserVoiceSearch({ subdomain: 'test', token: 'tok' });
    search._client.get = vi.fn().mockResolvedValue({
      account: rawAccount(789, { ARR: 30000, Industry: 'Fintech' }),
    });

    const account = await search.getAccountDetails(789);

    expect(account.id).toBe(789);
    expect(account.customFields.ARR).toBe(30000);
    expect(account.customFields.Industry).toBe('Fintech');
    expect(search._client.get).toHaveBeenCalledWith('/api/v2/admin/accounts/789');
  });

  it('throws TypeError when accountId is missing', async () => {
    const search = new UserVoiceSearch({ subdomain: 'test', token: 'tok' });
    await expect(search.getAccountDetails()).rejects.toThrow(TypeError);
  });
});
