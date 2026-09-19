// Executed by Vitest BEFORE any test file's own imports are evaluated (setupFiles
// run ahead of the test file's module graph). This is the only reliable place to
// set process.env overrides for integration tests: assigning to process.env at the
// top of a *.test.ts file does NOT work reliably, because ES `import` statements
// are hoisted above all other statements in the file (including ones written
// textually first), so config/env.ts (which reads process.env once at import time
// and caches the result) would already have run with the old value.
import { assertLocalTestDatabase } from './dbSafety';

// MUST run first, before any test file or Prisma client touches the DB. Protects
// against an ambient/leaked DATABASE_URL (e.g. from a shell that sourced a prod
// env file) silently pointing the destructive test suite at a real database.
assertLocalTestDatabase(process.env.DATABASE_URL);

// Always force a fixed value — must NOT fall back to whatever real secret is in
// the developer's local .env (this repo's .env holds real TextBee credentials
// for manual dry-run testing), or webhook signature tests become flaky/broken
// depending on ambient environment state.
process.env.TEXTBEE_WEBHOOK_SECRET = 'test-webhook-secret';
