/**
 * Email search strategies.
 *
 * UserVoice has no single reliable "search by email" endpoint. Different
 * tenants, token scopes, and plan tiers respond differently to each approach.
 * We run them in priority order and return as soon as one yields a match.
 *
 * Strategy order (highest confidence → lowest):
 *
 *  1. GET /api/v2/admin/users?filter[email]=<email>
 *     — Exact-match filter on the admin users collection.
 *       Most precise when the token has admin scope. Some tenants 400 on this
 *       filter key so we catch that and fall through.
 *
 *  2. GET /api/v2/admin/users?filter[email_or_external_id]=<email>
 *     — Alternative filter key used by some UserVoice versions.
 *
 *  3. GET /api/v2/admin/users?q=<email>
 *     — Free-text search across name + email. Returns ranked results;
 *       we post-filter to the exact email address.
 *
 *  4. GET /api/v1/users/search.json?query=<email>
 *     — Legacy v1 endpoint. Slower, returns fewer fields, but broadly
 *       supported across all plan tiers.
 *
 * Each strategy returns a (possibly empty) NormalizedUser[] or throws on a
 * hard error. The orchestrator in src/index.js handles fallback logic.
 */

import { normalizeUsers } from '../normalizer.js';

// ─── Strategy implementations ────────────────────────────────────────────────

/**
 * Strategy 1 – v2 admin exact filter[email]
 *
 * @param {import('../client.js').Client} client
 * @param {string} email
 * @param {import('../logger.js').Logger} logger
 * @returns {Promise<import('../normalizer.js').NormalizedUser[]>}
 */
export async function v2AdminFilterEmail(client, email, logger) {
  const name = 'v2AdminFilterEmail';
  logger.strategy(name, 'start', email);

  const body = await client.get('/api/v2/admin/users', {
    'filter[email]': email,
    per_page: 10,
  });

  const users = extractUsers(body, name, logger);
  logger.strategy(name, users.length ? 'success' : 'empty', `${users.length} result(s)`);
  return users;
}

/**
 * Strategy 2 – v2 admin exact filter[email_or_external_id]
 *
 * @param {import('../client.js').Client} client
 * @param {string} email
 * @param {import('../logger.js').Logger} logger
 * @returns {Promise<import('../normalizer.js').NormalizedUser[]>}
 */
export async function v2AdminFilterEmailOrId(client, email, logger) {
  const name = 'v2AdminFilterEmailOrId';
  logger.strategy(name, 'start', email);

  const body = await client.get('/api/v2/admin/users', {
    'filter[email_or_external_id]': email,
    per_page: 10,
  });

  const users = extractUsers(body, name, logger);
  logger.strategy(name, users.length ? 'success' : 'empty', `${users.length} result(s)`);
  return users;
}

/**
 * Strategy 3 – v2 admin free-text search, post-filtered by email
 *
 * @param {import('../client.js').Client} client
 * @param {string} email
 * @param {import('../logger.js').Logger} logger
 * @returns {Promise<import('../normalizer.js').NormalizedUser[]>}
 */
export async function v2AdminQueryEmail(client, email, logger) {
  const name = 'v2AdminQueryEmail';
  logger.strategy(name, 'start', email);

  const body = await client.get('/api/v2/admin/users', {
    q: email,
    per_page: 25,
  });

  let users = extractUsers(body, name, logger);

  // Post-filter: the free-text search can return partial matches, so we keep
  // only exact email matches (case-insensitive).
  const emailLower = email.toLowerCase();
  users = users.filter((u) => u.email?.toLowerCase() === emailLower);

  logger.strategy(name, users.length ? 'success' : 'empty', `${users.length} exact match(es) after post-filter`);
  return users;
}

/**
 * Strategy 4 – legacy v1 search endpoint
 *
 * @param {import('../client.js').Client} client
 * @param {string} email
 * @param {import('../logger.js').Logger} logger
 * @returns {Promise<import('../normalizer.js').NormalizedUser[]>}
 */
export async function v1SearchEmail(client, email, logger) {
  const name = 'v1SearchEmail';
  logger.strategy(name, 'start', email);

  const body = await client.get('/api/v1/users/search.json', {
    query: email,
    per_page: 25,
    page: 1,
  });

  let users = extractV1Users(body, name, logger);

  const emailLower = email.toLowerCase();
  users = users.filter((u) => u.email?.toLowerCase() === emailLower);

  logger.strategy(name, users.length ? 'success' : 'empty', `${users.length} exact match(es) after post-filter`);
  return users;
}

// ─── Ordered export for the orchestrator ─────────────────────────────────────

/**
 * All email search strategies in the order they should be attempted.
 * Each entry is `{ name, fn }`.
 */
export const EMAIL_STRATEGIES = [
  { name: 'v2AdminFilterEmail',    fn: v2AdminFilterEmail },
  { name: 'v2AdminFilterEmailOrId', fn: v2AdminFilterEmailOrId },
  { name: 'v2AdminQueryEmail',     fn: v2AdminQueryEmail },
  { name: 'v1SearchEmail',         fn: v1SearchEmail },
];

// ─── Private helpers ─────────────────────────────────────────────────────────

function extractUsers(body, strategyName, logger) {
  if (Array.isArray(body?.users)) {
    return normalizeUsers(body.users);
  }
  logger.warn(`${strategyName}: unexpected response shape`, JSON.stringify(body).slice(0, 200));
  return [];
}

function extractV1Users(body, strategyName, logger) {
  // v1 can return { response: [...] } or { users: [...] }
  const raw = body?.response ?? body?.users;
  if (Array.isArray(raw)) {
    return normalizeUsers(raw);
  }
  logger.warn(`${strategyName}: unexpected v1 response shape`, JSON.stringify(body).slice(0, 200));
  return [];
}
