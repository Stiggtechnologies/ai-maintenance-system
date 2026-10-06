import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CovariateSurvivalWorkbench } from "./CovariateSurvivalWorkbench";
import { fitCoxWithDiagnostics } from "../lib/reliability/cox";
import { analyseCoxSurvival } from "../lib/reliability/cox-prediction";
import { prepareSurvivalSource } from "../lib/reliability/survival-source";
import coxInput from "../lib/reliability/fixtures/cox-reference.json";
import {
  captureSurvivalOverlay,
  captureSurvivalInstalledOverlay,
  loadSurvivalWorkspace,
  reviewSurvivalOverlay,
  reviewSurvivalInstalledOverlay,
  runSurvivalAnalysis,
  type SurvivalWorkspace,
} from "../services/survivalCovariateService";

vi.mock("../services/survivalCovariateService", () => ({
  loadSurvivalWorkspace: vi.fn(),
  captureSurvivalOverlay: vi.fn(),
  captureSurvivalInstalledOverlay: vi.fn(),
  reviewSurvivalOverlay: vi.fn(),
  reviewSurvivalInstalledOverlay: vi.fn(),
  runSurvivalAnalysis: vi.fn(),
}));

const workspace = (): SurvivalWorkspace => ({
  sourceVersion: "survival-census/2/draft",
  activeInstances: [],
  removedInstances: [],
  populationGaps: [],
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
    expect(
      screen.getByText(
        /Current-component scenarios use actual installation and meter facts/,
      ),
    ).toBeInTheDocument();
  });
  const installedWorkspace = (): SurvivalWorkspace => {
    const source = workspace();
    source.activeInstances = [
      {
        id: "aaaaaaaa-0000-0000-0000-000000000001",
        assetId: "synthetic-asset",
        component: source.component,
        position: "left",
        state: "installed",
        installedAt: "2026-08-01T00:00:00Z",
        installedMeterHours: 1000,
        currentMeter: {
          id: "bbbbbbbb-0000-0000-0000-000000000001",
          assetId: "synthetic-asset",
          kind: "operating_hours",
          value: 1008,
          recordedAt: "2026-09-01T00:00:00Z",
        },
        overlayVersion: 0,
        overlayStatus: "unrecorded",
        overlayAuthor: null,
        overlayReviewer: null,
        overlay: null,
        sourceCurrent: false,
        approvalCurrent: false,
      },
    ];
    source.evidence = [
      {
        id: "install-proof",
        asset_id: "synthetic-asset",
        ts: "2026-08-01T00:00:00Z",
        description: "Synthetic installation evidence",
        evidence_class: "MEASURED",
        verified_by: "reviewer",
      },
      {
        id: "meter-proof",
        asset_id: "synthetic-asset",
        ts: "2026-09-01T00:00:00Z",
        description: "Synthetic meter evidence",
        evidence_class: "MEASURED",
        verified_by: "reviewer",
      },
    ];
    return source;
  };
  const chooseInstalled = (id: string) => {
    change("Evidence source kind", "installation");
    change("Canonical component installation", id);
  };
  it("captures canonical meter/evidence references with explicit condition inputs, not caller lifecycle identity or age", async () => {
    const source = installedWorkspace();
    vi.mocked(loadSurvivalWorkspace).mockResolvedValue(source);
    render(<CovariateSurvivalWorkbench component="synthetic drive" />);
    await screen.findByText("Whole-population readiness");
    chooseInstalled(source.activeInstances[0].id);
    expect(
      screen.queryByLabelText("Physical component life reference"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Actual service start (ISO with timezone)"),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Interval 1 predictor 1 value")).toHaveValue(
      null,
    );
    change("Predictor 1 name", "synthetic_load");
    change("Predictor 1 unit", "ratio");
    change("Approved design / operating stratum", "synthetic-design");
    change("Observed entry operating hours", "0");
    change(
      "Evidence-backed profile valid until (ISO with timezone)",
      "2030-01-01T00:00:00Z",
    );
    change("Installation evidence", "install-proof");
    change("Latest meter evidence", "meter-proof");
    change("Interval 1 start hours", "0");
    change("Interval 1 stop hours", "8");
    change("Interval 1 actual start (ISO)", "2026-08-01T00:00:00Z");
    change("Interval 1 actual end (ISO)", "2026-09-01T00:00:00Z");
    change("Interval 1 predictor 1 evidence", "install-proof");
    change("Interval 1 predictor 1 value", "0.4");
    change("Interval 1 predictor 1 observed hours", "0");
    change("Interval 1 predictor 1 available hours", "0");
    change("Interval 1 predictor 1 valid through hours", "15");
    change("Interval 1 predictor 1 available at (ISO)", "2026-08-01T00:00:00Z");
    change(
      "Capture evidence basis",
      "Independent synthetic installation and condition source basis.",
    );
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Submit exact overlay for review" })
        .closest("form")!,
    );
    await waitFor(() =>
      expect(captureSurvivalInstalledOverlay).toHaveBeenCalled(),
    );
    const [row, overlay] = vi.mocked(captureSurvivalInstalledOverlay).mock
      .calls[0];
    expect(row.id).toBe(source.activeInstances[0].id);
    expect(overlay).toMatchObject({
      mode: "include",
      meterReadingId: source.activeInstances[0].currentMeter!.id,
      installationEvidenceItemId: "install-proof",
      meterEvidenceItemId: "meter-proof",
      entryHours: 0,
      intervals: [{ stopHours: 8, values: [{ value: 0.4 }] }],
    });
    expect(overlay).not.toHaveProperty("lifeRef");
    expect(overlay).not.toHaveProperty("serviceStartedAt");
    expect(overlay).not.toHaveProperty("originHours");
    expect(captureSurvivalOverlay).not.toHaveBeenCalled();
  });
  it("reviews the persisted installation snapshot and never uses unsaved basis as source facts", async () => {
    const source = installedWorkspace();
    const row = source.activeInstances[0];
    row.overlayVersion = 3;
    row.overlayStatus = "pending_review";
    row.overlayAuthor = "synthetic-author";
    row.overlay = {
      mode: "exclude",
      basis: "Persisted independently evidenced disposition.",
      evidenceItemId: "install-proof",
    };
    vi.mocked(loadSurvivalWorkspace).mockResolvedValue(source);
    render(<CovariateSurvivalWorkbench component="synthetic drive" />);
    await screen.findByText("Whole-population readiness");
    chooseInstalled(row.id);
    change(
      "Capture evidence basis",
      "Unsaved new capture basis is not reviewed.",
    );
    change(
      "Independent review basis",
      "Independent review of exact persisted source snapshot.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Validate exact overlay" }),
    );
    await waitFor(() =>
      expect(reviewSurvivalInstalledOverlay).toHaveBeenCalledWith(
        row,
        "validated",
        "Independent review of exact persisted source snapshot.",
      ),
    );
    expect(captureSurvivalInstalledOverlay).not.toHaveBeenCalled();
    expect(reviewSurvivalOverlay).not.toHaveBeenCalled();
  });
  it("sends current-target UUID and horizon only, with no editable current-age field", async () => {
    const source = installedWorkspace();
    vi.mocked(loadSurvivalWorkspace).mockResolvedValue(source);
    vi.mocked(runSurvivalAnalysis).mockResolvedValue({
      calculationRunId: "synthetic-installed-refusal",
      agentRunId: "synthetic-run",
      result: {
        status: "refused",
        code: "invalid_input",
        reason: "Unreviewed current profile.",
        kernelVersion: "cox-efron/1/draft",
        authority: "advisory_only",
      },
      refusals: ["Unreviewed current profile."],
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
      screen.getByLabelText("Include evidence-backed conditional scenario"),
    );
    change("Scenario profile kind", "installation");
    change("Scenario installed component", source.activeInstances[0].id);
    change("Scenario horizon operating hours", "12");
    expect(
      screen.queryByLabelText("Scenario survival origin operating hours"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Run retained survival analysis" }),
    );
    await waitFor(() =>
      expect(runSurvivalAnalysis).toHaveBeenCalledWith(
        "synthetic drive",
        [{ name: "synthetic_load", unit: "ratio" }],
        undefined,
        { componentInstanceId: source.activeInstances[0].id, horizonHours: 12 },
      ),
    );
    await screen.findByText("Retained advisory refused");
  });
  it("keeps unmatched removed installations visible as whole-population gaps", async () => {
    const source = installedWorkspace();
    source.removedInstances = [
      { ...source.activeInstances[0], state: "removed", reconciled: false },
    ];
    source.activeInstances = [];
    vi.mocked(loadSurvivalWorkspace).mockResolvedValue(source);
    render(<CovariateSurvivalWorkbench component="synthetic drive" />);
    await screen.findByText("Removed life unresolved");
    expect(
      screen.getByText(
        /an exact approved historical link or evidenced exclusion is required/,
      ),
    ).toBeInTheDocument();
    choose();
    change(
      "Explicit removed installation link (optional)",
      source.removedInstances[0].id,
    );
    change("Population treatment", "exclude");
    change("Exclusion evidence", "install-proof");
    change(
      "Capture evidence basis",
      "Independent synthetic exact removed-life reconciliation.",
    );
    fireEvent.submit(
      screen
        .getByRole("button", { name: "Submit exact overlay for review" })
        .closest("form")!,
    );
    await waitFor(() =>
      expect(captureSurvivalOverlay).toHaveBeenCalledWith(
        source.events[0],
        expect.objectContaining({
          componentInstanceId: source.removedInstances[0].id,
          mode: "exclude",
        }),
      ),
    );
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
  it("never pre-fills scenario exposure or sends an incomplete scenario to the service", async () => {
    render(<CovariateSurvivalWorkbench component="synthetic drive" />);
    await screen.findByText("Whole-population readiness");
    change("Predictor 1 name", "synthetic_load");
    change("Predictor 1 unit", "ratio");
    fireEvent.click(
      screen.getByLabelText("Include evidence-backed conditional scenario"),
    );
    expect(
      screen.getByLabelText("Scenario survival origin operating hours"),
    ).toHaveValue(null);
    expect(
      screen.getByLabelText("Scenario horizon operating hours"),
    ).toHaveValue(null);
    fireEvent.click(
      screen.getByRole("button", { name: "Run retained survival analysis" }),
    );
    await screen.findByText(
      /Every operating-hour boundary and measurement needs an explicit finite value/,
    );
    expect(runSurvivalAnalysis).not.toHaveBeenCalled();
  });
  it("sends only exact scenario selection and renders a retained unqualified conditional estimate", async () => {
    const data = workspace();
    data.events = coxInput.cases[0].rows.map((row, index) => ({
      id: index + 1,
      assetId: `synthetic-asset-${Math.floor(index / 3)}`,
      component: "synthetic drive",
      hoursAtChangeOut: row.stop,
      eventKind: row.failed ? "failure" : "scheduled",
      eventDate: "2026-09-01",
      overlayVersion: 1,
      overlayStatus: "validated",
      overlayAuthor: "synthetic-author",
      overlayReviewer: "synthetic-reviewer",
      sourceCurrent: true,
      approvalCurrent: true,
      overlay: {
        mode: "include",
        basis:
          "Independently reviewed synthetic measurement and physical-life boundary.",
        lifeRef: row.subjectId,
        stratum: row.stratum,
        entryHours: 0,
        serviceStartedAt: "2026-08-01T00:00:00Z",
        terminalObservedAt: "2026-09-01T00:00:00Z",
        intervals: [
          {
            startHours: 0,
            stopHours: row.stop,
            startedAt: "2026-08-01T00:00:00Z",
            endedAt: "2026-09-01T00:00:00Z",
            values: [
              {
                name: "synthetic_load",
                unit: "ratio",
                value: row.covariates[0],
                evidenceItemId: `synthetic-evidence-${index}`,
                observedAtHours: 0,
                availableAtHours: 0,
                validThroughHours: row.stop,
                observedAt: "2026-08-01T00:00:00Z",
                availableAt: "2026-08-01T00:00:00Z",
              },
            ],
          },
        ],
      },
    }));
    const prepared = prepareSurvivalSource(data.events, [
      { name: "synthetic_load", unit: "ratio" },
    ]);
    expect(prepared.gaps).toEqual([]);
    const result = analyseCoxSurvival(
      prepared.rows,
      ["synthetic_load"],
      prepared.clusterBySubject,
      {
        stratum: "A",
        originHours: 3,
        horizonHours: 12,
        path: [
          {
            startHours: 3,
            stopHours: 12,
            covariates: [coxInput.cases[0].rows[1].covariates[0]],
            observedAtHours: 0,
            availableAtHours: 0,
            validThroughHours: 22,
          },
        ],
        source: {
          eventId: 2,
          overlayVersion: 1,
          intervalIndex: 0,
          evidenceItemIds: ["synthetic-evidence-1"],
        },
      },
    );
    vi.mocked(loadSurvivalWorkspace).mockResolvedValue(data);
    vi.mocked(runSurvivalAnalysis).mockResolvedValue({
      calculationRunId: "synthetic-scenario-calc",
      agentRunId: "synthetic-scenario-run",
      result,
      refusals: ["Scenario calibration unqualified."],
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
      screen.getByLabelText("Include evidence-backed conditional scenario"),
    );
    change("Scenario reference life", "2");
    change("Scenario measured interval", "0");
    change("Scenario survival origin operating hours", "3");
    change("Scenario horizon operating hours", "12");
    fireEvent.click(
      screen.getByRole("button", { name: "Run retained survival analysis" }),
    );
    await screen.findByText(
      "Numerical conditional scenario · not a live asset forecast",
    );
    expect(runSurvivalAnalysis).toHaveBeenCalledWith(
      "synthetic drive",
      [{ name: "synthetic_load", unit: "ratio" }],
      { eventId: 2, intervalIndex: 0, originHours: 3, horizonHours: 12 },
    );
    expect(
      screen.getByText(/Given survival to 3 operating hours/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Joint conditional hazard sampling uncertainty.*24 assets/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Cumulative hazard standard error/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /not a future-event prediction interval or validated customer coverage/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Unqualified calibration; no predictive confidence interval/,
      ),
    ).toBeInTheDocument();
    change("Scenario horizon operating hours", "11");
    expect(
      screen.queryByText(
        "Numerical conditional scenario · not a live asset forecast",
      ),
    ).not.toBeInTheDocument();
  });
  for (const mode of ["historical", "refused"] as const) {
    it(`does not invent joint uncertainty for a ${mode} receipt`, async () => {
      const rows = coxInput.cases[0].rows.map((row) => ({
        ...row,
        covariates: [row.covariates[0]],
      }));
      const result = analyseCoxSurvival(
        rows,
        ["synthetic_load"],
        new Map(
          rows.map((row, i) => [row.subjectId, `asset-${Math.floor(i / 3)}`]),
        ),
        {
          stratum: "A",
          originHours: 3,
          horizonHours: 12,
          path: [
            {
              startHours: 3,
              stopHours: 12,
              covariates: rows[1].covariates,
              observedAtHours: 0,
              availableAtHours: 0,
              validThroughHours: 22,
            },
          ],
        },
      );
      if (
        result.status !== "fitted" ||
        result.conditionalScenario?.status !== "estimated"
      )
        throw new Error(JSON.stringify(result));
      if (mode === "historical")
        delete result.conditionalScenario.predictionUncertainty;
      else
        result.conditionalScenario.predictionUncertainty = {
          status: "refused",
          uncertaintyVersion: "cox-joint-asset/1/draft",
          authority: "advisory_only",
          reason: "Retained independent asset uncertainty is unresolvable.",
        };
      vi.mocked(runSurvivalAnalysis).mockResolvedValue({
        calculationRunId: "synthetic-receipt",
        agentRunId: "synthetic-run",
        result,
        refusals: ["No operational authority."],
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
      await screen.findByText(
        "Numerical conditional scenario · not a live asset forecast",
      );
      expect(
        screen.getByText(
          mode === "historical"
            ? /No retained joint hazard uncertainty exists/
            : /Joint conditional hazard uncertainty refused/,
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(/Cumulative hazard standard error/),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(
          /Unqualified calibration; no predictive confidence interval/,
        ),
      ).toBeInTheDocument();
    });
  }
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
