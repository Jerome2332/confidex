import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // E2E tests run against devnet, need longer timeouts
    testTimeout: 120_000,
    hookTimeout: 60_000,

    // Run tests sequentially (network rate limits)
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },

    // Only run E2E spec files
    include: ['**/*.spec.ts'],

    // No coverage for E2E (covered by unit tests)
    coverage: {
      enabled: false,
    },

    // Retry network failures once
    retry: 1,

    // Environment setup
    setupFiles: [],

    // Reporter
    reporters: ['verbose'],
  },
});
