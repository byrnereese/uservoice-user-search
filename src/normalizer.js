/**
 * Normalise heterogeneous UserVoice API objects into stable, predictable shapes
 * regardless of which endpoint produced them.
 *
 * Supported shapes:
 *
 *  User (NormalizedUser)
 *    v2 admin users  → { id, name, email, created_at, avatar_url, ... }
 *    v1 search       → { id, name, email, created_at, ... }  (subset)
 *    autocomplete    → { id, name, email, ... }               (minimal)
 *
 *  Account (NormalizedAccount)
 *    v2 admin account → { id, name, external_id, custom_fields, ... }
 *
 *  Supporter (NormalizedSupporter)
 *    v2 supporters   → { id, votes, created_at, user: {...}, ... }
 *                       OR flat user object with supporter metadata
 *
 * Raw payloads are always preserved under `_raw` for callers who need fields
 * not surfaced by the normalised shape.
 */

// ─── User ────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} NormalizedUser
 * @property {number|string}  id
 * @property {string|null}    name
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

// ─── Account ─────────────────────────────────────────────────────────────────

/**
 * @typedef {object} NormalizedAccount
 * @property {number|string}         id
 * @property {string|null}           name
 * @property {string|null}           externalId   Salesforce (or other CRM) record ID
 * @property {string|null}           createdAt    ISO-8601 string or null
 * @property {number|null}           memberCount  number of users in this account
 * @property {Record<string,unknown>} customFields flat map of all custom/synced fields
 * @property {unknown}               _raw         original API object
 */

/**
 * Normalise a single raw account object.
 *
 * Custom fields arrive from the API in one of several shapes depending on
 * UserVoice version and configuration:
 *
 *   - A plain hash: `{ "ARR": 50000, "Plan": "Enterprise" }`
 *   - An array of objects: `[{ "name": "ARR", "value": 50000 }]`
 *
 * Both are flattened into a plain `{ key: value }` map.
 *
 * @param {Record<string, unknown>} raw
 * @returns {NormalizedAccount}
 */
export function normalizeAccount(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new TypeError(`Cannot normalise non-object account: ${JSON.stringify(raw)}`);
  }

  return {
    id: raw.id ?? null,
    name: raw.name ?? null,
    externalId: raw.external_id ?? raw.salesforce_id ?? null,
    createdAt: raw.created_at ?? null,
    memberCount: raw.users_count ?? raw.member_count ?? null,
    customFields: normalizeCustomFields(raw.custom_fields),
    _raw: raw,
  };
}

// ─── Supporter ───────────────────────────────────────────────────────────────

/**
 * @typedef {object} NormalizedSupporter
 * @property {number|string}          id            Supporter record ID (not user ID)
 * @property {number|string|null}     userId        UserVoice user ID
 * @property {string|null}            name          User display name
 * @property {string|null}            email         User email address
 * @property {string|null}            createdAt     ISO-8601 — when the user was created
 * @property {string|null}            avatarUrl
 * @property {string|null}            state
 * @property {string|null}            roles
 * @property {number|null}            votes         Number of votes applied to the suggestion
 * @property {string|null}            supportedAt   ISO-8601 — when this support was recorded
 * @property {NormalizedAccount|null} account       Lightweight account stub (id + name only).
 *                                                  Populated with full custom fields after
 *                                                  getSuggestionSupporterDetails() runs.
 * @property {unknown}                _raw          Original API supporter object
 */

/**
 * Normalise a single raw supporter object as returned by
 * `GET /api/v2/admin/suggestions/:id/supporters`.
 *
 * The API embeds a user sub-object. We hoist the user fields to the top
 * level and keep supporter-specific metadata (votes, supportedAt) alongside.
 *
 * @param {Record<string, unknown>} raw  Raw supporter record
 * @returns {NormalizedSupporter}
 */
export function normalizeSupporter(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new TypeError(`Cannot normalise non-object supporter: ${JSON.stringify(raw)}`);
  }

  // The API embeds the full user object under raw.user, but some endpoint
  // variants return a flat object where the supporter IS the user.
  const user = (raw.user && typeof raw.user === 'object') ? raw.user : raw;

  // Account stub: lightweight reference embedded in the user object.
  // Full account details (with custom_fields) require a separate fetch.
  const rawAccount = user.account ?? user.external_account ?? null;
  const accountStub = rawAccount ? {
    id: rawAccount.id ?? null,
    name: rawAccount.name ?? null,
    externalId: rawAccount.external_id ?? null,
    createdAt: rawAccount.created_at ?? null,
    memberCount: rawAccount.users_count ?? rawAccount.member_count ?? null,
    customFields: normalizeCustomFields(rawAccount.custom_fields),
    _raw: rawAccount,
  } : null;

  return {
    // Supporter record identity
    id: raw.id ?? null,

    // User fields (hoisted)
    userId: user.id ?? null,
    name: user.name ?? user.display_name ?? null,
    email: user.email ?? user.email_address ?? null,
    createdAt: user.created_at ?? null,
    avatarUrl: user.avatar_url ?? user.avatar?.small_url ?? null,
    state: user.state ?? null,
    roles: normalizeRoles(user.roles),

    // Supporter-specific metadata
    votes: raw.votes ?? raw.vote_count ?? null,
    supportedAt: raw.supported_at ?? raw.created_at ?? null,

    // Account (stub until enriched)
    account: accountStub,

    _raw: raw,
  };
}

/**
 * Normalise an array of raw supporter records, silently dropping non-objects.
 *
 * @param {unknown[]} rawList
 * @returns {NormalizedSupporter[]}
 */
export function normalizeSupporters(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .filter((item) => item && typeof item === 'object')
    .map(normalizeSupporter);
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

/**
 * Flatten custom_fields into a plain `{ key: value }` map regardless of
 * whether they arrive as an object or as an array of `{ name, value }` pairs.
 *
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
function normalizeCustomFields(raw) {
  if (!raw) return {};

  // Plain hash — most common: { "ARR": 50000, "Plan": "Enterprise" }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...raw };
  }

  // Array of field objects: [{ name: "ARR", value: 50000 }, ...]
  if (Array.isArray(raw)) {
    return Object.fromEntries(
      raw
        .filter((f) => f && typeof f === 'object' && f.name != null)
        .map((f) => [f.name, f.value ?? null]),
    );
  }

  return {};
}
