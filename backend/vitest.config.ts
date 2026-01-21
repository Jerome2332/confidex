import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Node environment for backend tests
    environment: 'node',
    globals: true,

    // Test file patterns
    include: ['src/**/*.{test,spec}.ts'],

    // Timeout for async operations
    testTimeout: 30_000,
    hookTimeout: 10_000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.test.ts',
        'src/__tests__/**',
        'src/**/index.ts',
        'src/types/**',
      ],
      // PRD-004 Coverage Thresholds: Backend >80%
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },

    // Mock configuration
    mockReset: true,
    clearMocks: true,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
