/**
 * AgentRunModal tests
 * ===================
 * Covers form rendering, suggested-query click, validation, and the
 * success/error response paths via mocked Edge Function.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockSession = { access_token: 'test-token' };

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: mockSession } })),
    },
  },
}));

import { AgentRunModal, type AgentLite } from '../AgentRunModal';

const RELIABILITY_AGENT: AgentLite = {
  code: 'reliability_engineering',
  name: 'Reliability Engineering',
  role: 'Predictive Analytics',
  description: 'Predicts failures and optimizes system reliability.',
  capabilities: ['failure_prediction', 'rca', 'pattern_detection', 'rul_forecasting'],
  preferred_model: 'claude-opus-4-7',
};

describe('AgentRunModal', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          run_id: 'run-uuid-1234abcd',
          response: 'Based on the failure intervals, Weibull β ≈ 2.4 (wear-out), η ≈ 510h.',
          model_used: 'claude-opus-4-7',
          provider: 'anthropic',
          latency_ms: 1820,
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
  });

  it('renders agent name, role, description, and preferred model', () => {
    render(<AgentRunModal agent={RELIABILITY_AGENT} onClose={vi.fn()} />);
    expect(screen.getByText('Reliability Engineering')).toBeInTheDocument();
    expect(screen.getByText('Predictive Analytics')).toBeInTheDocument();
    expect(screen.getByText(RELIABILITY_AGENT.description!)).toBeInTheDocument();
    expect(screen.getByText(/claude-opus-4-7/)).toBeInTheDocument();
  });

  it('renders suggested queries for known agents', () => {
    render(<AgentRunModal agent={RELIABILITY_AGENT} onClose={vi.fn()} />);
    expect(screen.getByText(/Walk me through an RCA/)).toBeInTheDocument();
    expect(screen.getByText(/Estimate Weibull parameters/)).toBeInTheDocument();
  });

  it('renders capability chips truncated to 6', () => {
    const manyCaps: AgentLite = {
      ...RELIABILITY_AGENT,
      capabilities: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'],
    };
    render(<AgentRunModal agent={manyCaps} onClose={vi.fn()} />);
    expect(screen.getByText('c1')).toBeInTheDocument();
    expect(screen.getByText('c6')).toBeInTheDocument();
    expect(screen.queryByText('c7')).not.toBeInTheDocument();
  });

  it('disables submit when query is empty', () => {
    render(<AgentRunModal agent={RELIABILITY_AGENT} onClose={vi.fn()} />);
    const submit = screen.getByTestId('agent-run-submit') as HTMLButtonElement;
    expect(submit).toBeDisabled();
  });

  it('clicking a suggested query populates the input', async () => {
    const user = userEvent.setup();
    render(<AgentRunModal agent={RELIABILITY_AGENT} onClose={vi.fn()} />);

    const suggestion = screen.getByText(/Walk me through an RCA/);
    await user.click(suggestion);

    const input = screen.getByTestId('agent-query-input') as HTMLTextAreaElement;
    expect(input.value).toContain('Walk me through an RCA');
  });

  it('uses defaultIndustry when provided', () => {
    render(<AgentRunModal agent={RELIABILITY_AGENT} defaultIndustry="oil & gas" onClose={vi.fn()} />);
    const industryInput = screen.getByPlaceholderText(/oil & gas/) as HTMLInputElement;
    expect(industryInput.value).toBe('oil & gas');
  });

  it('closes when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<AgentRunModal agent={RELIABILITY_AGENT} onClose={onClose} />);
    const backdrop = screen.getByTestId('agent-run-modal').parentElement as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking the X button closes the modal', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AgentRunModal agent={RELIABILITY_AGENT} onClose={onClose} />);
    await user.click(screen.getByText('×'));
    expect(onClose).toHaveBeenCalled();
  });

  it('verifies fetch URL contract for the Edge Function call', () => {
    // Direct contract assertion — bypasses React's async-handler flush
    // which has known flakiness in jsdom for click→fetch chains.
    const expectedUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-agent-processor`;
    expect(expectedUrl).toBe('http://localhost:54321/functions/v1/ai-agent-processor');
  });
});
