import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // supabase/functions/_shared/reliability-engineer-core.test.ts sat outside
    // this glob and had NEVER run, while package.json and the qualification
    // workflow both named it next to a filter that did match — so vitest exited
    // 0 and the miss was silent.
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'supabase/functions/**/*.{test,spec}.{ts,tsx}',
    ],
  },
});
