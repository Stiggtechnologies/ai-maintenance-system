import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserContext } from "../services/platform";
import type { RiaWorkspaceData } from "../services/riaAssessment";
import { RiaAssessmentWorkspacePage } from "./RiaAssessmentWorkspacePage";

const getSession = vi.fn();
const getCurrentUserContext = vi.fn();
const loadRiaWorkspace = vi.fn();
const publishRiaFinding = vi.fn();
const approveRiaCriticalityItem = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: { auth: { getSession: () => getSession() } },
}));

vi.mock("../services/platform", () => ({
  platformService: {
    getCurrentUserContext: () => getCurrentUserContext(),
    signOut: vi.fn(),
  },
}));

vi.mock("../services/riaAssessment", () => ({
  loadRiaWorkspace: (...args: unknown[]) => loadRiaWorkspace(...args),
  publishRiaFinding: (...args: unknown[]) => publishRiaFinding(...args),
  approveRiaCriticalityItem: (...args: unknown[]) =>
    approveRiaCriticalityItem(...args),
}));

vi.mock("../components/assessment/DataRoom", () => ({
  DataRoom: ({
    assessmentId,
    organizationId,
  }: {
    assessmentId: string;
    organizationId: string;
  }) => (
    <div data-testid="ria-data-room">
      Data Room {assessmentId} {organizationId}
    </div>
  ),
}));

vi.mock("../components/BrandWordmark", () => ({
  BrandWordmark: () => <div>SyncAI</div>,
}));

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const ASSESSMENT_ID = "22222222-2222-2222-2222-222222222222";
const SOURCE_ID = "33333333-3333-3333-3333-333333333333";
const FINDING_ID = "44444444-4444-4444-4444-444444444444";

const CONTEXT: UserContext = {
  user_id: "55555555-5555-5555-5555-555555555555",
  email: "engineer@example.com",
  full_name: "Morgan Engineer",
  organization_id: ORG_ID,
  organization_name: "Northstar Resources",
  default_site_id: null,
  roles: [
    {
      code: "reliability_engineer",
      name: "Reliability Engineer",
      level: "engineering",
    },
  ],
  permissions: [],
};

const WORKSPACE: RiaWorkspaceData = {
  assessment: {
    id: ASSESSMENT_ID,
    organization_id: ORG_ID,
    name: "Northstar Reliability Intelligence Assessment",
    scope_label: "Mine mobile fleet",
    status: "analysis",
    commercial_model: "Fixed-scope assessment",
    started_on: "2026-09-01",
    target_end_on: "2026-10-31",
    source_retention_until: "2027-04-30",
    notes: null,
    created_at: "2026-09-01T00:00:00Z",
  },
  sources: [
    {
      id: SOURCE_ID,
      assessment_id: ASSESSMENT_ID,
      organization_id: ORG_ID,
      category: "asset_register",
      file_name: "governed-asset-register.csv",
      object_path: `${ORG_ID}/${ASSESSMENT_ID}/asset-register.csv`,
      mime_type: "text/csv",
      size_bytes: 1024,
      record_count: 42,
      status: "accepted",
      quality_grade: "green",
      notes: null,
      created_at: "2026-09-02T00:00:00Z",
    },
  ],
  metrics: [
    {
      id: "metric-1",
      metric_key: "availability",
      label: "Physical availability",
      value_text: "91.2",
      unit: "%",
      method: "Reviewed fleet-hour calculation",
      evidence_grade: "supported",
      evidence_refs: [SOURCE_ID],
    },
  ],
  criticality: [
    {
      id: "criticality-1",
      asset_ref: "HT-101",
      asset_name: "Haul truck 101",
      criticality: "high",
      rationale: "Production bottleneck with no ready spare.",
      review_state: "approved",
      approved_at: "2026-09-15T00:00:00Z",
    },
  ],
  findings: [
    {
      id: FINDING_ID,
      title: "Repeat wheel-motor failures drive downtime",
      statement: "Reviewed work history identifies a repeat failure cluster.",
      severity: "high",
      confidence: "high",
      evidence_grade: "supported",
      decision_boundary: "No interval change without engineering approval.",
      review_state: "published",
      reviewer_id: CONTEXT.user_id,
      reviewed_at: "2026-09-20T00:00:00Z",
    },
  ],
  findingEvidence: [
    {
      id: "finding-evidence-1",
      finding_id: FINDING_ID,
      data_source_id: SOURCE_ID,
      record_reference: "WO-4107",
      note: "Reviewed corrective work order.",
    },
  ],
  opportunities: [
    {
      id: "opportunity-1",
      title: "Wheel-motor defect-elimination pilot",
      priority: "high",
      rationale: "Test the supported failure mode on a bounded fleet cohort.",
      method: "Avoided-downtime scenario range",
      value_low: 100000,
      value_high: 250000,
      value_currency: "USD",
      confidence: "medium",
      owner: "Reliability Manager",
      status: "proposed",
    },
  ],
  decisions: [
    {
      id: "decision-1",
      decision_required: "Approve the bounded wheel-motor pilot",
      recommendation: "Run the pilot on three trucks.",
      evidence_summary: "Published finding and accepted source records.",
      uncertainty: "Seasonal duty-cycle effect is not yet quantified.",
      authority_role: "Maintenance Manager",
      boundary: "No production-wide interval change.",
      verification: "Compare 30/60/90-day failure and downtime outcomes.",
      due_on: "2026-10-15",
      status: "pending",
      decided_at: null,
    },
  ],
  actions: [
    {
      id: "action-1",
      horizon: "day_30",
      action: "Confirm the pilot cohort and baseline.",
      owner: "Reliability Engineer",
      due_on: "2026-10-30",
      verification_metric: "Wheel-motor related downtime hours",
      status: "not_started",
    },
  ],
  verifications: [
    {
      id: "verification-1",
      checkpoint: "day_30",
      metric: "Wheel-motor related downtime hours",
      baseline: "120 hours",
      observed: "82 hours",
      method: "Approved CMMS work-order query",
      evidence_refs: [SOURCE_ID],
      status: "supported",
      verified_at: "2026-10-30T00:00:00Z",
    },
  ],
};

function selectTab(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}

describe("RiaAssessmentWorkspacePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue({
      data: { session: { user: { id: CONTEXT.user_id } } },
      error: null,
    });
    getCurrentUserContext.mockResolvedValue(CONTEXT);
    loadRiaWorkspace.mockResolvedValue(WORKSPACE);
  });

  it("makes every governed assessment view reachable from one tenant workspace", async () => {
    render(<RiaAssessmentWorkspacePage />);

    expect(
      await screen.findByRole("heading", {
        name: "Northstar Reliability Intelligence Assessment",
      }),
    ).toBeInTheDocument();
    expect(loadRiaWorkspace).toHaveBeenCalledWith(ORG_ID);
    expect(screen.getByText("25%")).toBeInTheDocument();

    selectTab("Data Room");
    expect(screen.getByTestId("ria-data-room")).toHaveTextContent(
      `${ASSESSMENT_ID} ${ORG_ID}`,
    );

    selectTab("Evidence Explorer");
    expect(
      screen.getByRole("heading", { name: "Evidence Explorer" }),
    ).toBeInTheDocument();
    expect(screen.getByText("governed-asset-register.csv")).toBeInTheDocument();
    expect(screen.getByText("WO-4107")).toBeInTheDocument();

    selectTab("Reliability Baseline");
    expect(screen.getByText("Physical availability")).toBeInTheDocument();
    expect(screen.getByText(/Haul truck 101/)).toBeInTheDocument();

    selectTab("Findings & Bad Actors");
    expect(
      screen.getByText("Repeat wheel-motor failures drive downtime"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Review & publish finding"),
    ).not.toBeInTheDocument();

    selectTab("Opportunity Register");
    expect(
      screen.getByText("Wheel-motor defect-elimination pilot"),
    ).toBeInTheDocument();

    selectTab("Decision Board");
    expect(
      screen.getByText("Approve the bounded wheel-motor pilot"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No production-wide interval change/),
    ).toBeInTheDocument();

    selectTab("90-Day Plan");
    expect(
      screen.getByText("Confirm the pilot cohort and baseline."),
    ).toBeInTheDocument();

    selectTab("Executive Report");
    expect(
      screen.getByRole("heading", { name: "Executive Report" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Repeat wheel-motor failures drive downtime"),
    ).toBeInTheDocument();

    selectTab("Verification");
    expect(
      screen.getByRole("heading", { name: "30 / 60 / 90-Day Verification" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Observed:")).toBeInTheDocument();
    expect(screen.getByText("82 hours")).toBeInTheDocument();
  });

  it("keeps the paid tenant workspace behind authentication", async () => {
    getSession.mockResolvedValueOnce({ data: { session: null }, error: null });

    render(<RiaAssessmentWorkspacePage />);

    expect(
      await screen.findByRole("heading", {
        name: "Sign in to your assessment workspace",
      }),
    ).toBeInTheDocument();
    expect(loadRiaWorkspace).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/signin?returnTo=/pilot/reliability",
    );
  });

  it("keeps the pilot workspace and signed-in assessment entry points wired", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const pilot = readFileSync("src/pages/FirstCustomerPilotPage.tsx", "utf8");

    expect(app).toContain('path="/pilot/reliability"');
    expect(app).toContain('path="/assessments/:assessmentId"');
    expect(app).toContain("<AssessmentHomePage />");
    expect(pilot).toContain(
      'window.location.pathname === "/pilot/reliability"',
    );
    expect(pilot).toContain("<RiaAssessmentWorkspacePage />");
  });
});
