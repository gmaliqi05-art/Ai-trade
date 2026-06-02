import { defineConfig } from 'vitest/config';

// Konfigurimi i testeve për motorin AI Trader (dhe çdo test tjetër në src/).
export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/ai-trader/**/*.ts'],
      exclude: ['src/ai-trader/**/*.test.ts'],
    },
  },
});
