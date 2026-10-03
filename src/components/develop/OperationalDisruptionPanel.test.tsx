import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  CaseOperationalDisruption,
  WorkspaceEvidence,
} from "../../lib/develop";
import { recordOptionOperationalDisruption } from "../../services/developService";
import { OperationalDisruptionPanel } from "./OperationalDisruptionPanel";

vi.mock("../../services/developService", () => ({
  recordOptionOperationalDisruption: vi.fn().mockResolvedValue({
    assessmentId: "assessment-2",
    revision: 2,
  }),
}));

const evidence = [
  {
    id: "e1000000-0000-4000-8000-000000000001",
    description: "Construction execution estimate",
  },
  {
    id: "e1000000-0000-4000-8000-000000000002",
    description: "Production forecast",
  },
  {
    id: "e1000000-0000-4000-8000-000000000003",
    description: "SIMOPS risk assessment",
  },
] as WorkspaceEvidence[];

const model: CaseOperationalDisruption = {
  caseId: "case-1",
  available: true,
  currency: "CAD",
  formula: "ProjectValue − ConstructionDisruption − ProductionLoss − SIMOPSRisk",
  comparisonComplete: false,
  decisionBoundary:
    "SyncAI does not rank, recommend, approve or select an option.",
  availableOutageWindows: [
    {
      id: "outage-1",
      windowKey: "TA-2027-01",
      title: "Spring turnaround",
      kind: "turnaround",
      startsAt: "2027-04-01T00:00:00Z",
      endsAt: "2027-04-04T00:00:00Z",
      status: "planned",
    },
  ],
  options: [
    {
      id: 44,
      label: "One-outage tie-in",
      isDoNothing: false,
      valueEvaluations: [
        {
          id: "value-1",
          projectValue: 10_000_000,
          basis: "Recorded NPV evaluation",
          uncertaintyLevel: "moderate",
          evaluatedAt: "2026-09-01T00:00:00Z",
          engineVersion: "develop-value/1",
        },
      ],
      assessment: null,
      missing: [
        "ProjectValue evaluation",
        "ConstructionDisruption",
        "ProductionLoss",
        "SIMOPSRisk",
        "outage scope",
      ],
    },
  ],
};

describe("OperationalDisruptionPanel", () => {
  it("renders the exact formula, named gaps, and no-selection boundary", () => {
    render(
      <OperationalDisruptionPanel
        model={model}
        evidence={evidence}
        canPlan={false}
        busy={false}
        run={async (fn) => void (await fn())}
      />,
    );
    expect(screen.getByText(/ProjectValue − ConstructionDisruption − ProductionLoss − SIMOPSRisk/)).toBeInTheDocument();
    expect(screen.getByText(/Named gaps: ProjectValue evaluation, ConstructionDisruption, ProductionLoss, SIMOPSRisk, outage scope/i)).toBeInTheDocument();
    expect(screen.getByText(/does not rank, recommend, approve or select/i)).toBeInTheDocument();
  });

  it("records all three evidenced deductions and the canonical outage scope", async () => {
    render(
      <OperationalDisruptionPanel
        model={model}
        evidence={evidence}
        canPlan
        busy={false}
        run={async (fn) => void (await fn())}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Record disruption model" }));
    const costs = [
      ["Construction disruption cost", "1000000"],
      ["Production loss cost", "500000"],
      ["SIMOPS risk cost", "250000"],
    ];
    for (const [placeholder, value] of costs) {
      fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
    }
    fireEvent.change(screen.getByPlaceholderText("Construction disruption basis and boundary"), {
      target: { value: "Controlled construction estimate for the tie-in scope" },
    });
    fireEvent.change(screen.getByPlaceholderText("Production loss basis and boundary"), {
      target: { value: "Approved production forecast for the outage duration" },
    });
    fireEvent.change(screen.getByPlaceholderText("SIMOPS risk basis and boundary"), {
      target: { value: "Quantified reviewed SIMOPS risk exposure for concurrent work" },
    });
    const selects = screen.getAllByRole("combobox");
    fireEvent.change(selects[1], { target: { value: evidence[0].id } });
    fireEvent.change(selects[2], { target: { value: evidence[1].id } });
    fireEvent.change(selects[3], { target: { value: evidence[2].id } });
    fireEvent.click(screen.getByRole("checkbox", { name: /TA-2027-01/i }));
    fireEvent.change(screen.getByPlaceholderText(/Why these windows are the complete scope/i), {
      target: { value: "The tie-in requires only the controlled spring turnaround window" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record governed calculation" }));
    await waitFor(() =>
      expect(recordOptionOperationalDisruption).toHaveBeenCalledWith({
        optionId: 44,
        valueEvaluationId: "value-1",
        constructionDisruptionCost: 1_000_000,
        constructionDisruptionBasis: "Controlled construction estimate for the tie-in scope",
        constructionDisruptionEvidenceItemId: evidence[0].id,
        productionLossCost: 500_000,
        productionLossBasis: "Approved production forecast for the outage duration",
        productionLossEvidenceItemId: evidence[1].id,
        simopsRiskCost: 250_000,
        simopsRiskBasis: "Quantified reviewed SIMOPS risk exposure for concurrent work",
        simopsRiskEvidenceItemId: evidence[2].id,
        outageWindowIds: ["outage-1"],
        outageScopeBasis: "The tie-in requires only the controlled spring turnaround window",
      }),
    );
  });
});
