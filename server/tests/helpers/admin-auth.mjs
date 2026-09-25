// The admin credential the gated write routes expect, for tests that exercise them.
//
// WHY A SHARED CONSTANT rather than a header literal per test file. Three routes
// gained requireAdminAuth in one change — POST /api/lifecycle/block, POST
// /api/lifecycle/unblock, PUT /api/v1/registry/:id/status and PATCH
// /api/v1/ai-platforms/:host — and every existing test of them had to start
// sending a token. Spread across five files as a literal, the next person moving
// the credential would have to find all of them; here it is one edit.
//
// WHY THE DEFAULT TOKEN and not an env override. src/auth.js falls back to the
// well-known 'dev-admin-token' when ADMIN_TOKEN is unset, and the test runner
// (`node --import tsx --test`) loads no .env, so this is the value the middleware
// is comparing against in a test process. Deliberately NOT ADMIN_AUTH_OPEN=true:
// that env var is read once at module load, which an `import` in a test file has
// already passed, and opening the middleware would stop the tests proving the
// routes are gated at all.
export const TEST_ADMIN_TOKEN = 'dev-admin-token';

/** `content-type` + the admin bearer — the headers a gated JSON write needs. */
export function adminJsonHeaders(extra) {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${TEST_ADMIN_TOKEN}`,
    ...extra,
  };
}
