import { describe, it, expect } from 'vitest';
import { normalizeUser, normalizeUsers } from '../src/normalizer.js';
import { rawV2User, rawV1User } from './helpers.js';

describe('normalizeUser', () => {
  it('maps standard v2 fields correctly', () => {
    const raw = rawV2User();
    const user = normalizeUser(raw);

    expect(user.id).toBe(1001);
    expect(user.name).toBe('Alice Smith');
    expect(user.email).toBe('alice@example.com');
    expect(user.createdAt).toBe('2023-06-01T10:00:00Z');
    expect(user.avatarUrl).toBe('https://cdn.uservoice.com/avatars/alice.jpg');
    expect(user.state).toBe('active');
    expect(user.roles).toBe('owner');
    expect(user._raw).toBe(raw);
  });

  it('maps v1 user fields (subset)', () => {
    const raw = rawV1User();
    const user = normalizeUser(raw);

    expect(user.id).toBe(1001);
    expect(user.name).toBe('Alice Smith');
    expect(user.email).toBe('alice@example.com');
    expect(user.avatarUrl).toBeNull();
    expect(user.state).toBeNull();
  });

  it('falls back to display_name when name is missing', () => {
    const raw = rawV2User({ name: undefined, display_name: 'Alice S.' });
    expect(normalizeUser(raw).name).toBe('Alice S.');
  });

  it('falls back to email_address when email is missing', () => {
    const raw = rawV2User({ email: undefined, email_address: 'alt@example.com' });
    expect(normalizeUser(raw).email).toBe('alt@example.com');
  });

  it('handles array roles', () => {
    const raw = rawV2User({ roles: [{ name: 'admin' }, { name: 'owner' }] });
    expect(normalizeUser(raw).roles).toBe('admin, owner');
  });

  it('handles empty roles array', () => {
    const raw = rawV2User({ roles: [] });
    expect(normalizeUser(raw).roles).toBeNull();
  });

  it('throws on a non-object input', () => {
    expect(() => normalizeUser(null)).toThrow(TypeError);
    expect(() => normalizeUser('string')).toThrow(TypeError);
  });
});

describe('normalizeUsers', () => {
  it('normalises an array of raw users', () => {
    const raw = [rawV2User({ id: 1 }), rawV2User({ id: 2 })];
    const users = normalizeUsers(raw);
    expect(users).toHaveLength(2);
    expect(users[0].id).toBe(1);
    expect(users[1].id).toBe(2);
  });

  it('returns [] for non-array input', () => {
    expect(normalizeUsers(null)).toEqual([]);
    expect(normalizeUsers(undefined)).toEqual([]);
    expect(normalizeUsers({})).toEqual([]);
  });

  it('silently drops non-object items', () => {
    const raw = [rawV2User(), null, 'bad', undefined, rawV2User({ id: 2 })];
    const users = normalizeUsers(raw);
    expect(users).toHaveLength(2);
  });
});
