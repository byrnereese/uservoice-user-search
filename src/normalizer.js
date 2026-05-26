/**
 * Normalise heterogeneous UserVoice API user objects into a single stable
 * shape regardless of which API endpoint produced them.
 *
 * The UserVoice API returns slightly different structures depending on the
 * endpoint:
 *
 *  v2 admin users  → { id, name, email, created_at, avatar_url, ... }
 *  v1 search       → { id, name, email, created_at, ... }  (subset)
 *  autocomplete    → { id, name, email, ... }               (minimal)
 *
 * We surface a clean, predictable object and stash the raw payload under
 * `_raw` for callers who need more detail.
 */

/**
 * @typedef {object} NormalizedUser
 * @property {number|string}  id
 * @property {string}         name
 * @property {string|null}    email
 * @property {string|null}    createdAt   ISO-8601 string or null
 * @property {string|null}    avatarUrl
 * @property {string|null}    state       e.g. "active", "blocked"
 * @property {string|null}    roles       comma-separated role list or null
 * @property {unknown}        _raw        original API object
 */

/**
 * Normalise a single raw user object.
 *
 * @param {Record<string, unknown>} raw
 * @returns {NormalizedUser}
 */
export function normalizeUser(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new TypeError(`Cannot normalise non-object user: ${JSON.stringify(raw)}`);
  }

  return {
    id: raw.id ?? null,
    name: raw.name ?? raw.display_name ?? null,
    email: raw.email ?? raw.email_address ?? null,
    createdAt: raw.created_at ?? null,
    avatarUrl: raw.avatar_url ?? raw.avatar?.small_url ?? null,
    state: raw.state ?? null,
    // v2 admin exposes roles as an array of objects { name } or a string
    roles: normalizeRoles(raw.roles),
    _raw: raw,
  };
}

/**
 * Normalise an array of raw users, silently dropping any non-objects.
 *
 * @param {unknown[]} rawList
 * @returns {NormalizedUser[]}
 */
export function normalizeUsers(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .filter((item) => item && typeof item === 'object')
    .map(normalizeUser);
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function normalizeRoles(roles) {
  if (!roles) return null;
  if (typeof roles === 'string') return roles || null;
  if (Array.isArray(roles)) {
    const names = roles
      .map((r) => (typeof r === 'string' ? r : r?.name ?? r?.label))
      .filter(Boolean);
    return names.length ? names.join(', ') : null;
  }
  return null;
}
