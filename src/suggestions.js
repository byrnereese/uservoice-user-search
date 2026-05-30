/**
 * Fetch a single suggestion by ID from the UserVoice API.
 *
 * Endpoint: GET /api/v2/admin/suggestions/:id?includes=forums
 *
 * The suggestion object includes rich pre-computed Salesforce-synced aggregated
 * data (cv_* fields) as well as supporter aggregate metrics (supporter_mrr,
 * supporting_accounts_count, etc.). This makes it possible to retrieve all the
 * information needed for a sync job in a single API call without having to
 * enumerate individual supporters.
 *
 * Forum ID extraction
 * ───────────────────
 * This endpoint uses JSON API sideloading. The forum ID is NOT at
 * `suggestion.forum.id` — it lives in the links object alongside the
 * suggestion in the response envelope:
 *
 *   body.suggestions[0].links.forum  → forum ID
 *
 * We extract it automatically and surface it as `suggestion.forumId`.
 */

import { normalizeSuggestion } from './normalizer.js';
import { UserVoiceApiError } from './errors.js';

/**
 * Fetch a single suggestion by ID.
 *
 * @param {import('./client.js').Client}   client
 * @param {number|string}                 suggestionId
 * @param {import('./logger.js').Logger}   logger
 * @returns {Promise<import('./normalizer.js').NormalizedSuggestion>}
 */
export async function fetchSuggestion(client, suggestionId, logger) {
  logger.info(`fetchSuggestion: #${suggestionId}`);

  const body = await client.get(
    `/api/v2/admin/suggestions/${suggestionId}`,
    { includes: 'forums' },
  );

  // The endpoint wraps results in a `suggestions` array (JSON API collection
  // envelope) even for a single-ID lookup.
  const raw = Array.isArray(body?.suggestions)
    ? body.suggestions[0]
    : body?.suggestion ?? null;

  if (!raw || typeof raw !== 'object') {
    throw new UserVoiceApiError(
      `fetchSuggestion: unexpected response for suggestion #${suggestionId}`,
      { body },
    );
  }

  // JSON API sideloading: forum ID lives in the links object next to the raw
  // suggestion record, not nested inside it.
  const links = (Array.isArray(body?.suggestions) ? body.suggestions[0]?.links : raw?.links) ?? {};

  return normalizeSuggestion(raw, links);
}
