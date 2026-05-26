import { describe, it, expect, vi } from 'vitest';
import {
  v2AdminQueryName,
  v2AdminAutocomplete,
  v1SearchName,
} from '../src/strategies/name.js';
import {
  rawV2User,
  rawV1User,
  v2Response,
  v1Response,
  autocompleteResponse,
  silentLogger,
} from './helpers.js';

describe('v2AdminQueryName', () => {
  it('returns matching users', async () => {
    const client = {
      get: vi.fn().mockResolvedValue(v2Response([rawV2User()])),
    };
    const users = await v2AdminQueryName(client, 'Alice Smith', silentLogger);

    expect(users).toHaveLength(1);
    expect(users[0].name).toBe('Alice Smith');
    expect(client.get).toHaveBeenCalledWith('/api/v2/admin/users', {
      q: 'Alice Smith',
      per_page: 25,
    });
  });

  it('respects perPage option', async () => {
    const client = { get: vi.fn().mockResolvedValue(v2Response([])) };
    await v2AdminQueryName(client, 'Alice', silentLogger, { perPage: 50 });
    expect(client.get).toHaveBeenCalledWith('/api/v2/admin/users', { q: 'Alice', per_page: 50 });
  });

  it('returns [] when no results', async () => {
    const client = { get: vi.fn().mockResolvedValue(v2Response([])) };
    const users = await v2AdminQueryName(client, 'Zaphod', silentLogger);
    expect(users).toEqual([]);
  });
});

describe('v2AdminAutocomplete', () => {
  it('parses autocomplete response shape', async () => {
    const client = {
      get: vi.fn().mockResolvedValue(autocompleteResponse([rawV2User()])),
    };
    const users = await v2AdminAutocomplete(client, 'Alice', silentLogger);

    expect(users).toHaveLength(1);
    expect(client.get).toHaveBeenCalledWith('/api/v2/admin/autocomplete', {
      type: 'user',
      q: 'Alice',
    });
  });

  it('falls back to { users: [...] } shape', async () => {
    const client = {
      get: vi.fn().mockResolvedValue({ users: [rawV2User()] }),
    };
    const users = await v2AdminAutocomplete(client, 'Alice', silentLogger);
    expect(users).toHaveLength(1);
  });

  it('returns [] for unexpected shape', async () => {
    const client = { get: vi.fn().mockResolvedValue({ something: 'else' }) };
    const users = await v2AdminAutocomplete(client, 'Alice', silentLogger);
    expect(users).toEqual([]);
  });
});

describe('v1SearchName', () => {
  it('calls v1 endpoint', async () => {
    const client = {
      get: vi.fn().mockResolvedValue(v1Response([rawV1User()])),
    };
    const users = await v1SearchName(client, 'Alice Smith', silentLogger);

    expect(users).toHaveLength(1);
    expect(client.get).toHaveBeenCalledWith('/api/v1/users/search.json', {
      query: 'Alice Smith',
      per_page: 25,
      page: 1,
    });
  });
});
