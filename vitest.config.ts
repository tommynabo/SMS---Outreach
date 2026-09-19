import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 20000,
    hookTimeout: 20000,
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    // All integration tests share one disposable Postgres database and call
    // resetDatabase() (a full DELETE across tables) in beforeEach. Running test
    // files in parallel would let one file's reset wipe rows another file is
    // mid-test with, causing spurious FK violations / "missing template" errors.
    // Force fully sequential execution across files (and workers) instead.
    fileParallelism: false,
  },
});
