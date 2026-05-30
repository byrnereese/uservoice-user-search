# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
