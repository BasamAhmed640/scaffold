import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    // Never talk to a real Anki from tests: nothing listens on the discard port. Tests that need
    // AnkiConnect start the mock server (test/helpers/anki-mock.ts) and inject its client.
    env: { SCAFFOLD_ANKI_URL: 'http://127.0.0.1:9', SCAFFOLD_NO_OPEN: '1' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'json-summary', 'text'],
    },
  },
});
