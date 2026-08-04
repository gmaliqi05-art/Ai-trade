import { defineConfig } from 'vitest/config';

// Konfigurimi i testeve për motorin AI Trader (dhe çdo test tjetër në src/).
export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    // Edhe funksionet e serverit: parseri i mesazheve të Telegram-it mbrohet vetëm nga një listë
    // rastesh reale, ndaj testi i tij duhet të vrapojë bashkë me të tjerët.
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'supabase/functions/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/ai-trader/**/*.ts'],
      exclude: ['src/ai-trader/**/*.test.ts'],
    },
  },
});
