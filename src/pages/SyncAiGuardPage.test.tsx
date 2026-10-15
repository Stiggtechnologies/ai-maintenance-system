import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  flagEnabled: true,
  flagError: null as { message: string } | null,
  events: [] as Record<string, unknown>[],
  findings: [] as Record<string, unknown>[],
  role: "admin",
  organizationId: "org-live" as string | null,
  orgName: "Live Plant" as string | null,
}));

const approveRecommendation = vi.hoisted(() =>
  vi.fn(async () => ({
    workOrderId: "wo-1",
    decisionId: "d-1",
    recommendationId: "rec-1",
  })),
);
const setRecommendationStatus = vi.hoisted(() => vi.fn(async () => undefined));
const rpc = vi.hoisted(() =>
  vi.fn(async () => ({
    data: { created: 0, skipped_existing: 0, error: null },
    error: null,
  })),
);

vi.mock("../components/AuthProvider", () => ({
  useAuth: () => ({
    profile: { role: state.role, organization_id: state.organizationId },
  }),
}));

vi.mock("../services/operatingLoopService", () => ({
  approveRecommendation,
  setRecommendationStatus,
}));

vi.mock("../lib/supabase", () => {
  function chain(
    rows: Record<string, unknown>[],
    error: { message: string } | null,
    single: boolean,
  ) {
    const builder: Record<string, unknown> = {};
    const self = () => builder;
    builder.select = self;
    builder.eq = self;
    builder.like = self;
    builder.order = self;
    builder.limit = self;
    builder.maybeSingle = () =>
      Promise.resolve({ data: error ? null : (rows[0] ?? null), error });
    builder.then = (
      resolve: (value: {
        data: unknown;
        error: { message: string } | null;
      }) => unknown,
    ) => resolve({ data: single || error ? null : rows, error });
    return builder;
  }
  return {
    supabase: {
      from: (table: string) => {
        if (table === "feature_flags") {
          return chain([{ enabled: state.flagEnabled }], state.flagError, true);
        }
        if (table === "audit_events") return chain(state.events, null, false);
        if (table === "recommendations")
          return chain(state.findings, null, false);
        if (table === "organizations") {
          return chain(
            state.orgName
              ? [{ id: state.organizationId, name: state.orgName }]
              : [],
            null,
            true,
          );
        }
        return chain([], null, false);
      },
      rpc,
    },
  };
});

import {
  SYNCAI_GUARD_DEMO_ORG_ID,
  SYNCAI_GUARD_DEMO_ORG_NAME,
  SyncAiGuardPage,
} from "./SyncAiGuardPage";

const finding = {
  id: "rec-1",
  organization_id: "org-1",
  asset_id: null,
  agent_id: null,
  source_finding_id: "syncai-guard:synthetic:auth-burst:2026-10-06",
  title: "Review synthetic authentication-failure burst",
  issue: "Synthetic security event for this organization.",
  action: "Have a named approver review it.",
  impact: null,
  confidence: 60,
  urgency: "advisory",
  status: "pending",
  approval_required: "Maintenance Manager",
  accountable: null,
  responsible: null,
  consulted: null,
  informed: null,
  financial_impact: null,
  risk_impact: "Medium",
  rationale: null,
  created_at: "2026-10-06T00:00:00Z",
  updated_at: "2026-10-06T00:00:00Z",
};

describe("SyncAI Guard page", () => {
  beforeEach(() => {
    state.flagEnabled = true;
    state.flagError = null;
    state.role = "admin";
    state.organizationId = "org-live";
    state.orgName = "Live Plant";
    state.events = [
      {
        id: "evt-1",
        created_at: "2026-10-06T00:00:00Z",
        actor: "user-1",
        event_data: {
          stage: "input",
          action: "block",
          rail: "jailbreak",
          reason: "Local jailbreak rail matched instruction override.",
          provider: "local-mock",
        },
      },
    ];
    state.findings = [finding];
    approveRecommendation.mockClear();
    setRecommendationStatus.mockClear();
    rpc.mockClear();
  });

  it("lists a rail event and sends approval through the operating loop", async () => {
    render(<SyncAiGuardPage />);
    expect(
      await screen.findByText(
        /Local jailbreak rail matched instruction override/,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Review synthetic authentication-failure burst"),
    ).toBeTruthy();
    expect(
      screen.getByText("SyncAI Guard is on for this organization."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(await screen.findByText(/Approved Review synthetic/)).toBeTruthy();
    expect(approveRecommendation).toHaveBeenCalledWith(
      expect.objectContaining({ id: "rec-1", status: "pending" }),
    );
  });

  it("fails closed when the flag cannot be read", async () => {
    state.flagError = { message: "feature flag read failed" };
    render(<SyncAiGuardPage />);
    expect(await screen.findByText("feature flag read failed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Scan telemetry" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
  });

  it("scans a live organization without the synthetic event", async () => {
    render(<SyncAiGuardPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Scan telemetry" }),
    );
    expect(
      screen.queryByRole("checkbox", {
        name: "Include one synthetic authentication-failure event",
      }),
    ).toBeNull();
    expect(rpc).toHaveBeenCalledWith("raise_syncai_guard_findings", {
      p_z_threshold: 3,
      p_include_synthetic: false,
    });
  });

  it("passes the synthetic flag only after the demo organization opts in", async () => {
    state.organizationId = SYNCAI_GUARD_DEMO_ORG_ID;
    state.orgName = SYNCAI_GUARD_DEMO_ORG_NAME;
    render(<SyncAiGuardPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Scan telemetry" }),
    );
    expect(await screen.findByText(/Scan created 0 finding/)).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith("raise_syncai_guard_findings", {
      p_z_threshold: 3,
      p_include_synthetic: false,
    });
    rpc.mockClear();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Include one synthetic authentication-failure event",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Scan telemetry" }));
    expect(rpc).toHaveBeenCalledWith("raise_syncai_guard_findings", {
      p_z_threshold: 3,
      p_include_synthetic: true,
    });
  });

  it("does not offer the synthetic event when the demo id has another name", async () => {
    state.organizationId = SYNCAI_GUARD_DEMO_ORG_ID;
    state.orgName = "Live Plant";
    render(<SyncAiGuardPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Scan telemetry" }),
    );
    expect(
      screen.queryByRole("checkbox", {
        name: "Include one synthetic authentication-failure event",
      }),
    ).toBeNull();
    expect(rpc).toHaveBeenCalledWith("raise_syncai_guard_findings", {
      p_z_threshold: 3,
      p_include_synthetic: false,
    });
  });

  it("hides the flag switch and the scan from ai_admin", async () => {
    state.role = "ai_admin";
    state.organizationId = SYNCAI_GUARD_DEMO_ORG_ID;
    state.orgName = SYNCAI_GUARD_DEMO_ORG_NAME;
    render(<SyncAiGuardPage />);
    expect(
      await screen.findByText("SyncAI Guard is on for this organization."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Turn Guard off" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Scan telemetry" })).toBeNull();
    expect(
      screen.queryByRole("checkbox", {
        name: "Include one synthetic authentication-failure event",
      }),
    ).toBeNull();
  });
});
