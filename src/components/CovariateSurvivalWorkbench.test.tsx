import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CovariateSurvivalWorkbench } from "./CovariateSurvivalWorkbench";
import { fitCoxWithDiagnostics } from "../lib/reliability/cox";
import coxInput from "../lib/reliability/fixtures/cox-reference.json";
import {
  captureSurvivalOverlay,
  loadSurvivalWorkspace,
  reviewSurvivalOverlay,
  runSurvivalAnalysis,
  type SurvivalWorkspace,
} from "../services/survivalCovariateService";

vi.mock("../services/survivalCovariateService", () => ({
  loadSurvivalWorkspace: vi.fn(),
  captureSurvivalOverlay: vi.fn(),
  reviewSurvivalOverlay: vi.fn(),
  runSurvivalAnalysis: vi.fn(),
}));

const workspace = (): SurvivalWorkspace => ({
  component: "synthetic drive",
  evidence: [],
  calculations: [],
  events: [
    {
      id: 21,
      assetId: "synthetic-asset",
      component: "synthetic drive",
      hoursAtChangeOut: 10,
      eventKind: "scheduled",
      eventDate: "2026-09-01",
      overlayVersion: 0,
      overlayStatus: "unrecorded",
      overlayAuthor: null,
      overlayReviewer: null,
      overlay: null,
      sourceCurrent: false,
      approvalCurrent: false,
    },
  ],
});
const choose = () =>
  fireEvent.change(screen.getByLabelText("Canonical life event"), {
    target: { value: "21" },
  });
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("governed covariate survival workbench", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(loadSurvivalWorkspace).mockResolvedValue(workspace());
  });
  it("shows missing approval honestly and never pre-fills operating measurements", async () => {
    render(<CovariateSurvivalWorkbench component="synthetic drive" />);
    await screen.findByText("Whole-population readiness");
    choose();
    change("Predictor 1 name", "synthetic_load");
    change("Predictor 1 unit", "ratio");
    expect(
      screen.getByText(
        /exact overlay and current source evidence require independent approval/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Observed entry operating hours")).toHaveValue(
      null,
    );
    expect(screen.getByLabelText("Interval 1 predictor 1 value")).toHaveValue(
      null,
    );
    expect(
      screen.getByText(
        /independent-asset adequacy and predictive calibration remain unproven/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Source gap \/ Approval gap/)).toBeInTheDocument();
  });
  it("sends only scope and declared predictors to the service and displays retained refusal IDs", async () => {
    vi.mocked(runSurvivalAnalysis).mockResolvedValue({
      calculationRunId: "synthetic-calculation-id",
      agentRunId: "synthetic-run-id",
      result: {
        status: "refused",
        code: "invalid_input",
        reason: "Exact source review required.",
        kernelVersion: "cox-efron/1/draft",
        authority: "advisory_only",
      },
      refusals: ["Exact source review required."],
      advisory: true,
      may_change_pm_interval: false,
      may_create_work: false,
      may_accept_risk: false,
      may_return_to_service: false,
    });
    render(<CovariateSurvivalWorkbench component="synthetic drive" />);
    await screen.findByText("Whole-population readiness");
    change("Predictor 1 name", "synthetic_load");
    change("Predictor 1 unit", "ratio");
    fireEvent.click(
      screen.getByRole("button", { name: "Run retained survival analysis" }),
    );
    await screen.findByText("Retained advisory refused");
    expect(runSurvivalAnalysis).toHaveBeenCalledWith("synthetic drive", [
      { name: "synthetic_load", unit: "ratio" },
    ]);
    expect(
      screen.getByText(/Calculation synthetic-calculation-id/),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Exact source review required.")).toHaveLength(
      2,
    );
  });
  it("captures an explicitly evidenced exclusion, not a silent filtered row", async () => {
    const data = workspace();
    data.evidence = [
      {
        id: "synthetic-evidence",
        asset_id: "synthetic-asset",
        ts: "2026-08-01T00:00:00Z",
        description: "Synthetic exclusion witness",
        evidence_class: "DOCUMENTED",
        verified_by: "synthetic-verifier",
      },
    ];
    vi.mocked(loadSurvivalWorkspace).mockResolvedValue(data);
    vi.mocked(captureSurvivalOverlay).mockResolvedValue();
    render(<CovariateSurvivalWorkbench component="synthetic drive" />);
    await screen.findByText("Whole-population readiness");
    choose();
    change("Population treatment", "exclude");
    change("Exclusion evidence", "synthetic-evidence");
    change(
      "Capture evidence basis",
      "Independent documented exclusion of an unknown removal.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Submit exact overlay for review" }),
    );
    await waitFor(() =>
      expect(captureSurvivalOverlay).toHaveBeenCalledWith(data.events[0], {
        mode: "exclude",
        basis: "Independent documented exclusion of an unknown removal.",
        evidenceItemId: "synthetic-evidence",
      }),
    );
    expect(
      await screen.findByText(/not an approved model input yet/),
    ).toBeInTheDocument();
  });
  it("renders formal diagnostics with retained predictor labels and clears stale fits after form edits", async () => {
    const rows = coxInput.cases[0].rows.map((row) => ({
      ...row,
      covariates: [row.covariates[0]],
    }));
    const result = fitCoxWithDiagnostics(
      rows,
      ["synthetic_retained_load"],
      new Map(
        rows.map((row, i) => [
          row.subjectId,
          `synthetic-asset-${Math.floor(i / 3)}`,
        ]),
      ),
    );
    expect(result.status).toBe("fitted");
    vi.mocked(runSurvivalAnalysis).mockResolvedValue({
      calculationRunId: "synthetic-diag-calc",
      agentRunId: "synthetic-diag-run",
      result,
      refusals: ["Predictive calibration unproven."],
      advisory: true,
      may_change_pm_interval: false,
      may_create_work: false,
      may_accept_risk: false,
      may_return_to_service: false,
    });
    render(<CovariateSurvivalWorkbench component="synthetic drive" />);
    await screen.findByText("Whole-population readiness");
    change("Predictor 1 name", "synthetic_retained_load");
    change("Predictor 1 unit", "ratio");
    fireEvent.click(
      screen.getByRole("button", { name: "Run retained survival analysis" }),
    );
    await screen.findByText("Retained advisory fitted");
    expect(
      screen.getByText(/synthetic_retained_load: log-hazard coefficient/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Canonical-asset clustered uncertainty.*24 assets/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Formal PH score tests/)).toBeInTheDocument();
    expect(
      screen.getByText(/non-significant test is not proof/),
    ).toBeInTheDocument();
    change("Predictor 1 name", "unsaved_different_variable");
    expect(
      screen.queryByText("Retained advisory fitted"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/unsaved_different_variable: log-hazard coefficient/),
    ).not.toBeInTheDocument();
  });
  it("reviews the selected persisted version, never unsaved form edits", async () => {
    const data = workspace();
    data.events[0] = {
      ...data.events[0],
      overlayVersion: 3,
      overlayStatus: "pending_review",
      overlayAuthor: "synthetic-other-author",
      overlay: {
        mode: "exclude",
        basis: "Persisted independent exclusion basis.",
        evidenceItemId: "synthetic-evidence",
      },
    };
    vi.mocked(loadSurvivalWorkspace).mockResolvedValue(data);
    vi.mocked(reviewSurvivalOverlay).mockResolvedValue();
    render(<CovariateSurvivalWorkbench component="synthetic drive" />);
    await screen.findByText("Whole-population readiness");
    choose();
    change(
      "Capture evidence basis",
      "Unsaved unrelated form edits must never enter review.",
    );
    change(
      "Independent review basis",
      "Independently checked the exact persisted evidence.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Validate exact overlay" }),
    );
    await waitFor(() =>
      expect(reviewSurvivalOverlay).toHaveBeenCalledWith(
        data.events[0],
        "validated",
        "Independently checked the exact persisted evidence.",
      ),
    );
  });
  it("does not carry physical lives or measurement edits into another selected event", async () => {
    const data = workspace();
    data.events.push({ ...data.events[0], id: 22 });
    vi.mocked(loadSurvivalWorkspace).mockResolvedValue(data);
    render(<CovariateSurvivalWorkbench component="synthetic drive" />);
    await screen.findByText("Whole-population readiness");
    choose();
    change("Physical component life reference", "synthetic-serial-one");
    change("Interval 1 predictor 1 value", "5");
    change("Canonical life event", "22");
    expect(
      screen.getByLabelText("Physical component life reference"),
    ).toHaveValue("");
    expect(screen.getByLabelText("Interval 1 predictor 1 value")).toHaveValue(
      null,
    );
  });
  it("shows an immutable retained history record without inventing results", async () => {
    const data = workspace();
    data.calculations = [
      {
        id: "synthetic-history",
        computed_at: "2026-10-01T00:00:00Z",
        status: "refused",
        code_version: "cox-efron/1/draft",
        inputs: {
          covariates: [{ name: "load", unit: "ratio" }],
          source: { component: "synthetic drive" },
        },
        outputs: null,
        refusals: ["Evidence missing."],
      },
    ];
    vi.mocked(loadSurvivalWorkspace).mockResolvedValue(data);
    render(<CovariateSurvivalWorkbench component="synthetic drive" />);
    expect(
      await screen.findByText(/2026-10-01.*refused.*synthetic-history/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Retained advisory fitted"),
    ).not.toBeInTheDocument();
  });
  it("renders authorization errors rather than fixture or stale fallback data", async () => {
    vi.mocked(loadSurvivalWorkspace).mockRejectedValue(
      new Error("Adopted controls required."),
    );
    render(<CovariateSurvivalWorkbench component="synthetic drive" />);
    expect(
      await screen.findByText("Adopted controls required."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Whole-population readiness"),
    ).not.toBeInTheDocument();
  });
});
