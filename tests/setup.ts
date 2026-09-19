// Executed by Vitest BEFORE any test file's own imports are evaluated (setupFiles
// run ahead of the test file's module graph). This is the only reliable place to
// set process.env overrides for integration tests: assigning to process.env at the
// top of a *.test.ts file does NOT work reliably, because ES `import` statements
// are hoisted above all other statements in the file (including ones written
// textually first), so config/env.ts (which reads process.env once at import time
// and caches the result) would already have run with the old value.
process.env.TEXTBEE_WEBHOOK_SECRET = process.env.TEXTBEE_WEBHOOK_SECRET || 'test-webhook-secret';
