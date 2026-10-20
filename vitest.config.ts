import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests start Fastify and touch real files; the first one pays for module loading.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'backend',
          environment: 'node',
          include: ['src/**/*.test.ts'],
          exclude: ['src/frontend/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'frontend',
          environment: 'happy-dom',
          environmentOptions: { happyDOM: { url: 'https://apps.example.com/' } },
          include: ['src/frontend/**/*.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.test.ts',
        'src/**/testing/**',
        'src/index.ts',
        'src/worker.ts',
        'src/frontend/scripts/main.ts',
        'src/action/main.ts',
        'src/action/dist/**',
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
