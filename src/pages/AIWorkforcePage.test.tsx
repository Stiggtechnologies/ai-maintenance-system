/**
 * The search box on this page arrived from a deleted component
 * (`AgentControlCenter`), which filtered a hard-coded array and so could
 * never disagree with the rest of the screen. Here it filters live rows
 * alongside two existing filters, and the risk that carries is composition:
 * a search that ORs with the status and autonomy pills silently widens the
 * result set, showing agents the operator has just filtered out. An operator
 * who narrows to "Idle" and then types a name must not be shown an active
 * agent because the name matched.
 *
 * These tests hold the conjunction, and hold the empty state that tells the
 * operator their query matched nothing — the alternative being a blank grid
 * that reads as "this organisation has no agents".
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AgentRow } from "../types/operating";
import { AIWorkforce } from "./AIWorkforcePage";

const getAgents = vi.fn();

vi.mock("../services/operatingLoopService", async () => {
  const actual = await vi.importActual<
    typeof import("../services/operatingLoopService")
  >("../services/operatingLoopService");
  return { ...actual, getAgents: () => getAgents() };
});

function agent(over: Partial<AgentRow> & Pick<AgentRow, "id" | "name">): AgentRow {
  return {
    organization_id: "org-1",
    key: null,
    category: "operational",
    status: "active",
    autonomy_mode: "advisory",
    current_task: "Idle",
    recommendations_generated: 0,
    actions_executed: 0,
    approvals_pending: 0,
    confidence: 80,
    supervisor: null,
    last_action: null,
    last_action_at: null,
    created_at: new Date().toISOString(),
    ...over,
  };
}

const AGENTS: AgentRow[] = [
  agent({
    id: "a1",
    name: "Reliability Engineering Agent",
    category: "reliability",
    status: "active",
  }),
  agent({ id: "a2", name: "Inventory Agent", status: "idle" }),
  agent({ id: "a3", name: "Condition Monitoring Agent", status: "active" }),
];

function renderPage() {
  getAgents.mockResolvedValue(AGENTS);
  return render(<AIWorkforce />);
}

const searchBox = () =>
  screen.getByLabelText("Search agents by name or purpose");

describe("AIWorkforce search", () => {
  it("lists every agent before a query is typed", async () => {
    renderPage();
    expect(await screen.findByText("Inventory Agent")).toBeInTheDocument();
    expect(screen.getByText("Reliability Engineering Agent")).toBeInTheDocument();
    expect(screen.getByText("Condition Monitoring Agent")).toBeInTheDocument();
  });

  it("narrows by name, case-insensitively", async () => {
    renderPage();
    await screen.findByText("Inventory Agent");

    fireEvent.change(searchBox(), { target: { value: "inVENTory" } });

    expect(screen.getByText("Inventory Agent")).toBeInTheDocument();
    expect(screen.queryByText("Condition Monitoring Agent")).toBeNull();
    expect(screen.queryByText("Reliability Engineering Agent")).toBeNull();
  });

  it("narrows by purpose, so a category finds its agents", async () => {
    renderPage();
    await screen.findByText("Inventory Agent");

    // purpose renders as `Specialized <category> agent`.
    fireEvent.change(searchBox(), { target: { value: "reliability" } });

    expect(screen.getByText("Reliability Engineering Agent")).toBeInTheDocument();
    expect(screen.queryByText("Inventory Agent")).toBeNull();
  });

  it("intersects with the status filter rather than widening it", async () => {
    renderPage();
    await screen.findByText("Inventory Agent");

    fireEvent.click(screen.getByRole("button", { name: "Idle" }));
    // Matches an ACTIVE agent by name while the filter is pinned to Idle.
    fireEvent.change(searchBox(), { target: { value: "Condition" } });

    // The name match must not resurrect an agent the status filter excluded.
    expect(screen.queryByText("Condition Monitoring Agent")).toBeNull();
    expect(screen.queryByText("Inventory Agent")).toBeNull();
    expect(
      screen.getByText("No agents match the selected filters"),
    ).toBeInTheDocument();
  });

  it("says nothing matched instead of rendering an empty grid", async () => {
    renderPage();
    await screen.findByText("Inventory Agent");

    fireEvent.change(searchBox(), { target: { value: "zzzz-no-such-agent" } });

    expect(
      screen.getByText("No agents match the selected filters"),
    ).toBeInTheDocument();
  });

  it("restores the full list when the query is cleared", async () => {
    renderPage();
    await screen.findByText("Inventory Agent");

    fireEvent.change(searchBox(), { target: { value: "Inventory" } });
    expect(screen.queryByText("Condition Monitoring Agent")).toBeNull();

    fireEvent.change(searchBox(), { target: { value: "   " } });

    // Whitespace is not a query; trimming keeps a stray space from emptying
    // the board.
    expect(screen.getByText("Condition Monitoring Agent")).toBeInTheDocument();
    expect(screen.getByText("Inventory Agent")).toBeInTheDocument();
  });
});
