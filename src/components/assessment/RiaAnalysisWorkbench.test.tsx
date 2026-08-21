import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RiaAnalysisWorkbench } from "./RiaAnalysisWorkbench";

const listRiaAuthoringSources = vi.fn();
const listRiaAuthoringFindings = vi.fn();
const saveBaselineMetric = vi.fn();
const createCriticalityDraft = vi.fn();
const createFindingDraft = vi.fn();
const createOpportunityDraft = vi.fn();
const createDecisionDraft = vi.fn();
const createActionDraft = vi.fn();
const recordVerification = vi.fn();
const transitionAssessmentPhase = vi.fn();

vi.mock("../../services/riaAuthoring", () => ({
  listRiaAuthoringSources: (...args: unknown[]) =>
    listRiaAuthoringSources(...args),
  listRiaAuthoringFindings: (...args: unknown[]) =>
    listRiaAuthoringFindings(...args),
  saveBaselineMetric: (...args: unknown[]) => saveBaselineMetric(...args),
  createCriticalityDraft: (...args: unknown[]) =>
    createCriticalityDraft(...args),
  createFindingDraft: (...args: unknown[]) => createFindingDraft(...args),
  createOpportunityDraft: (...args: unknown[]) =>
    createOpportunityDraft(...args),
  createDecisionDraft: (...args: unknown[]) => createDecisionDraft(...args),
  createActionDraft: (...args: unknown[]) => createActionDraft(...args),
  recordVerification: (...args: unknown[]) => recordVerification(...args),
  transitionAssessmentPhase: (...args: unknown[]) =>
    transitionAssessmentPhase(...args),
}));

const assessmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function renderWorkbench(role = "reliability_engineer") {
  return render(
    <RiaAnalysisWorkbench
      assessmentId={assessmentId}
      currentStatus="analysis"
      role={role}
    />,
  );
}

beforeEach(() => {
  listRiaAuthoringSources.mockReset();
  listRiaAuthoringFindings.mockReset();
  saveBaselineMetric.mockReset();
  createCriticalityDraft.mockReset();
  createFindingDraft.mockReset();
  createOpportunityDraft.mockReset();
  createDecisionDraft.mockReset();
  createActionDraft.mockReset();
  recordVerification.mockReset();
  transitionAssessmentPhase.mockReset();

  listRiaAuthoringSources.mockResolvedValue([
    {
      id: "source-1",
      file_name: "work-orders.csv",
      category: "work_orders",
      status: "accepted",
      quality_grade: "supported",
    },
  ]);
  listRiaAuthoringFindings.mockResolvedValue([
    {
      id: "finding-1",
      title: "Startup failures cluster",
      severity: "high",
      review_state: "draft",
    },
  ]);
  saveBaselineMetric.mockResolvedValue("metric-1");
  createCriticalityDraft.mockResolvedValue("criticality-1");
  createFindingDraft.mockResolvedValue("finding-2");
  createOpportunityDraft.mockResolvedValue("opportunity-1");
  createDecisionDraft.mockResolvedValue("decision-1");
  createActionDraft.mockResolvedValue("action-1");
  recordVerification.mockResolvedValue("verification-1");
  transitionAssessmentPhase.mockResolvedValue(undefined);
});

describe("RiaAnalysisWorkbench", () => {
  it("is review-only for roles that do not own engineering authoring", () => {
    renderWorkbench("assessment_sponsor");
    expect(screen.getByText(/drafting engineering analysis requires/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /save baseline metric/i })).toBeNull();
  });

  it("sends a baseline metric with its method, population and source fields", async () => {
    renderWorkbench();
    await screen.findByText(/Build the governed assessment record/i);

    fireEvent.change(screen.getByLabelText(/Metric key/i), {
      target: { value: "mtbf_hours" },
    });
    fireEvent.change(screen.getByLabelText(/Display label/i), {
      target: { value: "MTBF" },
    });
    fireEvent.change(screen.getByLabelText(/Method \/ formula/i), {
      target: { value: "operating hours / functional failures" },
    });
    fireEvent.change(screen.getByLabelText(/^Population$/i), {
      target: { value: "42 haul trucks, Jan-Dec 2025" },
    });
    fireEvent.change(screen.getByLabelText(/Source fields/i), {
      target: { value: "operating_hours, functional_failure" },
    });
    fireEvent.change(screen.getByLabelText(/Evidence grade/i), {
      target: { value: "supported" },
    });

    await waitFor(() =>
      expect(screen.getByLabelText(/Primary evidence source/i)).toBeTruthy(),
    );
    fireEvent.change(screen.getByLabelText(/Primary evidence source/i), {
      target: { value: "source-1" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: /save baseline metric/i }),
    );

    await waitFor(() =>
      expect(saveBaselineMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          assessmentId,
          metricKey: "mtbf_hours",
          label: "MTBF",
          method: "operating hours / functional failures",
          population: "42 haul trucks, Jan-Dec 2025",
          sourceFields: ["operating_hours", "functional_failure"],
          evidenceGrade: "supported",
          evidenceSourceIds: ["source-1"],
        }),
      ),
    );
    expect(
      await screen.findByText(/Baseline metric saved through the governed assessment contract/i),
    ).toBeTruthy();
  });

  it("creates a finding with an actual evidence source and provenance", async () => {
    renderWorkbench();
    fireEvent.click(screen.getByRole("button", { name: /^Finding$/i }));

    fireEvent.change(screen.getByLabelText(/Finding title/i), {
      target: { value: "Startup lubrication events cluster" },
    });
    fireEvent.change(screen.getByLabelText(/Finding statement/i), {
      target: { value: "Five of seven trips occur within 20 minutes of startup." },
    });
    fireEvent.change(screen.getByLabelText(/Decision boundary/i), {
      target: { value: "Do not change the trip setpoint from this evidence alone." },
    });

    await waitFor(() => expect(screen.getByLabelText(/^Evidence source$/i)).toBeTruthy());
    fireEvent.change(screen.getByLabelText(/^Evidence source$/i), {
      target: { value: "source-1" },
    });
    fireEvent.change(screen.getByLabelText(/Record reference/i), {
      target: { value: "events 101-107" },
    });
    fireEvent.change(screen.getByLabelText(/^Provenance$/i), {
      target: { value: "customer export / validated row mapping" },
    });

    fireEvent.click(screen.getByRole("button", { name: /save finding/i }));

    await waitFor(() =>
      expect(createFindingDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          assessmentId,
          title: "Startup lubrication events cluster",
          evidence: [
            expect.objectContaining({
              dataSourceId: "source-1",
              recordReference: "events 101-107",
              provenance: "customer export / validated row mapping",
            }),
          ],
        }),
      ),
    );
  });

  it("refuses an unsupported quantified opportunity before it reaches the server", async () => {
    renderWorkbench();
    fireEvent.click(screen.getByRole("button", { name: /^Opportunity$/i }));

    fireEvent.change(screen.getByLabelText(/Opportunity title/i), {
      target: { value: "Reduce repeat gearbox failures" },
    });
    fireEvent.change(screen.getByLabelText(/^Rationale$/i), {
      target: { value: "Repeat failure concentration" },
    });
    fireEvent.change(screen.getByLabelText(/^Low$/i), {
      target: { value: "100000" },
    });

    fireEvent.click(screen.getByRole("button", { name: /save opportunity/i }));

    expect(
      await screen.findByText(/requires both range bounds, method, source and assumptions/i),
    ).toBeTruthy();
    expect(createOpportunityDraft).not.toHaveBeenCalled();
  });

  it("surfaces an undeployed invariant contract rather than showing success", async () => {
    saveBaselineMetric.mockRejectedValue(
      new Error(
        "This RIA authoring action is not deployed yet (upsert_ria_baseline_metric).",
      ),
    );
    renderWorkbench();

    fireEvent.change(screen.getByLabelText(/Metric key/i), {
      target: { value: "pm_compliance" },
    });
    fireEvent.change(screen.getByLabelText(/Display label/i), {
      target: { value: "PM compliance" },
    });
    fireEvent.change(screen.getByLabelText(/Method \/ formula/i), {
      target: { value: "completed PMs / due PMs" },
    });
    fireEvent.change(screen.getByLabelText(/^Population$/i), {
      target: { value: "all scheduled PMs" },
    });
    fireEvent.change(screen.getByLabelText(/Source fields/i), {
      target: { value: "due_date, completion_date" },
    });

    fireEvent.click(
      screen.getByRole("button", { name: /save baseline metric/i }),
    );

    expect(await screen.findByText(/not deployed yet/i)).toBeTruthy();
    expect(screen.queryByText(/Baseline metric saved/i)).toBeNull();
  });

  it("makes phase progression a governed action rather than a local status change", async () => {
    renderWorkbench();
    fireEvent.click(screen.getByRole("button", { name: /Assessment phase/i }));
    const phase = screen.getByLabelText(/Assessment phase/i);
    fireEvent.change(phase, { target: { value: "customer_review" } });
    const form = phase.closest("form");
    expect(form).toBeTruthy();
    fireEvent.click(
      within(form as HTMLFormElement).getByRole("button", {
        name: /request phase transition/i,
      }),
    );
    await waitFor(() =>
      expect(transitionAssessmentPhase).toHaveBeenCalledWith(
        assessmentId,
        "customer_review",
      ),
    );
  });
});
