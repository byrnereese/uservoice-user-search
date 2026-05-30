# uservoice-user-search

[![npm version](https://img.shields.io/npm/v/uservoice-user-search.svg)](https://www.npmjs.com/package/uservoice-user-search)
[![CI](https://github.com/ringcentral/uservoice-user-search/actions/workflows/ci.yml/badge.svg)](https://github.com/ringcentral/uservoice-user-search/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Reliable user search for the [UserVoice API](https://developer.uservoice.com/docs/api/v2/intro/) — by email address or display name — plus full suggestion supporter resolution with Salesforce-synced account custom fields.

UserVoice exposes several different endpoints for finding users, and each one behaves differently depending on the API token scope, plan tier, and UserVoice version. This module solves that problem by running a **prioritised sequence of search strategies** and returning as soon as one yields results. If an endpoint returns nothing or errors, the next strategy is tried automatically.

---

## Features

- **Single stable interface** — `findByEmail()`, `findByName()`, `find()`
- **Multi-strategy fallback** — four email strategies, three name strategies, tried in reliability order
- **Suggestion supporter pipeline** — `getSuggestionSupporterDetails()` fetches all supporters for an idea and enriches each one with the full account record (including all Salesforce-synced custom fields)
- **Normalised response** — consistent `NormalizedUser`, `NormalizedSupporter`, and `NormalizedAccount` shapes regardless of which API responded
- **Auto-pagination** — supporter fetching walks all pages automatically
- **Concurrency-limited account fetching** — batch account lookups run in parallel without hammering the API
- **Six-tier log levels** — `silent` → `error` → `warn` → `info` → `debug` → `verbose`; verbose adds full decoded query params and complete response bodies with configurable truncation
- **Rate-limit handling** — automatic back-off and retry on `429` responses
- **Zero runtime dependencies** — uses the native `fetch` API (Node ≥ 18)
- **Dual ESM + CJS build** — works in modern ESM projects and legacy `require()` contexts

---

## Requirements

- Node.js **18.0.0** or later (uses native `fetch`)
- A UserVoice **OAuth bearer token** with at minimum `admin` scope

---

## Installation

```bash
npm install uservoice-user-search
```

---

## Quick Start

```js
import { UserVoiceSearch } from 'uservoice-user-search';

const search = new UserVoiceSearch({
  subdomain: 'mycompany',       // → mycompany.uservoice.com
  token: process.env.UV_TOKEN,
});

// Search by exact email address
const user = await search.findByEmail('alice@example.com');
if (user) {
  console.log(`Found: ${user.name} (ID ${user.id})`);
} else {
  console.log('User not found.');
}

// Search by display name (returns array)
const users = await search.findByName('Alice Smith');
console.log(`${users.length} match(es) found.`);

// Auto-detect: email-like string → findByEmail, anything else → findByName
const results = await search.find('alice@example.com');
const results2 = await search.find('Alice Smith');

// Suggestion supporters — with full account + custom fields
// Pass forumId (project ID) to avoid 404 on most UserVoice instances
const rows = await search.getSuggestionSupporterDetails(suggestionId, { forumId: 1 });
for (const row of rows) {
  console.log(
    row.name,
    row.email,
    row.votes,
    row.account?.name,
    row.account?.customFields?.ARR,
    row.account?.customFields?.Plan,
  );
}
```

### CommonJS

```js
const { UserVoiceSearch } = require('uservoice-user-search');
```

---

## API Reference

### `new UserVoiceSearch(config)`

| Option | Type | Required | Default | Description |
|---|---|---|---|---|
| `subdomain` | `string` | ✅ | — | Your UserVoice subdomain (e.g. `"mycompany"`) |
| `token` | `string` | ✅ | — | OAuth bearer token |
| `logLevel` | `string` | | `'silent'` | Log verbosity level (see table below). Takes precedence over `debug`. |
| `debug` | `boolean` | | `false` | Backward-compat alias for `logLevel: 'debug'`. Ignored when `logLevel` is set. |
| `logBodyLimit` | `number` | | `4096` | Max characters per response body printed at `verbose` level. Longer bodies are truncated. |
| `timeoutMs` | `number` | | `15000` | Per-request timeout in milliseconds |
| `strategies.email` | `Strategy[]` | | built-in | Override the email strategy list |
| `strategies.name` | `Strategy[]` | | built-in | Override the name strategy list |
| `accounts.concurrency` | `number` | | `5` | Max parallel account requests in `getSuggestionSupporterDetails` |

Throws `UserVoiceConfigError` if `subdomain` or `token` are missing.

---

### `search.findByEmail(email)`

Search for a user by their exact email address.

```js
const user = await search.findByEmail('alice@example.com');
// → NormalizedUser | null
```

Runs email strategies in order; returns the **first match** found, or `null` if no user is found across all strategies.

---

### `search.findByName(name, [options])`

Search for users by display name.

```js
const users = await search.findByName('Alice Smith');
// → NormalizedUser[]

// Run all strategies in parallel and merge (useful for comprehensive searches)
const users = await search.findByName('Alice Smith', { all: true });
```

| Option | Type | Default | Description |
|---|---|---|---|
| `all` | `boolean` | `false` | Run all strategies and merge deduplicated results |

---

### `search.find(query, [options])`

Auto-routing convenience method. If `query` matches `*@*.*`, delegates to `findByEmail` (result wrapped in array). Otherwise delegates to `findByName`.

```js
const results = await search.find('alice@example.com');  // → [NormalizedUser] or []
const results2 = await search.find('Alice Smith');        // → NormalizedUser[]
```

---

### `search.getSuggestionSupporters(suggestionId, [options])`

Fetch all supporters for a suggestion. Returns normalised supporter records with a **lightweight account stub** (id + name only). Custom fields on the account are not included — use `getSuggestionSupporterDetails()` for that.

```js
const supporters = await search.getSuggestionSupporters(12345, { forumId: 1 });
// → NormalizedSupporter[]
```

| Option | Type | Default | Description |
|---|---|---|---|
| `forumId` | `number\|string` | — | The UserVoice forum (project) ID the suggestion belongs to. **Strongly recommended** — most UserVoice instances return 404 without it. Automatically falls back to the unscoped URL on 404. |
| `perPage` | `number` | `100` | Records per API page (max 100) |
| `limit` | `number\|null` | `null` | Cap total supporters returned. `null` = fetch all pages. |

---

### `search.getAccountDetails(accountId)`

Fetch the full account record for a single account ID, including all Salesforce-synced and UserVoice-native custom fields.

```js
const account = await search.getAccountDetails(78900);
// → NormalizedAccount

console.log(account.customFields);
// { ARR: 50000, Plan: 'Enterprise', Industry: 'Technology', ... }
```

---

### `search.getSuggestionSupporterDetails(suggestionId, [options])`

**The primary method for building a supporter table with account data.**

Fetches all supporters for a suggestion (auto-paginated) and enriches each one with the full account record — including all Salesforce-synced custom fields. Accounts are fetched in parallel with a configurable concurrency limit.

```js
const rows = await search.getSuggestionSupporterDetails(12345, { forumId: 1 });
// → NormalizedSupporter[]  (each row has a full account.customFields map)

// Render a table
for (const row of rows) {
  console.log({
    name:     row.name,
    email:    row.email,
    votes:    row.votes,
    company:  row.account?.name,
    arr:      row.account?.customFields?.ARR,
    plan:     row.account?.customFields?.Plan,
    sfId:     row.account?.externalId,
  });
}
```

| Option | Type | Default | Description |
|---|---|---|---|
| `forumId` | `number\|string` | — | The UserVoice forum (project) ID the suggestion belongs to. **Strongly recommended** — most UserVoice instances return 404 without it. Automatically falls back to the unscoped URL on 404. |
| `perPage` | `number` | `100` | Supporter records per API page |
| `limit` | `number\|null` | `null` | Cap total supporters (null = all) |
| `concurrency` | `number` | `5` | Max parallel account requests (overrides constructor default) |

**Partial failure behaviour:** if an individual account fetch fails (e.g. 403 / 404), that supporter's `account` field retains the lightweight stub (with an empty `customFields`) rather than causing the whole call to throw. A warning is logged in debug mode.

---

## Normalised Object Shapes

### `NormalizedUser`

```ts
{
  id:         number | string
  name:       string | null
  email:      string | null
  createdAt:  string | null       // ISO-8601
  avatarUrl:  string | null
  state:      string | null       // e.g. "active", "blocked"
  roles:      string | null       // comma-separated
  _raw:       object              // original API object
}
```

### `NormalizedAccount`

```ts
{
  id:           number | string
  name:         string | null
  externalId:   string | null     // Salesforce record ID
  createdAt:    string | null     // ISO-8601
  memberCount:  number | null     // users in this account
  customFields: Record<string, unknown>  // all custom / Salesforce-synced fields
  _raw:         object
}
```

Custom fields arrive from the API as either a plain hash (`{ ARR: 50000 }`) or an array of `{ name, value }` pairs — both are normalised to a flat `{ key: value }` map.

### `NormalizedSupporter`

```ts
{
  id:          number | string    // supporter record ID
  userId:      number | string | null  // UserVoice user ID
  name:        string | null
  email:       string | null
  createdAt:   string | null      // ISO-8601 — user created at
  avatarUrl:   string | null
  state:       string | null
  roles:       string | null
  votes:       number | null      // votes applied to this suggestion
  supportedAt: string | null      // ISO-8601 — when support was recorded
  account:     NormalizedAccount | null  // stub from getSuggestionSupporters();
                                         // full record from getSuggestionSupporterDetails()
  _raw:        object
}
```

---

### Error types

All error classes are exported from the package root.

```js
import {
  UserVoiceApiError,
  UserVoiceRateLimitError,
  UserVoiceConfigError,
} from 'uservoice-user-search';
```

| Class | Extends | When thrown |
|---|---|---|
| `UserVoiceConfigError` | `Error` | Invalid constructor arguments |
| `UserVoiceApiError` | `Error` | HTTP error from the API (4xx/5xx) or non-JSON response |
| `UserVoiceRateLimitError` | `UserVoiceApiError` | All retry attempts exhausted after a `429` |

```js
try {
  const rows = await search.getSuggestionSupporterDetails(12345);
} catch (err) {
  if (err instanceof UserVoiceRateLimitError) {
    console.error(`Rate limited. Try again in ${err.retryAfter}s.`);
  } else if (err instanceof UserVoiceApiError) {
    console.error(`API error ${err.status}: ${err.message}`);
  }
}
```

---

## Log Levels

The module uses a six-tier log system controlled by the `logLevel` constructor option.

| Level | Value | What it prints |
|---|---|---|
| `silent` | 0 | Nothing (default) |
| `error` | 1 | Hard API errors, config problems |
| `warn` | 2 | + Non-fatal warnings (unexpected response shapes, partial failures, 429 retry notices) |
| `info` | 3 | + Public method entry/exit with result counts and per-call timing |
| `debug` | 4 | + Strategy events, request URLs, redacted headers, response status and timing |
| `verbose` | 5 | + Full decoded query-param listings and complete response bodies (truncated at `logBodyLimit`) |

```js
// info — timing summaries and result counts only
const search = new UserVoiceSearch({
  subdomain: 'mycompany',
  token: process.env.UV_TOKEN,
  logLevel: 'info',
});

// debug — full request/response metadata (no bodies)
const search = new UserVoiceSearch({
  subdomain: 'mycompany',
  token: process.env.UV_TOKEN,
  logLevel: 'debug',
});

// verbose — everything, including full response bodies
const search = new UserVoiceSearch({
  subdomain: 'mycompany',
  token: process.env.UV_TOKEN,
  logLevel: 'verbose',
  logBodyLimit: 8192,   // optional: default is 4096 chars
});

// backward compat — debug:true still works (maps to logLevel:'debug')
const search = new UserVoiceSearch({
  subdomain: 'mycompany',
  token: process.env.UV_TOKEN,
  debug: true,
});
```

You can also reference level names programmatically:

```js
import { LOG_LEVELS } from 'uservoice-user-search';
// LOG_LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4, verbose: 5 }
```

### Example output at each level

**`info`** — just the summary line per public method call:
```
[uservoice-user-search] [INFO]    getSuggestionSupporterDetails: suggestion #12345
[uservoice-user-search] [INFO]    getSuggestionSupporterDetails: 47 supporter(s), 23 unique account(s) to enrich
[uservoice-user-search] [INFO]    getSuggestionSupporterDetails → 47 row(s), 23/23 accounts enriched in 1842ms
```

**`debug`** — adds per-request metadata and strategy events:
```
[uservoice-user-search] [INFO]    getSuggestionSupporterDetails: suggestion #12345
[uservoice-user-search] [DEBUG]   → GET https://mycompany.uservoice.com/api/v2/admin/suggestions/12345/supporters?page=1&per_page=100
[uservoice-user-search] [DEBUG]     headers: {"Authorization":"Bearer [REDACTED]","Accept":"application/json"}
[uservoice-user-search] [DEBUG]   ← 200 https://... — 47 result(s) in 318ms
[uservoice-user-search] [DEBUG]   → GET https://mycompany.uservoice.com/api/v2/admin/accounts/100
[uservoice-user-search] [DEBUG]   ← 200 https://... — 1 result(s) in 94ms
[uservoice-user-search] [INFO]    getSuggestionSupporterDetails → 47 row(s), 23/23 accounts enriched in 1842ms
```

**`verbose`** — additionally expands query params and response bodies:
```
[uservoice-user-search] [DEBUG]   → GET https://mycompany.uservoice.com/api/v2/admin/accounts/100
[uservoice-user-search] [VERBOSE]   query params:
[uservoice-user-search] [VERBOSE]     (none for this path)
[uservoice-user-search] [DEBUG]   ← 200 https://... — 1 result(s) in 94ms
[uservoice-user-search] [VERBOSE]   response body (843 chars):
{
  "account": {
    "id": 100,
    "name": "Acme Corp",
    "custom_fields": { "ARR": 50000, "Plan": "Enterprise" },
    ...
  }
}
```

Bearer tokens are **always redacted** regardless of log level.

---

## How Strategies Work

### Email search strategies (in order)

1. **`v2AdminFilterEmail`** — `GET /api/v2/admin/users?filter[email]=<email>` — exact-match filter; most precise when available.
2. **`v2AdminFilterEmailOrId`** — `GET /api/v2/admin/users?filter[email_or_external_id]=<email>` — alternative filter key used by some UserVoice versions.
3. **`v2AdminQueryEmail`** — `GET /api/v2/admin/users?q=<email>` — free-text search, post-filtered to exact email matches only.
4. **`v1SearchEmail`** — `GET /api/v1/users/search.json?query=<email>` — legacy endpoint; broadly supported but returns fewer fields.

### Name search strategies (in order)

1. **`v2AdminQueryName`** — `GET /api/v2/admin/users?q=<name>` — full-text admin search; richest field set.
2. **`v2AdminAutocomplete`** — `GET /api/v2/admin/autocomplete?type=user&q=<name>` — prefix-optimised; faster for partial names.
3. **`v1SearchName`** — `GET /api/v1/users/search.json?query=<name>` — legacy endpoint fallback.

Each strategy stops the chain as soon as it returns results (unless `all: true` is passed to `findByName`). API errors in a single strategy cause a fall-through to the next — only a `429 Too Many Requests` propagates immediately.

### Custom strategies

```js
import { UserVoiceSearch } from 'uservoice-user-search';
import { v2AdminFilterEmail } from 'uservoice-user-search/src/strategies/email.js';

const search = new UserVoiceSearch({
  subdomain: 'mycompany',
  token: process.env.UV_TOKEN,
  strategies: {
    email: [{ name: 'v2AdminFilterEmail', fn: v2AdminFilterEmail }],
  },
});
```

---

## Contributing

```bash
git clone https://github.com/ringcentral/uservoice-user-search.git
cd uservoice-user-search
npm install
npm test
npm run build
```

Pull requests are welcome. Please add tests for any new strategies or behaviour changes.

---

## License

MIT © RingCentral
