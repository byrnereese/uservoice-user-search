/**
 * Fetch supporters for a UserVoice suggestion.
 *
 * Endpoint: GET /api/v2/admin/suggestions/:id/supporters
 *
 * The endpoint is paginated. This module handles auto-pagination so callers
 * always receive the complete supporter list without managing page state.
 *
 * Each supporter record embeds a lightweight user object and (when present)
 * a lightweight account stub. Full account details — including custom_fields —
 * require a separate fetch via src/accounts.js.
 */

import { normalizeSupporters } from './normalizer.js';

const DEFAULT_PER_PAGE = 100; // maximum page size UserVoice accepts

/**
 * Fetch all supporters for a suggestion, auto-paginating through every page.
 *
 * @param {import('./client.js').Client}   client
 * @param {number|string}                 suggestionId
 * @param {import('./logger.js').Logger}   logger
 * @param {object}                        [opts]
 * @param {number}                        [opts.perPage=100]  Records per page (max 100)
 * @param {number|null}                   [opts.limit=null]   Cap the total number of
 *                                                            supporters returned.
 *                                                            null = fetch all pages.
 * @returns {Promise<import('./normalizer.js').NormalizedSupporter[]>}
 */
export async function fetchSuggestionSupporters(client, suggestionId, logger, {
  perPage = DEFAULT_PER_PAGE,
  limit = null,
} = {}) {
  const path = `/api/v2/admin/suggestions/${suggestionId}/supporters`;
  const effectivePerPage = Math.min(perPage, DEFAULT_PER_PAGE);

  logger.info(`fetchSuggestionSupporters: suggestion #${suggestionId}`);

  const allSupporters = [];
  let page = 1;
  let totalPages = null;

  while (true) {
    logger.info(`  → page ${page}${totalPages ? `/${totalPages}` : ''}`);

    const body = await client.get(path, {
      page,
      per_page: effectivePerPage,
    });

    const raw = extractSupporters(body, logger);
    const normalised = normalizeSupporters(raw);

    allSupporters.push(...normalised);

    // Honour caller-specified limit
    if (limit !== null && allSupporters.length >= limit) {
      logger.info(`  → limit ${limit} reached, stopping pagination`);
      return allSupporters.slice(0, limit);
    }

    // Determine if there are more pages
    const pagination = body?.pagination ?? body?.meta ?? null;
    if (pagination) {
      const total = pagination.total_records ?? pagination.total ?? null;
      const perPageActual = pagination.per_page ?? effectivePerPage;
      totalPages = total != null ? Math.ceil(total / perPageActual) : null;

      if (totalPages !== null && page >= totalPages) break;

      // Some API versions use next_page boolean or a next cursor
      if (pagination.next_page === false || pagination.has_more === false) break;
    }

    // No pagination metadata — stop if we got fewer records than requested
    if (raw.length < effectivePerPage) break;

    page++;
  }

  logger.info(`fetchSuggestionSupporters: total ${allSupporters.length} supporter(s)`);
  return allSupporters;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function extractSupporters(body, logger) {
  if (Array.isArray(body?.supporters)) return body.supporters;

  // Some endpoint variants return the array at the top level
  if (Array.isArray(body)) return body;

  logger.warn('fetchSuggestionSupporters: unexpected response shape', JSON.stringify(body).slice(0, 200));
  return [];
}
