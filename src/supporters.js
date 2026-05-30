/**
 * Fetch supporters for a UserVoice suggestion.
 *
 * Strategy order
 * ──────────────
 * Different UserVoice instances expose the supporters collection at different
 * endpoints. We try three strategies in reliability order, falling through on
 * 404 so the right one wins automatically:
 *
 *   1. Flat filter (enterprise instances, e.g. ideas.ringcentral.com):
 *        GET /api/v2/admin/supporters?filter[suggestion_id]=:id
 *      Top-level collection filtered by suggestion ID. Most reliable on
 *      hosted/enterprise deployments.
 *
 *   2. Forum-scoped nested path (standard hosted instances):
 *        GET /api/v2/admin/forums/:forumId/suggestions/:id/supporters
 *      Requires forumId. Skipped if forumId is not provided.
 *
 *   3. Unscoped nested path (final fallback):
 *        GET /api/v2/admin/suggestions/:id/supporters
 *
 * The endpoint is paginated. This module handles auto-pagination so callers
 * always receive the complete supporter list without managing page state.
 */

import { normalizeSupporters } from './normalizer.js';
import { UserVoiceApiError } from './errors.js';

const DEFAULT_PER_PAGE = 100;

/**
 * Fetch all supporters for a suggestion, auto-paginating through every page.
 *
 * @param {import('./client.js').Client}   client
 * @param {number|string}                 suggestionId
 * @param {import('./logger.js').Logger}   logger
 * @param {object}                        [opts]
 * @param {number|string|null}            [opts.forumId=null]
 *   The UserVoice forum (project) ID. Used for strategy 2 (forum-scoped path).
 *   Not required — strategies 1 and 3 work without it.
 * @param {number}                        [opts.perPage=100]
 * @param {number|null}                   [opts.limit=null]
 * @returns {Promise<import('./normalizer.js').NormalizedSupporter[]>}
 */
export async function fetchSuggestionSupporters(client, suggestionId, logger, {
  forumId = null,
  perPage = DEFAULT_PER_PAGE,
  limit = null,
} = {}) {
  const effectivePerPage = Math.min(perPage, DEFAULT_PER_PAGE);

  logger.info(
    `fetchSuggestionSupporters: suggestion #${suggestionId}` +
    (forumId ? ` (forum #${forumId})` : ''),
  );

  const strategies = buildStrategies(suggestionId, forumId);

  for (const strategy of strategies) {
    logger.info(`  trying ${strategy.label}`);
    try {
      return await fetchAllPages(client, strategy, effectivePerPage, limit, logger);
    } catch (err) {
      if (err instanceof UserVoiceApiError && err.status === 404 && strategies.length > 1) {
        logger.warn(`fetchSuggestionSupporters: 404 on ${strategy.label} — trying next strategy`);
        continue;
      }
      throw err;
    }
  }

  logger.warn('fetchSuggestionSupporters: all strategies returned 404');
  return [];
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * @typedef {{ label: string, path: string, extraParams: object }} SupporterStrategy
 */

/**
 * Build the ordered list of strategies to attempt.
 *
 * @param {number|string} suggestionId
 * @param {number|string|null} forumId
 * @returns {SupporterStrategy[]}
 */
function buildStrategies(suggestionId, forumId) {
  const strategies = [];

  // Strategy 1 — flat collection filtered by suggestion ID (enterprise instances)
  strategies.push({
    label: `/api/v2/admin/supporters?filter[suggestion_id]=${suggestionId}`,
    path:  '/api/v2/admin/supporters',
    extraParams: { 'filter[suggestion_id]': suggestionId },
  });

  // Strategy 2 — forum-scoped nested path (requires forumId)
  if (forumId != null) {
    strategies.push({
      label: `/api/v2/admin/forums/${forumId}/suggestions/${suggestionId}/supporters`,
      path:  `/api/v2/admin/forums/${forumId}/suggestions/${suggestionId}/supporters`,
      extraParams: {},
    });
  }

  // Strategy 3 — unscoped nested path
  strategies.push({
    label: `/api/v2/admin/suggestions/${suggestionId}/supporters`,
    path:  `/api/v2/admin/suggestions/${suggestionId}/supporters`,
    extraParams: {},
  });

  return strategies;
}

/**
 * Walk all pages for one strategy and return the full supporter list.
 *
 * @param {import('./client.js').Client} client
 * @param {SupporterStrategy} strategy
 * @param {number} perPage
 * @param {number|null} limit
 * @param {import('./logger.js').Logger} logger
 * @returns {Promise<import('./normalizer.js').NormalizedSupporter[]>}
 */
async function fetchAllPages(client, strategy, perPage, limit, logger) {
  const allSupporters = [];
  let page = 1;
  let totalPages = null;

  while (true) {
    logger.info(`  → page ${page}${totalPages ? `/${totalPages}` : ''}`);

    const body = await client.get(strategy.path, {
      ...strategy.extraParams,
      page,
      per_page: perPage,
    });

    const raw = extractSupporters(body, logger);
    const normalised = normalizeSupporters(raw);

    allSupporters.push(...normalised);

    if (limit !== null && allSupporters.length >= limit) {
      logger.info(`  → limit ${limit} reached, stopping pagination`);
      return allSupporters.slice(0, limit);
    }

    const pagination = body?.pagination ?? body?.meta ?? null;
    if (pagination) {
      const total = pagination.total_records ?? pagination.total ?? null;
      const perPageActual = pagination.per_page ?? perPage;
      totalPages = total != null ? Math.ceil(total / perPageActual) : null;

      if (totalPages !== null && page >= totalPages) break;
      if (pagination.next_page === false || pagination.has_more === false) break;
    }

    if (raw.length < perPage) break;

    page++;
  }

  logger.info(
    `fetchSuggestionSupporters: ${allSupporters.length} supporter(s) via ${strategy.label}`,
  );
  return allSupporters;
}

function extractSupporters(body, logger) {
  if (Array.isArray(body?.supporters)) return body.supporters;
  if (Array.isArray(body)) return body;
  logger.warn(
    'fetchSuggestionSupporters: unexpected response shape',
    JSON.stringify(body).slice(0, 200),
  );
  return [];
}
