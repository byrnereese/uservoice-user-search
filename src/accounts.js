/**
 * Fetch full account details (including custom_fields) from the UserVoice API.
 *
 * Endpoint: GET /api/v2/admin/accounts/:id
 *
 * Account objects in the supporter list are lightweight stubs (id + name).
 * This module fetches the complete record for one or more accounts, including
 * all Salesforce-synced and UserVoice-native custom fields.
 *
 * For batch fetches (multiple account IDs) we use a concurrency-limited pool
 * so we don't hammer the API with hundreds of simultaneous requests.
 */

import { normalizeAccount } from './normalizer.js';
import { UserVoiceApiError } from './errors.js';

const DEFAULT_CONCURRENCY = 5;

/**
 * Fetch a single account by ID.
 *
 * @param {import('./client.js').Client}  client
 * @param {number|string}                accountId
 * @param {import('./logger.js').Logger}  logger
 * @returns {Promise<import('./normalizer.js').NormalizedAccount>}
 */
export async function fetchAccount(client, accountId, logger) {
  logger.info(`fetchAccount: #${accountId}`);

  const body = await client.get(`/api/v2/admin/accounts/${accountId}`);

  const raw = body?.account ?? body;
  if (!raw || typeof raw !== 'object') {
    throw new UserVoiceApiError(
      `fetchAccount: unexpected response for account #${accountId}`,
      { body },
    );
  }

  return normalizeAccount(raw);
}

/**
 * Fetch multiple accounts by ID, with concurrency limiting and partial-failure
 * tolerance.
 *
 * Returns a Map of `accountId → NormalizedAccount`. Accounts that could not be
 * fetched (e.g. 403 / 404) are omitted from the map and a warning is logged;
 * they do NOT cause the whole batch to fail.
 *
 * @param {import('./client.js').Client}  client
 * @param {Array<number|string>}          accountIds   May contain duplicates — deduped internally
 * @param {import('./logger.js').Logger}  logger
 * @param {object}                        [opts]
 * @param {number}                        [opts.concurrency=5]  Max simultaneous requests
 * @returns {Promise<Map<string, import('./normalizer.js').NormalizedAccount>>}
 */
export async function fetchAccounts(client, accountIds, logger, {
  concurrency = DEFAULT_CONCURRENCY,
} = {}) {
  // Deduplicate IDs — no point fetching the same account twice
  const uniqueIds = [...new Set(accountIds.map(String))];

  logger.info(`fetchAccounts: ${uniqueIds.length} unique account(s), concurrency=${concurrency}`);

  const result = new Map();

  // Run with a concurrency limit using a simple semaphore pattern
  await runWithConcurrency(
    uniqueIds.map((id) => async () => {
      try {
        const account = await fetchAccount(client, id, logger);
        result.set(String(account.id ?? id), account);
      } catch (err) {
        // Tolerate individual account fetch failures — log and continue
        logger.warn(`fetchAccounts: could not fetch account #${id} — ${err.message}`);
      }
    }),
    concurrency,
  );

  logger.info(`fetchAccounts: fetched ${result.size}/${uniqueIds.length} account(s)`);
  return result;
}

/**
 * Merge full account details (from a fetchAccounts Map) into a supporter list.
 *
 * For each supporter whose account stub has an ID present in `accountMap`,
 * the stub is replaced with the full NormalizedAccount (including customFields).
 * Supporters with no account or whose account wasn't in the map are returned
 * unchanged.
 *
 * @param {import('./normalizer.js').NormalizedSupporter[]} supporters
 * @param {Map<string, import('./normalizer.js').NormalizedAccount>} accountMap
 * @returns {import('./normalizer.js').NormalizedSupporter[]}
 */
export function mergeAccountsIntoSupporters(supporters, accountMap) {
  return supporters.map((supporter) => {
    const accountId = String(supporter.account?.id ?? '');
    if (!accountId || !accountMap.has(accountId)) return supporter;

    return {
      ...supporter,
      account: accountMap.get(accountId),
    };
  });
}

// ─── Private helpers ─────────────────────────────────────────────────────────

/**
 * Execute an array of async task functions with a maximum concurrency cap.
 *
 * Each task is a `() => Promise<void>` (side-effect style — results are
 * collected via closure in the callers above).
 *
 * @param {Array<() => Promise<void>>} tasks
 * @param {number}                     concurrency
 * @returns {Promise<void>}
 */
async function runWithConcurrency(tasks, concurrency) {
  const queue = [...tasks];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, runWorker);
  await Promise.all(workers);

  async function runWorker() {
    while (queue.length > 0) {
      const task = queue.shift();
      if (task) await task();
    }
  }
}
