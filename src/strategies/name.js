/**
 * Name search strategies.
 *
 * Searching by name is inherently fuzzier than email search. We try three
 * complementary endpoints; each has different strengths:
 *
 *  1. GET /api/v2/admin/users?q=<name>
 *     — The admin full-text search. Returns full user objects with all fields.
 *       Best option when the token has admin scope.
 *
 *  2. GET /api/v2/admin/autocomplete?type=user&q=<name>
 *     — Autocomplete endpoint. Optimised for prefix-matching partial names;
 *       blazing fast but returns fewer fields (id, name, email only).
 *       Useful when strategy 1 returns nothing or errors.
 *
 *  3. GET /api/v1/users/search.json?query=<name>
 *     — Legacy v1 search. Broader support across plan tiers; slower and
 *       returns a limited field set.
 *
 * All strategies return NormalizedUser[] — an empty array means no matches
 * (not an error). Hard errors bubble up to the orchestrator.
 */

import { normalizeUsers } from '../normalizer.js';

// ─── Strategy implementations ────────────────────────────────────────────────

/**
 * Strategy 1 – v2 admin free-text search
 *
 * @param {import('../client.js').Client} client
 * @param {string} name
 * @param {import('../logger.js').Logger} logger
 * @param {object} [opts]
 * @param {number} [opts.perPage]
 * @returns {Promise<import('../normalizer.js').NormalizedUser[]>}
 */
export async function v2AdminQueryName(client, name, logger, { perPage = 25 } = {}) {
  const stratName = 'v2AdminQueryName';
  logger.strategy(stratName, 'start', name);

  const body = await client.get('/api/v2/admin/users', {
    q: name,
    per_page: perPage,
  });

  const users = extractV2Users(body, stratName, logger);
  logger.strategy(stratName, users.length ? 'success' : 'empty', `${users.length} result(s)`);
  return users;
}

/**
 * Strategy 2 – v2 admin autocomplete
 *
 * @param {import('../client.js').Client} client
 * @param {string} name
 * @param {import('../logger.js').Logger} logger
 * @returns {Promise<import('../normalizer.js').NormalizedUser[]>}
 */
export async function v2AdminAutocomplete(client, name, logger) {
  const stratName = 'v2AdminAutocomplete';
  logger.strategy(stratName, 'start', name);

  const body = await client.get('/api/v2/admin/autocomplete', {
    type: 'user',
    q: name,
  });

  const users = extractAutocompleteUsers(body, stratName, logger);
  logger.strategy(stratName, users.length ? 'success' : 'empty', `${users.length} result(s)`);
  return users;
}

/**
 * Strategy 3 – legacy v1 search endpoint
 *
 * @param {import('../client.js').Client} client
 * @param {string} name
 * @param {import('../logger.js').Logger} logger
 * @param {object} [opts]
 * @param {number} [opts.perPage]
 * @returns {Promise<import('../normalizer.js').NormalizedUser[]>}
 */
export async function v1SearchName(client, name, logger, { perPage = 25 } = {}) {
  const stratName = 'v1SearchName';
  logger.strategy(stratName, 'start', name);

  const body = await client.get('/api/v1/users/search.json', {
    query: name,
    per_page: perPage,
    page: 1,
  });

  const users = extractV1Users(body, stratName, logger);
  logger.strategy(stratName, users.length ? 'success' : 'empty', `${users.length} result(s)`);
  return users;
}

// ─── Ordered export for the orchestrator ─────────────────────────────────────

/**
 * All name search strategies in priority order.
 * Each entry is `{ name, fn }`.
 */
export const NAME_STRATEGIES = [
  { name: 'v2AdminQueryName',    fn: v2AdminQueryName },
  { name: 'v2AdminAutocomplete', fn: v2AdminAutocomplete },
  { name: 'v1SearchName',        fn: v1SearchName },
];

// ─── Private helpers ─────────────────────────────────────────────────────────

function extractV2Users(body, strategyName, logger) {
  if (Array.isArray(body?.users)) {
    return normalizeUsers(body.users);
  }
  logger.warn(`${strategyName}: unexpected v2 response shape`, JSON.stringify(body).slice(0, 200));
  return [];
}

function extractAutocompleteUsers(body, strategyName, logger) {
  // Autocomplete response shape: { autocomplete: { users: [...] } }
  const raw = body?.autocomplete?.users ?? body?.users;
  if (Array.isArray(raw)) {
    return normalizeUsers(raw);
  }
  logger.warn(`${strategyName}: unexpected autocomplete response shape`, JSON.stringify(body).slice(0, 200));
  return [];
}

function extractV1Users(body, strategyName, logger) {
  const raw = body?.response ?? body?.users;
  if (Array.isArray(raw)) {
    return normalizeUsers(raw);
  }
  logger.warn(`${strategyName}: unexpected v1 response shape`, JSON.stringify(body).slice(0, 200));
  return [];
}
