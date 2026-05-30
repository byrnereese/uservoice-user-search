/**
 * Fetch supporters for a UserVoice suggestion.
 *
 * URL strategy
 * ────────────
 * UserVoice's v2 API typically scopes suggestions inside a forum (project):
 *
 *   GET /api/v2/admin/forums/:forumId/suggestions/:id/supporters   ← preferred
 *   GET /api/v2/admin/suggestions/:id/supporters                   ← unscoped fallback
 *
 * When `forumId` is supplied the scoped URL is tried first. If that returns
 * 404 (the forum ID may be wrong or the instance is configured differently)
 * we automatically retry with the unscoped URL before giving up.
 *
 * When `forumId` is omitted the unscoped URL is tried directly.
 *
 * The endpoint is paginated. This module handles auto-pagination so callers
 * always receive the complete supporter list without managing page state.
 *
 * Each supporter record embeds a lightweight user object and (when present)
 * a lightweight account stub. Full account details — including custom_fields —
 * require a separate fetch via src/accounts.js.
 */

import { normalizeSupporters } from './normalizer.js';
import { UserVoiceApiError } from './errors.js';

const DEFAULT_PER_PAGE = 100; // maximum page size UserVoice accepts

/**
 * Fetch all supporters for a suggestion, auto-paginating through every page.
 *
 * @param {import('./client.js').Client}   client
 * @param {number|string}                 suggestionId
 * @param {import('./logger.js').Logger}   logger
 * @param {object}                        [opts]
 * @param {number|string|null}            [opts.forumId=null]
 *   The UserVoice forum (project) ID the suggestion belongs to.
 *   When supplied the scoped path `/api/v2/admin/forums/:forumId/suggestions/…`
 *   is tried first, with an automatic fallback to the unscoped path on 404.
 *   When omitted the unscoped path is used directly.
 * @param {number}                        [opts.perPage=100]  Records per page (max 100)
 * @param {number|null}                   [opts.limit=null]   Cap total supporters returned.
 *                                                            null = fetch all pages.
 * @returns {Promise<import('./normalizer.js').NormalizedSupporter[]>}
 */
export async function fetchSuggestionSupporters(client, suggestionId, logger, {
  forumId = null,
  perPage = DEFAULT_PER_PAGE,
  limit = null,
} = {}) {
  const effectivePerPage = Math.min(perPage, DEFAULT_PER_PAGE);

  // Build the ordered list of paths to attempt
  const paths = buildPaths(suggestionId, forumId);

  logger.info(
    `fetchSuggestionSupporters: suggestion #${suggestionId}` +
    (forumId ? ` (forum #${forumId})` : ''),
  );

  // Try each path in order, falling through on 404
  for (const path of paths) {
    logger.info(`  trying ${path}`);
    try {
      return await fetchAllPages(client, path, effectivePerPage, limit, logger);
    } catch (err) {
      if (err instanceof UserVoiceApiError && err.status === 404 && paths.length > 1) {
        logger.warn(
          `fetchSuggestionSupporters: 404 on ${path} — trying next path`,
        );
        continue;
      }
      throw err;
    }
  }

  // All paths exhausted — should not normally reach here but return empty
  logger.warn('fetchSuggestionSupporters: all path variants returned 404');
  return [];
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Build the list of URL paths to attempt, in priority order.
 *
 * @param {number|string} suggestionId
 * @param {number|string|null} forumId
 * @returns {string[]}
 */
function buildPaths(suggestionId, forumId) {
  const unscoped = `/api/v2/admin/suggestions/${suggestionId}/supporters`;

  if (forumId != null) {
    // Forum-scoped path first, unscoped as fallback
    const scoped = `/api/v2/admin/forums/${forumId}/suggestions/${suggestionId}/supporters`;
    return [scoped, unscoped];
  }

  return [unscoped];
}

/**
 * Walk all pages for a single path and return the full list of supporters.
 *
 * @param {import('./client.js').Client} client
 * @param {string} path
 * @param {number} perPage
 * @param {number|null} limit
 * @param {import('./logger.js').Logger} logger
 * @returns {Promise<import('./normalizer.js').NormalizedSupporter[]>}
 */
async function fetchAllPages(client, path, perPage, limit, logger) {
  const allSupporters = [];
  let page = 1;
  let totalPages = null;

  while (true) {
    logger.info(`  → page ${page}${totalPages ? `/${totalPages}` : ''}`);

    const body = await client.get(path, {
      page,
      per_page: perPage,
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
      const perPageActual = pagination.per_page ?? perPage;
      totalPages = total != null ? Math.ceil(total / perPageActual) : null;

      if (totalPages !== null && page >= totalPages) break;

      // Some API versions use next_page boolean or a has_more flag
      if (pagination.next_page === false || pagination.has_more === false) break;
    }

    // No pagination metadata — stop if we got fewer records than requested
    if (raw.length < perPage) break;

    page++;
  }

  logger.info(`fetchSuggestionSupporters: total ${allSupporters.length} supporter(s) from ${path}`);
  return allSupporters;
}

function extractSupporters(body, logger) {
  if (Array.isArray(body?.supporters)) return body.supporters;

  // Some endpoint variants return the array at the top level
  if (Array.isArray(body)) return body;

  logger.warn('fetchSuggestionSupporters: unexpected response shape', JSON.stringify(body).slice(0, 200));
  return [];
}
