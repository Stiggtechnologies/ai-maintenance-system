import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RiskRecord } from "../types/risk";
import { ActionModal } from "./RiskOperatingSystemPage";

const wire = vi.hoisted(() => ({
  body: null as unknown,
  fail: false,
  gate: null as Promise<void> | null,
  previewGate: null as Promise<void> | null,
  analysisResult: null as Record<string, unknown> | null,
  analysisReads: [] as Record<string, unknown>[],
  writes: [] as Record<string, unknown>[],
}));
vi.mock("../lib/supabase", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return {
    supabase: createClient(
      "https://synthetic-risk.invalid",
      "synthetic-public-key",
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: {
          fetch: async (url, init) => {
            const args = JSON.parse(String(init?.body));
            let body: unknown = context;
            if (String(url).endsWith("get_risk_analysis_preview")) {
              wire.analysisReads.push(args);
              body = {
                risk_id: args.p_risk_id,
                criteria_id: context.criteria.id,
                criteria_version: 1,
                criteria_status: "adopted",
                analysis: args.p_analysis,
                generated_at: context.generated_at,
                advisory_only: true,
                human_decision_required: true,
                inherent_score: 60,
                controlled_score: 60,
                current_score: 60,
                opportunity_score: 0,
                time_pressure: 0,
                level: "High",
                recommended_action: "TREAT",
                authoritative: true,
                ...wire.analysisResult,
              };
              await wire.previewGate;
            }
            if (String(url).endsWith("record_risk_analysis")) {
              wire.writes.push(args);
              await wire.gate;
              if (wire.fail) throw new TypeError("Synthetic lost response");
              body = wire.body ?? {
                risk_id: args.p_risk_id,
                status: "analyzed",
                inherent_score: 60,
                current_score: 60,
                opportunity_score: 0,
                level: "High",
                recommended_action: "TREAT",
                authoritative: true,
              };
            }
            if (String(url).endsWith("create_risk_treatment")) {
              wire.writes.push(args);
              await wire.gate;
              if (wire.fail)
                throw new TypeError("Synthetic treatment response lost");
              body = wire.body ?? {
                risk_id: args.p_risk_id,
                scenario_id: "55555555-5555-4555-8555-555555555555",
                selected: args.p_select,
                executable: true,
                readiness_gaps: [],
                recommendation_id: null,
                approval_id: null,
                net_risk_change: 20,
                human_approval_required: args.p_select,
                secondary_risks: [],
                advisory_only: true,
                human_decision_required: true,
              };
            }
            if (String(url).endsWith("record_risk_value_of_information")) {
              wire.writes.push(args);
              await wire.gate;
              if (wire.fail) throw new TypeError("Synthetic lost response");
              body = wire.body ?? {
                ...args.p_analysis,
                risk_id: riskId,
                evidence_id: evidenceId,
                expected_value: 25,
                net_value: 15,
                recommendation: "GATHER_INFORMATION",
                recorded_at: "2026-10-06T12:00:00Z",
                advisory_only: true,
                human_decision_required: true,
              };
            }
            return new Response(JSON.stringify(body), {
              status: 200,
              headers: { "content-type": "application/json" },
            });
          },
        },
      },
    ),
  };
});
const riskId = "11111111-1111-4111-8111-111111111111";
const evidenceId = "33333333-3333-4333-8333-333333333333";
const ownerId = "44444444-4444-4444-8444-444444444444";
const context = {
  risk_id: riskId,
  criteria: {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Synthetic criteria",
    status: "adopted",
    version: 1,
    consequence_dimensions: ["safety"],
    likelihood_scale: [1, 5],
    thresholds: { low: 20, medium: 40, high: 60, critical: 80 },
    scoring_weights: {
      inherent: 1,
      exposure: 0,
      uncertainty: 0,
      connectivity: 0,
      velocity: 0,
      capacity: 0,
    },
    decision_thresholds: {
      accept: 0,
      monitor: 20,
      investigate: 40,
      treat: 60,
      escalate: 80,
    },
    risk_capacity: {},
    time_factors: {},
  },
  active_competencies: [],
  generated_at: "2026-10-06T12:00:00Z",
  advisory_only: true,
  human_decision_required: true,
};
const risk = {
  id: riskId,
  title: "Synthetic risk",
  kind: "threat",
  consequences: {},
  value_currency: "CAD",
  value_at_risk: 100,
  current_risk_score: 40,
  current_risk_level: "Medium",
} as RiskRecord;
function mount(kind: "information" | "treatment" | "analysis") {
  const onDone = vi.fn();
  render(
    <ActionModal
      risk={risk}
      allRisks={[risk]}
      participants={[
        {
          id: ownerId,
          full_name: "Synthetic owner",
          role: "reliability_engineer",
        },
      ]}
      kind={kind}
      onClose={vi.fn()}
      onDone={onDone}
    />,
  );
  return onDone;
}
function validInformation() {
  fireEvent.change(
    screen.getByLabelText("Inspection, test or enquiry being valued", {
      exact: false,
    }),
    { target: { value: "Inspect synthetic bearing" } },
  );
  fireEvent.change(
    screen.getByLabelText("Information cost", { exact: false }),
    { target: { value: "10" } },
  );
}
function submit() {
  fireEvent.submit(screen.getByRole("dialog").querySelector("form")!);
}
describe("actual governed Risk ActionModal", () => {
  beforeEach(() => {
    wire.body = null;
    wire.fail = false;
    wire.gate = null;
    wire.previewGate = null;
    wire.analysisResult = null;
    wire.analysisReads = [];
    wire.writes = [];
  });
  it.each([
    "Information cost",
    "Cost if the decision is wrong",
    "Uncertainty reduction (0–1)",
    "Probability the decision changes (0–1)",
  ])("does not record blank %s as zero", async (label) => {
    const done = mount("information");
    validInformation();
    fireEvent.change(screen.getByLabelText(label, { exact: false }), {
      target: { value: "" },
    });
    expect(
      screen.getByTestId("value-of-information-preview"),
    ).toHaveTextContent("Enter non-negative");
    expect(screen.getByLabelText(label, { exact: false })).toBeRequired();
    expect(
      screen.getByRole("dialog").querySelector("form")!.checkValidity(),
    ).toBe(false);
    submit();
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveTextContent(
        /valid.*information|information.*required/i,
      ),
    );
    expect(wire.writes).toHaveLength(0);
    expect(done).not.toHaveBeenCalled();
  });
  it("uses exactly the displayed qualified input when recording canonical evidence", async () => {
    const done = mount("information");
    validInformation();
    submit();
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(wire.writes).toEqual([
      {
        p_risk_id: riskId,
        p_analysis: {
          information_action: "Inspect synthetic bearing",
          information_cost: 10,
          decision_cost_if_wrong: 100,
          uncertainty_reduction: 0.5,
          probability_decision_changes: 0.5,
          currency: "CAD",
        },
      },
    ]);
  });
  it.each(["transport", "empty receipt"])(
    "keeps %s outcome unknown open and blocks duplicate submission/edits",
    async (mode) => {
      const done = mount("information");
      validInformation();
      wire.fail = mode === "transport";
      wire.body = mode === "empty receipt" ? {} : null;
      submit();
      await waitFor(() =>
        expect(screen.getByRole("dialog")).toHaveTextContent(
          /outcome.*unknown/i,
        ),
      );
      expect(done).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Record information" }),
      ).toBeDisabled();
      expect(
        screen.getByLabelText("Information cost", { exact: false }),
      ).toBeDisabled();
      submit();
      expect(wire.writes).toHaveLength(1);
      expect(screen.getByRole("dialog")).toHaveTextContent(
        /reconcile|check.*evidence/i,
      );
    },
  );
  it("reports selection-contract gaps instead of claiming ready for approval", async () => {
    mount("treatment");
    fireEvent.change(screen.getByLabelText("Required approver role"), {
      target: { value: "maintenance_manager" },
    });
    fireEvent.change(screen.getByLabelText("Verification method"), {
      target: { value: "Inspect completed repair" },
    });
    const preview = screen.getByTestId("treatment-readiness-preview");
    await waitFor(() => expect(preview).toHaveTextContent("rationale"));
    expect(preview).toHaveTextContent(/consequence|alternatives/);
    expect(preview).toHaveTextContent(/completion/);
    expect(
      within(preview).queryByText("ready for approval"),
    ).not.toBeInTheDocument();
    expect(preview).toHaveTextContent(/preflight/i);
  });
  it("keeps complete treatment preflight explicitly separate from human approval", async () => {
    mount("treatment");
    for (const [label, value] of [
      ["Option label", "Repair synthetic bearing"],
      ["Required approver role", "maintenance_manager"],
      ["Verification method", "Inspect completed repair"],
      ["Rationale", "Synthetic evidence supports comparing this repair option"],
      ["Consequence of being wrong", "Synthetic production interruption"],
      ["Alternatives considered", "Replace the bearing or inspect further"],
      ["Completion date", "2026-10-10"],
    ])
      fireEvent.change(screen.getByLabelText(label, { exact: false }), {
        target: { value },
      });
    await waitFor(() =>
      expect(
        screen.getByTestId("treatment-readiness-preview"),
      ).toHaveTextContent("preflight inputs complete — not approved"),
    );
    expect(screen.getByTestId("treatment-readiness-preview")).toHaveTextContent(
      /database validates the full contract/i,
    );
    fireEvent.change(screen.getByLabelText("Expected residual score"), {
      target: { value: "" },
    });
    expect(screen.getByTestId("treatment-readiness-preview")).toHaveTextContent(
      "finite residual risk score",
    );
  });
  it("locks pending edits and synchronous duplicate submission until the exact receipt", async () => {
    let release!: () => void;
    wire.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const done = mount("information");
    validInformation();
    submit();
    submit();
    await waitFor(() => expect(wire.writes).toHaveLength(1));
    expect(
      screen.getByLabelText("Information cost", { exact: false }),
    ).toBeDisabled();
    await act(async () => {
      release();
    });
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
  });
  it("does not complete another risk's modal when a previous risk response arrives", async () => {
    let release!: () => void;
    wire.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const done = vi.fn();
    const view = render(
      <ActionModal
        risk={risk}
        allRisks={[risk]}
        participants={[]}
        kind="information"
        onClose={vi.fn()}
        onDone={done}
      />,
    );
    validInformation();
    submit();
    view.rerender(
      <ActionModal
        risk={{ ...risk, id: ownerId }}
        allRisks={[risk]}
        participants={[]}
        kind="information"
        onClose={vi.fn()}
        onDone={done}
      />,
    );
    await act(async () => {
      release();
    });
    expect(done).not.toHaveBeenCalled();
  });
  it("does not announce completion after unmount", async () => {
    let release!: () => void;
    wire.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const done = vi.fn();
    const view = render(
      <ActionModal
        risk={risk}
        allRisks={[risk]}
        participants={[]}
        kind="information"
        onClose={vi.fn()}
        onDone={done}
      />,
    );
    validInformation();
    submit();
    view.unmount();
    await act(async () => {
      release();
    });
    expect(done).not.toHaveBeenCalled();
  });
  it("keeps a proven noncommitting domain refusal editable without completing", async () => {
    const done = mount("information");
    validInformation();
    wire.body = { error: "Synthetic governed refusal" };
    submit();
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveTextContent(
        "Information recording refused",
      ),
    );
    expect(done).not.toHaveBeenCalled();
    expect(
      screen.getByLabelText("Information cost", { exact: false }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Record information" }),
    ).not.toBeDisabled();
  });
  it("does not unlock a second write when post-acknowledgement view completion throws", async () => {
    render(
      <ActionModal
        risk={risk}
        allRisks={[risk]}
        participants={[]}
        kind="information"
        onClose={vi.fn()}
        onDone={() => {
          throw new Error("Synthetic view completion failed");
        }}
      />,
    );
    validInformation();
    submit();
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveTextContent(/reconcile/i),
    );
    expect(
      screen.getByRole("button", { name: "Record information" }),
    ).toBeDisabled();
    submit();
    expect(wire.writes).toHaveLength(1);
    expect(screen.getByRole("dialog")).toHaveTextContent(/qualified.*receipt/i);
  });
  it("renders the canonical PostgreSQL 60 High result without local threshold reclassification", async () => {
    mount("analysis");
    await waitFor(() =>
      expect(screen.getByTestId("risk-analysis-preview")).toHaveTextContent(
        "60 · High",
      ),
    );
    expect(screen.getByTestId("risk-analysis-preview")).toHaveTextContent(
      "TREAT",
    );
    expect(wire.analysisReads).toHaveLength(1);
  });
  it("preserves a server Low result even when its rounded displayed value is 10", async () => {
    wire.analysisResult = {
      current_score: 10,
      level: "Low",
      recommended_action: "MONITOR",
    };
    mount("analysis");
    await waitFor(() =>
      expect(screen.getByTestId("risk-analysis-preview")).toHaveTextContent(
        "10 · Low",
      ),
    );
    expect(screen.getByTestId("risk-analysis-preview")).toHaveTextContent(
      "MONITOR",
    );
  });
  it("uses one analysis payload for the live preview and recording and refuses blank likelihood", async () => {
    const done = mount("analysis");
    await waitFor(() => expect(wire.analysisReads).toHaveLength(1));
    submit();
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(wire.writes[0]).toEqual(wire.analysisReads[0]);
  });
  it("refuses blank analysis numbers in both preview and recording", async () => {
    const done = mount("analysis");
    await waitFor(() => expect(wire.analysisReads).toHaveLength(1));
    fireEvent.change(screen.getByLabelText("Likelihood", { exact: false }), {
      target: { value: "" },
    });
    submit();
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveTextContent(
        /valid.*analysis|analysis.*required/i,
      ),
    );
    expect(wire.writes).toHaveLength(0);
    expect(done).not.toHaveBeenCalled();
    expect(screen.getByTestId("risk-analysis-preview")).not.toHaveTextContent(
      "60 · High",
    );
  });
  it("does not show an older input's response after the form changes", async () => {
    let release!: () => void;
    wire.previewGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mount("analysis");
    await waitFor(() => expect(wire.analysisReads).toHaveLength(1));
    wire.previewGate = null;
    wire.analysisResult = {
      current_score: 10,
      level: "Low",
      recommended_action: "MONITOR",
    };
    fireEvent.change(screen.getByLabelText("Likelihood", { exact: false }), {
      target: { value: "2" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("risk-analysis-preview")).toHaveTextContent(
        "10 · Low",
      ),
    );
    await act(async () => {
      release();
    });
    expect(screen.getByTestId("risk-analysis-preview")).not.toHaveTextContent(
      "60 · High",
    );
  });
  it("keeps malformed analysis write outcomes open with the submitted inputs locked", async () => {
    const done = mount("analysis");
    wire.body = {};
    await waitFor(() => expect(wire.analysisReads).toHaveLength(1));
    submit();
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveTextContent(/outcome.*unknown/i),
    );
    expect(done).not.toHaveBeenCalled();
    expect(
      screen.getByLabelText("Likelihood", { exact: false }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Record analysis" }),
    ).toBeDisabled();
    submit();
    expect(wire.writes).toHaveLength(1);
  });
  it("completes only a qualified treatment comparison receipt", async () => {
    const done = mount("treatment");
    fireEvent.change(screen.getByLabelText("Option label", { exact: false }), {
      target: { value: "Repair synthetic bearing" },
    });
    submit();
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(wire.writes[0].p_select).toBe(false);
  });
  it.each(["transport", "empty receipt", "partial persisted scenario"])(
    "retains %s treatment outcome for reconciliation and refuses duplicate writes",
    async (mode) => {
      const done = mount("treatment");
      fireEvent.change(
        screen.getByLabelText("Option label", { exact: false }),
        { target: { value: "Repair synthetic bearing" } },
      );
      wire.fail = mode === "transport";
      wire.body =
        mode === "partial persisted scenario"
          ? {
              error: "Synthetic selection refusal after persistence",
              scenario_id: "55555555-5555-4555-8555-555555555555",
              selected: false,
            }
          : {};
      submit();
      await waitFor(() =>
        expect(screen.getByRole("dialog")).toHaveTextContent(
          /outcome.*unknown/i,
        ),
      );
      expect(done).not.toHaveBeenCalled();
      expect(
        screen.getByLabelText("Option label", { exact: false }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Record treatment" }),
      ).toBeDisabled();
      submit();
      expect(wire.writes).toHaveLength(1);
      expect(screen.getByRole("dialog")).toHaveTextContent(
        /secondary.*risk|scenario.*evidence/i,
      );
    },
  );
  it("locks pending treatment inputs and synchronous duplicate submit", async () => {
    let release!: () => void;
    wire.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const done = mount("treatment");
    fireEvent.change(screen.getByLabelText("Option label", { exact: false }), {
      target: { value: "Repair synthetic bearing" },
    });
    submit();
    submit();
    await waitFor(() => expect(wire.writes).toHaveLength(1));
    expect(
      screen.getByLabelText("Option label", { exact: false }),
    ).toBeDisabled();
    await act(async () => {
      release();
    });
    await waitFor(() => expect(done).toHaveBeenCalledOnce());
  });
  it.each([
    { select: true, gaps: [], label: "selected treatment without gaps" },
    { select: false, gaps: [], label: "comparison without gaps" },
    {
      select: false,
      gaps: ["competency: synthetic inspection"],
      label: "comparison with readiness gaps",
    },
  ])(
    "locks impossible $label refusal for reconciliation",
    async ({ select, gaps }) => {
      const done = mount("treatment");
      fireEvent.change(
        screen.getByLabelText("Option label", { exact: false }),
        {
          target: { value: "Repair synthetic bearing" },
        },
      );
      fireEvent.change(
        screen.getByLabelText("Select and route for approval?"),
        {
          target: { value: String(select) },
        },
      );
      wire.body = {
        error: "treatment is not executable",
        selected: false,
        readiness_gaps: gaps,
      };
      submit();
      await waitFor(() =>
        expect(screen.getByRole("dialog")).toHaveTextContent(
          /outcome.*unknown/i,
        ),
      );
      expect(done).not.toHaveBeenCalled();
      expect(
        screen.getByLabelText("Option label", { exact: false }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Record treatment" }),
      ).toBeDisabled();
      submit();
      expect(wire.writes).toHaveLength(1);
      expect(wire.writes[0].p_select).toBe(select);
      expect(screen.getByRole("dialog")).toHaveTextContent(/reconcil/i);
    },
  );
  it("does not claim selected success without canonical recommendation and approval identities", async () => {
    const done = mount("treatment");
    fireEvent.change(screen.getByLabelText("Select and route for approval?"), {
      target: { value: "true" },
    });
    submit();
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveTextContent(/outcome.*unknown/i),
    );
    expect(done).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Record treatment" }),
    ).toBeDisabled();
  });
  it("does not complete another risk when a pending treatment receipt arrives", async () => {
    let release!: () => void;
    wire.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const done = vi.fn();
    const view = render(
      <ActionModal
        risk={risk}
        allRisks={[risk]}
        participants={[]}
        kind="treatment"
        onClose={vi.fn()}
        onDone={done}
      />,
    );
    submit();
    await waitFor(() => expect(wire.writes).toHaveLength(1));
    view.rerender(
      <ActionModal
        risk={{ ...risk, id: ownerId }}
        allRisks={[risk]}
        participants={[]}
        kind="treatment"
        onClose={vi.fn()}
        onDone={done}
      />,
    );
    await act(async () => {
      release();
    });
    expect(done).not.toHaveBeenCalled();
  });
  it("keeps a qualified treatment receipt locked if view completion fails", async () => {
    render(
      <ActionModal
        risk={risk}
        allRisks={[risk]}
        participants={[]}
        kind="treatment"
        onClose={vi.fn()}
        onDone={() => {
          throw new Error("Synthetic treatment view failure");
        }}
      />,
    );
    submit();
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveTextContent(
        /qualified.*receipt/i,
      ),
    );
    expect(
      screen.getByRole("button", { name: "Record treatment" }),
    ).toBeDisabled();
    submit();
    expect(wire.writes).toHaveLength(1);
  });
  it.each(["information", "analysis", "treatment"] as const)(
    "keeps qualified %s receipt locked when asynchronous view completion rejects",
    async (kind) => {
      let rejectCompletion!: (cause: Error) => void;
      const completion = new Promise<void>((_resolve, reject) => {
        rejectCompletion = reject;
      });
      // Observe the original rejection in the harness without changing the
      // rejected promise returned to the actual production callback boundary.
      void completion.catch(() => undefined);
      const done = vi.fn(() => completion);
      render(
        <ActionModal
          risk={risk}
          allRisks={[risk]}
          participants={[]}
          kind={kind}
          onClose={vi.fn()}
          onDone={done}
        />,
      );
      if (kind === "information") validInformation();
      submit();
      await waitFor(() => expect(done).toHaveBeenCalledOnce());
      await act(async () => {
        rejectCompletion(new Error("Synthetic deferred completion rejection"));
      });
      await waitFor(() =>
        expect(screen.getByRole("dialog")).toHaveTextContent(
          /qualified.*receipt.*view.*complete/i,
        ),
      );
      expect(screen.getByRole("dialog")).toHaveTextContent(/reconcil/i);
      expect(
        screen.getByRole("button", {
          name:
            kind === "information"
              ? "Record information"
              : kind === "analysis"
                ? "Record analysis"
                : "Record treatment",
        }),
      ).toBeDisabled();
      submit();
      expect(wire.writes).toHaveLength(1);
      expect(done).toHaveBeenCalledOnce();
    },
  );
});
