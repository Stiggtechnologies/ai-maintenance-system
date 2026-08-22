import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SyncStreamEvent } from "../types/sync-stream";
import { SyncActivityTimeline, buildSyncActivity } from "./SyncActivityTimeline";

describe("SyncActivityTimeline", () => {
  it("shows immediate progress without inventing an operational check", () => {
    render(<SyncActivityTimeline events={[]} status="streaming" />);
    expect(screen.getByText("Sync is investigating")).toBeInTheDocument();
    expect(screen.getByText("Reviewing your request")).toBeInTheDocument();
    expect(screen.queryByText("Operational KPIs reviewed")).not.toBeInTheDocument();
  });

  it("shows the exact operational check only after the typed completion event", () => {
    const events: SyncStreamEvent[] = [
      {
        type: "investigation.check.started",
        checkId: "operational-kpis",
        label: "Reviewing operational KPIs",
        category: "operations",
      },
      {
        type: "investigation.check.completed",
        check: {
          id: "operational-kpis",
          label: "Reviewing operational KPIs",
          category: "operations",
          state: "attention",
          detail: "14 role-visible indicators · 4 breached · 1 watch",
        },
      },
      {
        type: "investigation.check.completed",
        check: {
          id: "asset-data-integrity",
          label: "Checking asset data integrity",
          category: "data_integrity",
          state: "attention",
          detail: "2 integrity indicators require attention",
        },
      },
      {
        type: "investigation.check.completed",
        check: {
          id: "safety-indicators",
          label: "Cross-checking safety indicators",
          category: "safety",
          state: "ok",
          detail: "3 role-visible safety/risk indicators",
        },
      },
    ];

    render(<SyncActivityTimeline events={events} status="streaming" />);
    expect(screen.getByText("Operational KPIs reviewed")).toBeInTheDocument();
    expect(screen.getByText("Asset data integrity checked")).toBeInTheDocument();
    expect(screen.getByText("Safety indicators cross-checked")).toBeInTheDocument();
    expect(screen.getByText(/4 breached/)).toBeInTheDocument();
  });

  it("summarizes KB retrieval without exposing raw query/source identifiers", () => {
    const events: SyncStreamEvent[] = [
      { type: "retrieval.started", query: "private raw retrieval query" },
      {
        type: "retrieval.completed",
        evidence: [
          {
            id: "R1",
            sourceType: "knowledge",
            sourceId: "raw-source-id",
            title: "Approved procedure",
          },
        ],
      },
    ];
    render(<SyncActivityTimeline events={events} status="streaming" />);
    expect(screen.getByText("Approved engineering evidence checked")).toBeInTheDocument();
    expect(screen.getByText(/1 source/)).toBeInTheDocument();
    expect(screen.queryByText(/private raw retrieval query/)).not.toBeInTheDocument();
    expect(screen.queryByText(/raw-source-id/)).not.toBeInTheDocument();
  });

  it("says consulting only for an actually executed specialist", () => {
    const executed: SyncStreamEvent[] = [
      {
        type: "agent.started",
        agentId: "rca-fracas",
        label: "RCA / FRACAS specialist",
        executionMode: "executed",
      },
    ];
    const applied: SyncStreamEvent[] = [
      {
        type: "agent.started",
        agentId: "rca-fracas",
        label: "RCA / FRACAS specialist",
        executionMode: "applied",
      },
    ];
    expect(buildSyncActivity(executed, "streaming").some((item) => item.label === "Consulting RCA / FRACAS specialist")).toBe(true);
    expect(buildSyncActivity(applied, "streaming").some((item) => item.label === "Applying RCA / FRACAS specialist discipline")).toBe(true);
  });

  it("keeps tool proposal/execution ids out of the visible activity model", () => {
    const items = buildSyncActivity(
      [
        { type: "tool.awaiting_approval", proposalId: "proposal-secret-id" },
        { type: "tool.started", executionId: "execution-secret-id" },
      ],
      "streaming",
    );
    expect(JSON.stringify(items)).not.toContain("proposal-secret-id");
    expect(JSON.stringify(items)).not.toContain("execution-secret-id");
    expect(items.some((item) => item.label === "Executing confirmed action")).toBe(true);
  });
});
