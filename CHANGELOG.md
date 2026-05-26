# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
