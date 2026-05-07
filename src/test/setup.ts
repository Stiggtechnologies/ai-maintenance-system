/**
 * Vitest setup — runs once before each test file.
 *
 * - Loads @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
 * - Stubs window.matchMedia for components that read it
 * - Stubs window.confirm so destructive actions (Disconnect/Delete) auto-confirm in tests
 * - Stubs Supabase env vars expected by lib/supabase.ts
 */
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Supabase-related env vars need to exist for lib/supabase.ts to construct a client without throwing.
// Use vi.stubEnv for `import.meta.env.VITE_*` — direct assignment doesn't propagate reliably under Vitest.
vi.stubEnv('VITE_SUPABASE_URL', 'http://localhost:54321');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon-test-key');

// Polyfill for matchMedia (used by some Tailwind / framer-motion code paths)
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as typeof window.matchMedia;
}

// Auto-confirm window.confirm in tests so Disconnect/Delete proceed
if (typeof window !== 'undefined') {
  window.confirm = vi.fn(() => true);
}
