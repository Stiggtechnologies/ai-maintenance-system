/**
 * Test-only mock for ../lib/supabase.
 *
 * Returns a chainable query builder that resolves to the data set via
 * `setMockData(table, data)`. Only the methods we actually call are
 * implemented (from, select, eq, order, maybeSingle, then-able).
 *
 * Usage in a test file:
 *   vi.mock('../lib/supabase', () => import('../test/mocks/supabase'));
 *   import { setMockData, setMockSession } from '../test/mocks/supabase';
 *   setMockData('v_integrations_for_org', [...rows]);
 */
import { vi } from 'vitest';

type Row = Record<string, unknown>;
const mockData = new Map<string, Row[]>();
let mockSession: { access_token: string } | null = { access_token: 'test-token' };

export function setMockData(table: string, rows: Row[]) {
  mockData.set(table, rows);
}

export function setMockSession(session: { access_token: string } | null) {
  mockSession = session;
}

export function resetMocks() {
  mockData.clear();
  mockSession = { access_token: 'test-token' };
}

function builder(table: string) {
  let rows: Row[] = [...(mockData.get(table) ?? [])];
  const api: Record<string, (...args: unknown[]) => unknown> = {};

  api.select = () => api;
  api.eq = (col: string, val: unknown) => {
    rows = rows.filter(r => r[col] === val);
    return api;
  };
  api.order = () => api;
  api.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
  api.single = async () => ({ data: rows[0] ?? null, error: null });
  // The chain itself is await-able for plain .select() queries
  api.then = (resolve: (v: { data: Row[]; error: null }) => void) => {
    resolve({ data: rows, error: null });
  };
  return api;
}

export const supabase = {
  from: (table: string) => builder(table),
  rpc: vi.fn(async () => ({ data: null, error: null })),
  auth: {
    getSession: vi.fn(async () => ({ data: { session: mockSession } })),
    getUser: vi.fn(async () => ({ data: { user: null } })),
  },
};
