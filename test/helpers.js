/**
 * Shared test helpers and mock factories.
 */

/**
 * Build a minimal raw UserVoice v2 user object.
 * @param {Partial<Record<string,unknown>>} overrides
 */
export function rawV2User(overrides = {}) {
  return {
    id: 1001,
    name: 'Alice Smith',
    email: 'alice@example.com',
    created_at: '2023-06-01T10:00:00Z',
    avatar_url: 'https://cdn.uservoice.com/avatars/alice.jpg',
    state: 'active',
    roles: ['owner'],
    ...overrides,
  };
}

/**
 * Build a minimal raw v1 user object (fewer fields).
 */
export function rawV1User(overrides = {}) {
  return {
    id: 1001,
    name: 'Alice Smith',
    email: 'alice@example.com',
    created_at: '2023-06-01T10:00:00Z',
    ...overrides,
  };
}

/**
 * Return a v2 collection response body.
 * @param {object[]} users
 */
export function v2Response(users) {
  return { users, pagination: { total_records: users.length, page: 1, per_page: 25 } };
}

/**
 * Return a v1 search response body.
 * @param {object[]} users
 */
export function v1Response(users) {
  return { response: users };
}

/**
 * Return an autocomplete response body.
 * @param {object[]} users
 */
export function autocompleteResponse(users) {
  return { autocomplete: { users } };
}

/**
 * Create a mock Client whose `get` method resolves/rejects based on a
 * per-path/params dispatch table.
 *
 * @param {Array<{path: string|RegExp, params?: Record<string,string>, body: unknown, error?: Error}>} routes
 * @returns {{ client: object, calls: Array }}
 */
export function mockClient(routes) {
  const calls = [];

  const client = {
    get: vi.fn(async (path, params = {}) => {
      calls.push({ path, params });

      for (const route of routes) {
        const pathMatch =
          route.path instanceof RegExp
            ? route.path.test(path)
            : route.path === path;

        const paramsMatch =
          !route.params ||
          Object.entries(route.params).every(
            ([k, v]) => String(params[k]) === String(v),
          );

        if (pathMatch && paramsMatch) {
          if (route.error) throw route.error;
          return route.body;
        }
      }

      // Default: empty v2 response
      return { users: [] };
    }),
  };

  return { client, calls };
}

/**
 * Silent logger for use in unit tests.
 */
export const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  request: () => {},
  response: () => {},
  strategy: () => {},
};
