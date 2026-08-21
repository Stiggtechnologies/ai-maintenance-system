import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SyncStreamEvent } from "../types/sync-stream";
import { SyncActivityTimeline, buildSyncActivity } from "./SyncActivityTimeline";

describe("SyncActivityTimeline", () => {
  it("shows immediate truthful progress before other stream events arrive", () => {
    render(<SyncActivityTimeline events={[]} status="streaming" />);

    expect(screen.getByText("Sync is working")).toBeInTheDocument();
    expect(screen.getByText("Reviewing your request")).toBeInTheDocument();
  });

  it("summarizes retrieval without leaking raw queries or source identifiers", () => {
    const events: SyncStreamEvent[] = [
      { type: "retrieval.started", query: "private raw retrieval query" },
      {
        type: "retrieval.completed",
        evidence: [
          {
            id: "evidence-secret-id",
            sourceType: "knowledge",
            sourceId: "raw-source-id",
            title: "Approved procedure",
          },
        ],
      },
    ];

    render(<SyncActivityTimeline events={events} status="streaming" />);

    expect(screen.getByText("Evidence checked")).toBeInTheDocument();
    expect(screen.getByText(/1 source/)).toBeInTheDocument();
    expect(screen.queryByText(/private raw retrieval query/)).not.toBeInTheDocument();
    expect(screen.queryByText(/raw-source-id/)).not.toBeInTheDocument();
  });

  it("uses a readable specialist name and hides internal execution identifiers", () => {
    const events: SyncStreamEvent[] = [
      { type: "agent.started", agentId: "asset_health_agent" },
      { type: "agent.completed", agentId: "asset_health_agent", status: "ok" },
      { type: "tool.started", executionId: "execution-secret-id" },
    ];

    render(<SyncActivityTimeline events={events} status="streaming" />);

    expect(screen.getByText("Asset Health checked")).toBeInTheDocument();
    expect(screen.getByText("Executing confirmed action")).toBeInTheDocument();
    expect(screen.queryByText(/execution-secret-id/)).not.toBeInTheDocument();
  });

  it("shows the human approval boundary as an observable state", () => {
    const items = buildSyncActivity(
      [{ type: "tool.awaiting_approval", proposalId: "proposal-secret-id" }],
      "streaming",
    );

    expect(items.some((item) => item.label === "Waiting for your confirmation")).toBe(true);
    expect(JSON.stringify(items)).not.toContain("proposal-secret-id");
  });
});
