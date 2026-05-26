# uservoice-user-search

[![npm version](https://img.shields.io/npm/v/uservoice-user-search.svg)](https://www.npmjs.com/package/uservoice-user-search)
[![CI](https://github.com/ringcentral/uservoice-user-search/actions/workflows/ci.yml/badge.svg)](https://github.com/ringcentral/uservoice-user-search/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Reliable user search for the [UserVoice API](https://developer.uservoice.com/docs/api/v2/intro/) — by email address or display name.

UserVoice exposes several different endpoints for finding users, and each one behaves differently depending on the API token scope, plan tier, and UserVoice version. This module solves that problem by running a **prioritised sequence of search strategies** and returning as soon as one yields results. If an endpoint returns nothing or errors, the next strategy is tried automatically.

---

## Features

- **Single stable interface** — `findByEmail()`, `findByName()`, `find()`
- **Multi-strategy fallback** — four email strategies, three name strategies, tried in reliability order
- **Normalised response** — consistent `NormalizedUser` shape regardless of which API responded
- **Debug mode** — verbose per-strategy logging with Bearer token redaction
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
| `debug` | `boolean` | | `false` | Enable verbose console logging |
| `timeoutMs` | `number` | | `15000` | Per-request timeout in milliseconds |
| `strategies.email` | `Strategy[]` | | built-in | Override the email strategy list |
| `strategies.name` | `Strategy[]` | | built-in | Override the name strategy list |

Throws `UserVoiceConfigError` if `subdomain` or `token` are missing.

---

### `search.findByEmail(email)`

Search for a user by their exact email address.

```js
const user = await search.findByEmail('alice@example.com');
// → NormalizedUser | null
```

- Runs email strategies in order; returns the **first match** found.
- Returns `null` if no user is found across all strategies.
- Throws `UserVoiceRateLimitError` if the API rate-limits and retries are exhausted.

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

- With `all: false` (default): stops at the first strategy that returns any results.
- With `all: true`: runs all strategies concurrently and deduplicates by user ID.
- Returns `[]` if no users are found.

---

### `search.find(query, [options])`

Auto-routing convenience method.

```js
const results = await search.find('alice@example.com');  // → [NormalizedUser] or []
const results2 = await search.find('Alice Smith');        // → NormalizedUser[]
```

- If `query` matches the pattern `*@*.*`, delegates to `findByEmail` and wraps the result in an array.
- Otherwise delegates to `findByName`.
- `options` are forwarded to `findByName` (e.g. `{ all: true }`).

---

### `NormalizedUser` shape

Every method returns objects conforming to this shape:

```ts
{
  id:         number | string          // UserVoice user ID
  name:       string | null            // Display name
  email:      string | null            // Email address
  createdAt:  string | null            // ISO-8601 creation timestamp
  avatarUrl:  string | null            // Avatar URL
  state:      string | null            // e.g. "active", "blocked"
  roles:      string | null            // Comma-separated role list
  _raw:       object                   // Original API response object
}
```

The `_raw` field carries the complete, unmodified payload from whichever API responded, so you can access any field not surfaced by the normalised shape.

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
  const user = await search.findByEmail('alice@example.com');
} catch (err) {
  if (err instanceof UserVoiceRateLimitError) {
    console.error(`Rate limited. Try again in ${err.retryAfter}s.`);
  } else if (err instanceof UserVoiceApiError) {
    console.error(`API error ${err.status}: ${err.message}`);
  }
}
```

---

## Debug Mode

Enable `debug: true` to get detailed logs for every API call and strategy decision:

```js
const search = new UserVoiceSearch({
  subdomain: 'mycompany',
  token: process.env.UV_TOKEN,
  debug: true,
});

await search.findByEmail('alice@example.com');
```

Example output:

```
[uservoice-user-search] [INFO]  Initialized for subdomain "mycompany"
[uservoice-user-search] [INFO]  findByEmail("alice@example.com")
[uservoice-user-search] [STRAT] ▶ v2AdminFilterEmail — alice@example.com
[uservoice-user-search] [REQ]   GET https://mycompany.uservoice.com/api/v2/admin/users?filter%5Bemail%5D=alice%40example.com&per_page=10
[uservoice-user-search] [REQ]   headers: {"Authorization":"Bearer [REDACTED]","Accept":"application/json",...}
[uservoice-user-search] [RES]   200 https://mycompany.uservoice.com/... — 1 result(s) in 213ms
[uservoice-user-search] [STRAT] ✓ v2AdminFilterEmail — 1 result(s)
[uservoice-user-search] [INFO]  findByEmail resolved → user #1042 (Alice Smith)
```

Bearer tokens are **always redacted** in debug output.

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

You can replace or extend the strategy lists at instantiation time:

```js
import { UserVoiceSearch } from 'uservoice-user-search';
import { v2AdminFilterEmail } from 'uservoice-user-search/src/strategies/email.js';

const search = new UserVoiceSearch({
  subdomain: 'mycompany',
  token: process.env.UV_TOKEN,
  strategies: {
    email: [
      // Only use the single most reliable strategy for this tenant
      { name: 'v2AdminFilterEmail', fn: v2AdminFilterEmail },
    ],
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
