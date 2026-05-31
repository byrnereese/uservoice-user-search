# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] – 2026-05-30

### Fixed

- **`findByEmail` returning the wrong user on `ideas.ringcentral.com`** — `filter[email]` and `filter[email_or_external_id]` are silently ignored by this instance, causing those strategies to return up to 10 unrelated users and trick the orchestrator into stopping early with the wrong result. Both strategies now post-filter to exact email match, so an ignored filter falls through cleanly to Strategy 3 (`q=email`) which resolves correctly in ~150 ms.

### Changed

- **Email strategy order reversed** — `v2AdminQueryEmail` (`q=email` with post-filter) is now Strategy 1 instead of Strategy 3. On `ideas.ringcentral.com` this reduces `findByEmail` latency from ~21 seconds (two 10-second ignored-filter requests) to ~150 ms. On instances where `filter[email]` works natively, Strategy 2 still handles it correctly.

### Notes

- `findByName` on `ideas.ringcentral.com`: Strategy 1 (`q=name`) is the only working path. Strategy 2 (autocomplete) returns 404 on this instance; Strategy 3 (v1 search) requires HMAC-SHA1 and returns 401. Both are retained as fallbacks for other UserVoice tenants.
- All filters (`filter[email]`, `filter[name]`, `filter[suggestion_id]`, etc.) are silently ignored by `ideas.ringcentral.com`. The only reliable search parameter is `q=`.

## [1.2.0] – 2026-05-30

### Added

- **`getSuggestion(id)`** — fetches a single suggestion with all pre-computed aggregated data in one API call. Returns a `NormalizedSuggestion` shape that surfaces:
  - Supporter aggregates: `supportersCount`, `supportingAccountsCount`, `supporterMrr`, `supporterRevenue`, `firstSupportAt`, `lastSupportAt`
  - Salesforce-synced segment data: `cvEnterprise`, `cvMajors`, `cvMidmarket`, `cvSm` (each with `accountsCount`, `revenue`, `usersCount`)
  - Opportunity metrics: `cvOpenOpportunities`, `cvPotentialRevenue`, `cvLostRevenue`, `cvPercentOpportunitiesWon`, and related fields
  - `forumId` — extracted automatically from the JSON API `links` sideload (not from a nested field)
- **`normalizeSuggestion(raw, links)`** — internal normalizer for suggestion objects
- **`src/suggestions.js`** — `fetchSuggestion(client, suggestionId, logger)` calls `GET /api/v2/admin/suggestions/:id?includes=forums`

### Notes

On enterprise UserVoice instances like `ideas.ringcentral.com`, the supporters collection endpoint silently ignores all filter parameters and nested suggestion paths return 404. `getSuggestion()` is the recommended replacement — it retrieves the same Salesforce-synced revenue and account data in a single fast call, avoiding thousands of paginated supporter requests.

## [1.1.6] – 2026-05-30

### Fixed

- **Supporters always returning 0 on enterprise instances** — The library was only trying nested URL paths (`/suggestions/:id/supporters`) which do not exist on enterprise/hosted UserVoice deployments like `ideas.ringcentral.com`. The correct endpoint on these instances is a flat top-level collection: `GET /api/v2/admin/supporters?filter[suggestion_id]=:id`. Strategy 1 (flat filter) is now tried first; strategies 2 (forum-scoped path) and 3 (unscoped path) are retained as fallbacks for standard instances.

## [1.1.5] – 2026-05-30

### Changed

- Version bump.

## [1.1.4] – 2026-05-30

### Added

- **`baseUrl` constructor option** — allows callers whose UserVoice instance is hosted on a custom domain (e.g. `https://ideas.mycompany.com`) to pass the full base URL instead of relying on `{subdomain}.uservoice.com`. `baseUrl` takes precedence over `subdomain` when both are provided. Trailing slashes are stripped automatically.

### Fixed

- All API calls were being sent to `{subdomain}.uservoice.com` even when the UserVoice instance is on a custom domain, causing every request to 404. This was the root cause of persistent 404 errors on the supporters endpoint for instances like `ideas.ringcentral.com`.

## [1.1.3] – 2026-05-30

### Fixed

- **HTTP 404 on supporter fetch — dist build updated** — The `dist/index.cjs` and `dist/index.mjs` built artefacts now include the `forumId` fix from 1.1.2. Previously the source had been patched but the compiled output had not been regenerated, so callers loading from `dist/` (the default for `require()` and `import`) were still hitting the 404.

## [1.1.2] – 2026-05-30

### Fixed

- **HTTP 404 on supporter fetch** — Most UserVoice instances require a forum-scoped URL for the supporters endpoint (`/api/v2/admin/forums/:forumId/suggestions/:id/supporters`) but the library was only calling the unscoped path (`/api/v2/admin/suggestions/:id/supporters`). Added a `forumId` option to `getSuggestionSupporters()` and `getSuggestionSupporterDetails()`. When `forumId` is supplied the scoped URL is tried first; if it returns 404 the library automatically retries with the unscoped URL before giving up. Passing `forumId` is strongly recommended for all UserVoice instances.

## [1.1.1] – 2026-05-30

### Added

- Six-tier `logLevel` option: `'silent'` | `'error'` | `'warn'` | `'info'` | `'debug'` | `'verbose'`
  - `error` — hard API errors only
  - `warn` — + non-fatal warnings (unexpected response shapes, partial account-fetch failures, 429 retries)
  - `info` — + public-method entry/exit with result counts and per-call timing summaries
  - `debug` — + strategy lifecycle events, request URLs, redacted headers, response status and timing (equivalent to the previous `debug: true`)
  - `verbose` — + full decoded query-parameter listings and complete response bodies
- `logBodyLimit` constructor option (default `4096`) — caps the characters printed per response body at `verbose` level; bodies longer than the limit are truncated with a notice showing the actual full length
- `LOG_LEVELS` constant exported from the package root for programmatic level references
- Per-call timing in all `info`-level summary messages (e.g. `findByEmail → user #42 "Alice" in 213ms`)
- `countResults()` in the HTTP client now recognises supporter and single-account response shapes for accurate result counts in debug logs

### Changed

- `logLevel` takes precedence over `debug` when both constructor options are provided
- `debug: true` is now a backward-compatible alias for `logLevel: 'debug'` — no behaviour change for existing callers

## [1.1.0] – 2026-05-30

### Added

- `getSuggestionSupporters(suggestionId, [opts])` — fetches all supporters for a suggestion with auto-pagination; returns `NormalizedSupporter[]` with lightweight account stubs
- `getAccountDetails(accountId)` — fetches a single account record including all Salesforce-synced and UserVoice-native custom fields
- `getSuggestionSupporterDetails(suggestionId, [opts])` — full pipeline: auto-paginated supporters → concurrency-limited parallel account fetches → merged result with `account.customFields` populated; designed for building supporter tables
- `NormalizedSupporter` shape — hoists user fields alongside supporter metadata (`votes`, `supportedAt`) and a nested `NormalizedAccount`
- `NormalizedAccount` shape — includes `id`, `name`, `externalId` (Salesforce ID), `memberCount`, `customFields` (flat key/value map), and `_raw`
- `normalizeCustomFields()` — handles both plain-hash and array-of-`{name,value}` custom field shapes returned by different UserVoice versions
- `mergeAccountsIntoSupporters()` — replaces account stubs with full account records after batch fetch
- `accounts.concurrency` constructor option — cap parallel account requests (default `5`)
- `concurrency` option on `getSuggestionSupporterDetails()` — per-call override of the concurrency cap
- Partial-failure tolerance in batch account fetching — a single account's 403/404 logs a warning but does not abort the call; the supporter's stub is preserved
- Tests for `fetchSuggestionSupporters`, `fetchAccount`, `fetchAccounts`, `mergeAccountsIntoSupporters`, and the full `getSuggestionSupporterDetails` pipeline

## [1.0.0] – 2026-05-21

### Added

- `UserVoiceSearch` class with `findByEmail()`, `findByName()`, and `find()` methods
- Four email search strategies with automatic fallback:
  - `v2AdminFilterEmail` — exact `filter[email]` on the v2 admin users endpoint
  - `v2AdminFilterEmailOrId` — `filter[email_or_external_id]` variant
  - `v2AdminQueryEmail` — free-text `q=` search with post-filter to exact match
  - `v1SearchEmail` — legacy v1 `/users/search.json` endpoint
- Three name search strategies with automatic fallback:
  - `v2AdminQueryName` — free-text `q=` search on the v2 admin users endpoint
  - `v2AdminAutocomplete` — prefix-optimised v2 autocomplete endpoint
  - `v1SearchName` — legacy v1 `/users/search.json` endpoint
- `all: true` option on `findByName()` to run all strategies concurrently and merge
- `find(query)` convenience method with automatic email/name routing
- `NormalizedUser` response shape — consistent across all endpoints
- `debug` mode with per-strategy logging, request/response details, and Bearer token redaction
- Automatic `429` rate-limit handling with `Retry-After`-aware back-off (up to 3 retries)
- Configurable HTTP request timeout (`timeoutMs`)
- Custom strategy injection via `strategies.email` / `strategies.name` config options
- `UserVoiceApiError`, `UserVoiceRateLimitError`, `UserVoiceConfigError` exported error types
- Dual ESM + CJS build (Node ≥ 18, zero runtime dependencies)
- Full test suite (vitest) covering normaliser, all strategies, orchestrator logic, and logger
