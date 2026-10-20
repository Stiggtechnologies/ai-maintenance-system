import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getWorkforceExecutionWorkspace,
  recordCrewTemplate,
  recordKnowledgeArea,
  recordKnowledgeHolder,
  recordKnowledgeTransferPlan,
  recordSpecialisedTool,
  registerWorkforceStandard,
  type WorkforceExecutionWorkspace,
} from "../services/workforceExecutionService";
import { WorkforceExecutionControls } from "./WorkforceExecutionControls";

vi.mock("../services/workforceExecutionService", () => ({
  getWorkforceExecutionWorkspace: vi.fn(),
  recordCrewTemplate: vi.fn(),
  recordKnowledgeArea: vi.fn(),
  recordKnowledgeHolder: vi.fn(),
  recordKnowledgeTransferPlan: vi.fn(),
  recordSpecialisedTool: vi.fn(),
  registerWorkforceStandard: vi.fn(),
}));

const workspace: WorkforceExecutionWorkspace = {
  answered: true,
  boundary: "Planning inputs do not dispatch or grant competency.",
  competencies: [{ id: 9, title: "Hydraulic tensioner operator" }],
  members: [{ id: 7, displayName: "A. Technician", craft: "Millwright" }],
  evidence: [{ id: "evidence-1", description: "Verified workforce evidence" }],
  crewTemplates: [],
  tools: [],
  knowledgeAreas: [
    {
      id: 12,
      areaKey: "compressor-startup",
      title: "Compressor startup knowledge",
      consequenceIfLost: "The train cannot be restarted safely after a trip.",
      criticality: "critical",
      documentedWhere: "OPS-START-004",
      version: 2,
      basis: "Verified operating procedure and supervisor assessment.",
      evidenceItemId: "evidence-1",
      holders: [],
    },
  ],
  standards: [],
};

describe("WorkforceExecutionControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWorkforceExecutionWorkspace).mockResolvedValue(workspace);
    for (const action of [
      recordCrewTemplate,
      recordKnowledgeArea,
      recordKnowledgeHolder,
      recordKnowledgeTransferPlan,
      recordSpecialisedTool,
      registerWorkforceStandard,
    ]) {
      vi.mocked(action).mockResolvedValue({ answered: true, note: "Recorded" });
    }
  });

  async function open() {
    render(<WorkforceExecutionControls />);
    fireEvent.click(
      screen.getByText("Govern crews, tools, knowledge and standard work"),
    );
    await screen.findByRole("button", { name: "Record crew composition" });
  }

  it("records an evidence-backed crew composition with canonical competency references", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Crew template key"), {
      target: { value: "compressor-major" },
    });
    fireEvent.change(screen.getByLabelText("Crew template title"), {
      target: { value: "Compressor major maintenance crew" },
    });
    fireEvent.change(screen.getByLabelText("Crew role 1 label"), {
      target: { value: "Lead millwright" },
    });
    fireEvent.change(screen.getByLabelText("Crew role 1 craft"), {
      target: { value: "Millwright" },
    });
    fireEvent.change(screen.getByLabelText("Crew role 1 headcount"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Crew role 1 competency"), {
      target: { value: "9" },
    });
    fireEvent.change(screen.getByLabelText("Crew evidence"), {
      target: { value: "evidence-1" },
    });
    fireEvent.change(screen.getByLabelText("Crew composition basis"), {
      target: {
        value: "Approved task analysis requires this crew and authorization.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record crew composition" }),
    );
    await waitFor(() =>
      expect(recordCrewTemplate).toHaveBeenCalledWith({
        templateKey: "compressor-major",
        title: "Compressor major maintenance crew",
        description: undefined,
        basis: "Approved task analysis requires this crew and authorization.",
        evidenceItemId: "evidence-1",
        roles: [
          {
            roleLabel: "Lead millwright",
            craft: "Millwright",
            headcount: "2",
            requiredCompetencyId: "9",
            isMandatory: true,
          },
        ],
      }),
    );
  });

  it("records observed tool availability without inferring operator competency", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Tool key"), {
      target: { value: "hydraulic-tensioner" },
    });
    fireEvent.change(screen.getByLabelText("Tool title"), {
      target: { value: "Hydraulic bolt tensioner" },
    });
    fireEvent.change(screen.getByLabelText("Quantity available"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Tool operator competency"), {
      target: { value: "9" },
    });
    fireEvent.change(screen.getByLabelText("Tool evidence"), {
      target: { value: "evidence-1" },
    });
    fireEvent.change(screen.getByLabelText("Tool availability basis"), {
      target: {
        value: "Verified tool crib count and current calibration record.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record tool availability" }),
    );
    await waitFor(() =>
      expect(recordSpecialisedTool).toHaveBeenCalledWith(
        expect.objectContaining({
          toolKey: "hydraulic-tensioner",
          quantityAvailable: "1",
          requiredCompetencyId: "9",
          evidenceItemId: "evidence-1",
        }),
      ),
    );
  });

  it("updates a reviewed knowledge definition with optimistic versioning", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Knowledge definition"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("Knowledge definition evidence"), {
      target: { value: "evidence-1" },
    });
    fireEvent.change(screen.getByLabelText("Knowledge definition basis"), {
      target: {
        value: "Annual review reconfirmed the consequence and source.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record knowledge definition" }),
    );
    await waitFor(() =>
      expect(recordKnowledgeArea).toHaveBeenCalledWith(
        expect.objectContaining({
          areaKey: "compressor-startup",
          expectedVersion: 2,
          evidenceItemId: "evidence-1",
        }),
      ),
    );
  });

  it("keeps holder evidence and transfer planning as separate acts", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Knowledge holder area"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("Knowledge holder member"), {
      target: { value: "7" },
    });
    fireEvent.change(screen.getByLabelText("Knowledge holder depth"), {
      target: { value: "expert" },
    });
    fireEvent.change(screen.getByLabelText("Knowledge holder evidence"), {
      target: { value: "evidence-1" },
    });
    fireEvent.change(screen.getByLabelText("Knowledge holder basis"), {
      target: {
        value: "Observed field execution and approved assessment evidence.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record knowledge-holder act" }),
    );
    await waitFor(() =>
      expect(recordKnowledgeHolder).toHaveBeenCalledWith(
        expect.objectContaining({ areaId: 12, memberId: 7, depth: "expert" }),
      ),
    );

    fireEvent.change(screen.getByLabelText("Transfer knowledge area"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("Transfer target member"), {
      target: { value: "7" },
    });
    fireEvent.change(screen.getByLabelText("Transfer competency"), {
      target: { value: "9" },
    });
    fireEvent.change(screen.getByLabelText("Transfer target date"), {
      target: { value: "2027-04-01" },
    });
    fireEvent.change(screen.getByLabelText("Transfer plan driver"), {
      target: {
        value: "Named succession exposure requires verified transfer.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record knowledge-transfer plan" }),
    );
    await waitFor(() =>
      expect(recordKnowledgeTransferPlan).toHaveBeenCalledWith({
        knowledgeAreaId: 12,
        memberId: 7,
        competencyId: 9,
        planKind: "succession",
        targetDate: "2027-04-01",
        driver: "Named succession exposure requires verified transfer.",
      }),
    );
  });

  it("registers existing human-verified procedure content by language", async () => {
    await open();
    fireEvent.change(screen.getByLabelText("Standard work key"), {
      target: { value: "compressor-start" },
    });
    fireEvent.change(screen.getByLabelText("Standard work title"), {
      target: { value: "Compressor controlled startup" },
    });
    fireEvent.change(screen.getByLabelText("Procedure language code"), {
      target: { value: "fr-CA" },
    });
    fireEvent.change(screen.getByLabelText("Standard work evidence"), {
      target: { value: "evidence-1" },
    });
    fireEvent.change(screen.getByLabelText("Controlled procedure content"), {
      target: { value: "Contenu existant de la procédure contrôlée." },
    });
    fireEvent.change(screen.getByLabelText("Standard work source basis"), {
      target: { value: "Controlled revision verified by the procedure owner." },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Register verified procedure language",
      }),
    );
    await waitFor(() =>
      expect(registerWorkforceStandard).toHaveBeenCalledWith({
        workKey: "compressor-start",
        title: "Compressor controlled startup",
        language: "fr-CA",
        content: "Contenu existant de la procédure contrôlée.",
        basis: "Controlled revision verified by the procedure owner.",
        evidenceItemId: "evidence-1",
      }),
    );
  });
});
