/**
 * Hard guard against ever running the destructive test suite (full-table
 * `deleteMany` in `resetDatabase()`, called in every integration test's
 * `beforeEach`) against a non-disposable database. This exists because a
 * leaked/ambient `DATABASE_URL` (e.g. from `source`-ing a pulled prod env
 * file in a shell) can silently override the local `.env` value and cause
 * `vitest run` to wipe production. Never remove or loosen this check.
 */
export function assertLocalTestDatabase(url: string | undefined): void {
  if (!url) {
    throw new Error('DATABASE_URL is not set — refusing to run the destructive test suite.');
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL — refusing to run the destructive test suite.');
  }

  const isLocalHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  const dbName = parsed.pathname.replace(/^\//, '');
  const looksLikeTestDb = /test/i.test(dbName);

  if (!isLocalHost || !looksLikeTestDb) {
    const redacted = url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@');
    throw new Error(
      `Refusing to run the destructive test suite against "${redacted}". ` +
        'DATABASE_URL must point at a local database (host localhost/127.0.0.1) whose name contains ' +
        '"test" (e.g. sms_outreach_test). Every integration test wipes ALL tables in beforeEach.',
    );
  }
}
