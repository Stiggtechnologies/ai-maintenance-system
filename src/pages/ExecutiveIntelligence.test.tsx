/**
 * These tests exist because of what green means on this page.
 *
 * Migration 20260908090000 stopped the database from stamping trend KPIs
 * `on_target`, but the headline strip re-created the same lie in the browser
 * by rendering `STATUS_STYLE[row.status ?? "on_target"]` — a KPI nobody
 * measured got the pass tile, on the one surface an executive actually reads.
 * Nothing in the repository referenced a KPI status, so the honesty rule was
 * held by a comment. These assertions hold it instead: an unjudged KPI is
 * never green, and it says in words which kind of unjudged it is.
 */
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KpiDashboard, KpiRow } from "../services/kpiService";
import { ExecutiveIntelligence } from "./ExecutiveIntelligence";

const loadDashboard = vi.fn();

vi.mock("../services/kpiService", async () => {
  const actual = await vi.importActual<typeof import("../services/kpiService")>(
    "../services/kpiService",
  );
  return { ...actual, getKpiDashboard: () => loadDashboard() };
});

// Realtime is the page's other Supabase dependency; the KPI status vocabulary
// does not depend on the stream, only on the row it is given.
vi.mock("../lib/supabase", () => ({
  supabase: {
    channel: () => ({ on: () => undefined, subscribe: () => undefined }),
    removeChannel: () => undefined,
  },
}));

// The six panels below the KPI sections each load their own Supabase data.
// Stubbing them keeps a failure here unambiguously a KPI-status failure.
vi.mock("../components/OperatingContext", () => ({
  OperatingContext: () => null,
}));
vi.mock("../components/WorkManagementHealth", () => ({
  WorkManagementHealth: () => null,
}));
vi.mock("../components/SegmentedReliability", () => ({
  SegmentedReliability: () => null,
}));
vi.mock("../components/AccountabilityCascade", () => ({
  AccountabilityCascade: () => null,
}));
vi.mock("../components/ValueManagement", () => ({
  ValueManagement: () => null,
}));
vi.mock("../components/EnvironmentalPerformance", () => ({
  EnvironmentalPerformance: () => null,
}));

/** A dashboard row with everything the page reads, overridable per case. */
function kpiRow(overrides: Partial<KpiRow> & Pick<KpiRow, "kpi_key">): KpiRow {
  return {
    name: `KPI ${overrides.kpi_key}`,
    page: "executive",
    formula: "documented in the KPI catalog",
    target_label: "per catalog",
    direction: "up",
    unit: null,
    accountable: "Asset Management Director",
    responsible: "Reliability Manager",
    consulted: null,
    informed: null,
    accountability_tier: "executive",
    agent_owner: null,
    computable: true,
    source_note: null,
    value: 1,
    status: null,
    variance_pct: null,
    confidence: null,
    computed_from: { source: "kpi_values" },
    computed_at: "2026-08-16T00:00:00.000Z",
    ...overrides,
  };
}

function renderDashboard(kpis: KpiRow[]) {
  const dashboard: KpiDashboard = { role: "executive", kpis };
  loadDashboard.mockResolvedValue(dashboard);
  return render(
    <MemoryRouter>
      <ExecutiveIntelligence />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  loadDashboard.mockReset();
});

describe("ExecutiveIntelligence KPI status", () => {
  it("never renders a headline KPI with no status in the on-target style", async () => {
    renderDashboard([kpiRow({ kpi_key: "oee", status: null })]);

    const tile = await screen.findByTestId("headline-kpi-oee");
    expect(tile.className).not.toContain("green");
    expect(within(tile).getByText("Awaiting source")).toBeInTheDocument();
  });

  it("renders a headline KPI with no target as trend-only, not as a pass", async () => {
    renderDashboard([
      kpiRow({ kpi_key: "asset_risk_index", status: "not_assessed" }),
    ]);

    const tile = await screen.findByTestId("headline-kpi-asset_risk_index");
    expect(tile.className).not.toContain("green");
    expect(
      within(tile).getByText("No target — trend only"),
    ).toBeInTheDocument();
  });

  it("renders a KPI card with no target as trend-only in the neutral style", async () => {
    renderDashboard([
      kpiRow({
        kpi_key: "mttr",
        name: "Mean Time To Repair",
        page: "reliability",
        status: "not_assessed",
      }),
    ]);

    const badge = await screen.findByText("No target — trend only");
    expect(badge.className).not.toContain("green");
    expect(badge.className).toContain("text-slate-400");
  });

  it("still shows a genuinely judged KPI as on target", async () => {
    renderDashboard([kpiRow({ kpi_key: "oee", status: "on_target" })]);

    const tile = await screen.findByTestId("headline-kpi-oee");
    expect(tile.className).toContain("bg-green-500/10");
    expect(within(tile).getByText("On target")).toBeInTheDocument();
  });

  it("keeps a breach out of the on-target style and routable", async () => {
    renderDashboard([
      kpiRow({ kpi_key: "cost_of_downtime", status: "breach" }),
    ]);

    const tile = await screen.findByTestId("headline-kpi-cost_of_downtime");
    expect(tile.className).not.toContain("green");
    expect(within(tile).getByText("Breach")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /1 KPI breach/ }),
    ).toBeInTheDocument();
  });

  it("treats a status this build does not recognise as unjudged", async () => {
    renderDashboard([
      kpiRow({
        kpi_key: "oee",
        status: "provisional" as unknown as KpiRow["status"],
      }),
    ]);

    const tile = await screen.findByTestId("headline-kpi-oee");
    expect(tile.className).not.toContain("green");
    expect(within(tile).getByText("Awaiting source")).toBeInTheDocument();
  });
});

/**
 * The board seat (migration 20260912090000) receives the four
 * Board-accountable KPIs, three of which are seeded computable=false. The
 * screen must say that in words — granting the seat grants one live number
 * and three named gaps, and the note derives its counts from the rows so it
 * can never overstate or outlive the gap.
 */
describe("ExecutiveIntelligence board-tier honesty", () => {
  it("states how many board-accountable KPIs still await their source", async () => {
    renderDashboard([
      kpiRow({
        kpi_key: "asset_value_realization",
        accountability_tier: "board",
        computable: true,
      }),
      kpiRow({
        kpi_key: "strategic_asset_alignment",
        accountability_tier: "board",
        computable: false,
        source_note: "Strategy register — tag assets to strategic objectives",
      }),
      kpiRow({
        kpi_key: "am_maturity_index",
        accountability_tier: "board",
        computable: false,
        source_note: "ISO 55001 maturity assessment input",
      }),
      kpiRow({
        kpi_key: "stakeholder_value_index",
        accountability_tier: "board",
        computable: false,
        source_note: "Stakeholder scoring input",
      }),
    ]);

    const note = await screen.findByTestId("board-kpi-honesty");
    expect(note.textContent).toContain("3 of 4");
    expect(note.textContent).toContain("Awaiting source");
  });

  it("renders no board note when every board-accountable KPI is computable", async () => {
    renderDashboard([
      kpiRow({
        kpi_key: "asset_value_realization",
        accountability_tier: "board",
        computable: true,
      }),
    ]);

    await screen.findByTestId("headline-kpi-asset_value_realization");
    expect(screen.queryByTestId("board-kpi-honesty")).toBeNull();
  });
});
