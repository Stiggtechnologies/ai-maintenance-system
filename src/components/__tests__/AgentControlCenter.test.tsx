/**
 * AgentControlCenter tests
 * ========================
 * Covers DB-driven render, category filter, run-button opens modal,
 * empty state when migration 014 hasn't been applied.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockState = {
  agents: [] as Array<Record<string, unknown>>,
  session: { access_token: 'test-token' } as { access_token: string } | null,
};

vi.mock('../../lib/supabase', () => {
  const buildQuery = (table: string) => {
    let rows: Array<Record<string, unknown>> = [];
    if (table === 'v_agent_summary') rows = [...mockState.agents];

    const api: Record<string, (...args: unknown[]) => unknown> = {};
    api.select = () => api;
    api.eq = () => api;
    api.order = () => api;
    api.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
    api.then = (resolve: (v: { data: Array<Record<string, unknown>>; error: null }) => void) =>
      resolve({ data: rows, error: null });
    return api;
  };

  return {
    supabase: {
      from: (table: string) => buildQuery(table),
      rpc: vi.fn(async () => ({ data: null, error: null })),
      auth: {
        getSession: vi.fn(async () => ({ data: { session: mockState.session } })),
        getUser: vi.fn(async () => ({ data: { user: null } })),
      },
    },
  };
});

import { AgentControlCenter } from '../AgentControlCenter';

const STRATEGIC_AGENT = {
  code: 'reliability_engineering',
  name: 'Reliability Engineering',
  role: 'Predictive Analytics',
  category: 'strategic' as const,
  description: 'Predicts failures and optimizes system reliability.',
  capabilities: ['failure_prediction', 'rca', 'pattern_detection'],
  default_autonomy: 'advisory' as const,
  preferred_model: 'claude-opus-4-7',
  runs_24h: 12,
  successes_24h: 11,
  failures_24h: 1,
  avg_latency_ms_24h: 1450,
  last_run_at: new Date(Date.now() - 5 * 60_000).toISOString(),
};

const OPERATIONAL_AGENT = {
  code: 'work_order_management',
  name: 'Work Order Management',
  role: 'Execution Management',
  category: 'operational' as const,
  description: 'Automates work order lifecycle.',
  capabilities: ['wo_creation', 'task_assignment'],
  default_autonomy: 'autonomous' as const,
  preferred_model: 'claude-sonnet-4-6',
  runs_24h: 0,
  successes_24h: 0,
  failures_24h: 0,
  avg_latency_ms_24h: null,
  last_run_at: null,
};

describe('AgentControlCenter', () => {
  beforeEach(() => {
    mockState.agents = [];
    mockState.session = { access_token: 'test-token' };
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, response: 'test response' }), { status: 200 })
    ) as unknown as typeof fetch;
  });

  it('renders the empty state when migration 014 is not applied', async () => {
    render(<AgentControlCenter />);
    expect(await screen.findByTestId('agents-empty')).toBeInTheDocument();
    expect(screen.getByText(/Run migration 014/)).toBeInTheDocument();
  });

  it('renders agent cards with metrics from v_agent_summary', async () => {
    mockState.agents = [STRATEGIC_AGENT, OPERATIONAL_AGENT];

    render(<AgentControlCenter />);

    expect(await screen.findByTestId('agent-card-reliability_engineering')).toBeInTheDocument();
    expect(screen.getByTestId('agent-card-work_order_management')).toBeInTheDocument();
    expect(screen.getByText('Reliability Engineering')).toBeInTheDocument();
    expect(screen.getByText('Work Order Management')).toBeInTheDocument();
    // Latency rendered as ms
    expect(screen.getByText('1450ms')).toBeInTheDocument();
    // Last-run for never-run agent
    expect(screen.getByText('Never run')).toBeInTheDocument();
  });

  it('aggregates header stats from per-agent metrics', async () => {
    mockState.agents = [STRATEGIC_AGENT, OPERATIONAL_AGENT];

    render(<AgentControlCenter />);
    await screen.findByTestId('agent-card-reliability_engineering');

    // 2 agents, 12 runs, 11 successes, 92% success rate
    const stats = screen.getAllByText(/^\d+%?$|^—$/);
    const numbers = stats.map(el => el.textContent);
    expect(numbers).toEqual(expect.arrayContaining(['2', '12', '11', '92%']));
  });

  it('filters by category', async () => {
    mockState.agents = [STRATEGIC_AGENT, OPERATIONAL_AGENT];
    const user = userEvent.setup();

    render(<AgentControlCenter />);
    await screen.findByTestId('agent-card-reliability_engineering');

    await user.click(screen.getByRole('button', { name: 'Operational' }));

    await waitFor(() => {
      expect(screen.queryByTestId('agent-card-reliability_engineering')).not.toBeInTheDocument();
      expect(screen.getByTestId('agent-card-work_order_management')).toBeInTheDocument();
    });
  });

  it('opens AgentRunModal when Run is clicked', async () => {
    mockState.agents = [STRATEGIC_AGENT];
    const user = userEvent.setup();

    render(<AgentControlCenter />);
    const runBtn = await screen.findByTestId('run-reliability_engineering');
    await user.click(runBtn);

    expect(await screen.findByTestId('agent-run-modal')).toBeInTheDocument();
    // Modal shows the agent name
    const headings = screen.getAllByText('Reliability Engineering');
    expect(headings.length).toBeGreaterThan(1); // card + modal
  });

  it('renders capability chips truncated to 3 with overflow indicator', async () => {
    const manyCaps = {
      ...STRATEGIC_AGENT,
      capabilities: ['cap1', 'cap2', 'cap3', 'cap4', 'cap5'],
    };
    mockState.agents = [manyCaps];

    render(<AgentControlCenter />);
    await screen.findByTestId('agent-card-reliability_engineering');

    // First three rendered, +2 indicator for overflow
    expect(screen.getByText('cap1')).toBeInTheDocument();
    expect(screen.getByText('cap2')).toBeInTheDocument();
    expect(screen.getByText('cap3')).toBeInTheDocument();
    expect(screen.queryByText('cap4')).not.toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
  });
});
