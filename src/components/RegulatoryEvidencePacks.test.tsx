import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RegulatoryEvidencePacks } from "./RegulatoryEvidencePacks";
import type { RegulatoryEvidenceWorkspace } from "../services/regulatoryEvidenceService";

const getWorkspace = vi.fn();
const assemble = vi.fn();
const release = vi.fn();
const withdraw = vi.fn();
let role = "reliability_engineer";
let userId = "assembler-1";

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { id: userId, role } }),
}));
vi.mock("../services/regulatoryEvidenceService", () => ({
  getRegulatoryEvidenceWorkspace: (...args: unknown[]) => getWorkspace(...args),
  assembleRegulatoryEvidencePack: (...args: unknown[]) => assemble(...args),
  releaseRegulatoryEvidencePack: (...args: unknown[]) => release(...args),
  withdrawRegulatoryEvidencePack: (...args: unknown[]) => withdraw(...args),
}));

const authority = {
  legalComplianceDetermined: false as const,
  workAuthorized: false as const,
  riskAccepted: false as const,
  operatingLimitChanged: false as const,
  returnToServiceAuthorized: false as const,
};

const workspace: RegulatoryEvidenceWorkspace = {
  requirements: [
    {
      layerId: "layer-1",
      layerVersion: 4,
      layerTitle: "Adopted pressure layer",
      jurisdiction: "operator-stated",
      key: "pressure_shutdown_test",
      title: "Pressure shutdown functional test",
      requirementClass: "regulatory",
      applicability: "applicable",
      obligation: "mandatory",
      authorityReference: "operator-reference",
      posture: "gap",
    },
    {
      layerId: "layer-1",
      layerVersion: 4,
      layerTitle: "Adopted pressure layer",
      jurisdiction: "operator-stated",
      key: "retention_review",
      title: "Retention applicability review",
      requirementClass: "regulatory",
      applicability: "undetermined",
      obligation: "advisory",
      authorityReference: "operator-reference",
      posture: "applicability_undetermined",
    },
  ],
  dossiers: [],
  verifiedEvidence: [
    {
      id: "evidence-1",
      description: "Verified shutdown test record",
      sourceSystem: "inspection",
      verifiedBy: "verifier-1",
      verifiedAt: "2026-07-01T00:00:00Z",
    },
  ],
  coverage: {
    mandatoryApplicable: 1,
    covered: 0,
    assembledUnreleased: 0,
    gaps: 1,
  },
  jurisdiction: "operator-stated",
  decisionBoundary:
    "Release records that the cited evidence was assembled for inspection. It does not decide a legal outcome, authorize work, accept risk, change an operating limit, or return equipment to service.",
  ...authority,
};

beforeEach(() => {
  role = "reliability_engineer";
  userId = "assembler-1";
  vi.clearAllMocks();
  getWorkspace.mockResolvedValue(workspace);
  assemble.mockResolvedValue({
    id: "dossier-1",
    status: "assembled",
    version: 1,
    revised: false,
    ...authority,
  });
  release.mockResolvedValue({
    id: "dossier-1",
    status: "released",
    version: 1,
    ...authority,
  });
  withdraw.mockResolvedValue({
    id: "dossier-1",
    status: "withdrawn",
    version: 1,
    ...authority,
  });
});

describe("RegulatoryEvidencePacks", () => {
  it("shows a mandatory gap without turning it into a legal outcome", async () => {
    render(<RegulatoryEvidencePacks />);
    expect(
      await screen.findByText(/No current released dossier/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /1 mandatory requirement has no current released dossier/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not decide a legal outcome/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Applicability is still undetermined, so no dossier is expected/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/non-compliant|compliance established/i),
    ).toBeNull();
    expect(
      screen.queryByRole("option", { name: "Retention applicability review" }),
    ).toBeNull();
  });

  it("assembles cited evidence for an adopted requirement", async () => {
    render(<RegulatoryEvidencePacks />);
    await screen.findByLabelText("Dossier title");
    fireEvent.change(screen.getByLabelText("Dossier title"), {
      target: { value: "2026 inspection dossier" },
    });
    fireEvent.change(screen.getByLabelText("Inspection purpose"), {
      target: {
        value: "Present the verified shutdown-test record for inspection.",
      },
    });
    fireEvent.change(screen.getByLabelText("Verified evidence"), {
      target: { value: "evidence-1" },
    });
    fireEvent.change(screen.getByLabelText("Citation basis"), {
      target: {
        value:
          "This verified record is the inspection citation for the adopted requirement.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add cited evidence" }));
    fireEvent.click(screen.getByRole("button", { name: "Assemble dossier" }));

    await waitFor(() => expect(assemble).toHaveBeenCalledTimes(1));
    expect(assemble).toHaveBeenCalledWith({
      capabilityPackLayerId: "layer-1",
      expectedLayerVersion: 4,
      requirementKey: "pressure_shutdown_test",
      title: "2026 inspection dossier",
      purpose: "Present the verified shutdown-test record for inspection.",
      supersedesId: null,
      items: [
        {
          evidenceItemId: "evidence-1",
          citationBasis:
            "This verified record is the inspection citation for the adopted requirement.",
        },
      ],
    });
    expect(
      await screen.findByText(/No legal outcome was decided/i),
    ).toBeInTheDocument();
  });

  it("lets a different person release and keeps the assembler from releasing", async () => {
    getWorkspace.mockResolvedValue({
      ...workspace,
      requirements: [
        { ...workspace.requirements[0], posture: "assembled_unreleased" },
      ],
      coverage: { ...workspace.coverage, gaps: 0, assembledUnreleased: 1 },
      dossiers: [
        {
          id: "dossier-1",
          version: 1,
          status: "assembled" as const,
          layerId: "layer-1",
          layerVersion: 4,
          requirementKey: "pressure_shutdown_test",
          jurisdiction: "operator-stated",
          title: "2026 inspection dossier",
          purpose: "Present the verified shutdown-test record for inspection.",
          assembledBy: "assembler-1",
          assembledAt: "2026-07-02T00:00:00Z",
          releasedBy: null,
          releasedAt: null,
          releaseBasis: null,
          withdrawnBy: null,
          withdrawnAt: null,
          withdrawalReason: null,
          supersedesId: null,
          stale: false,
          current: false,
          items: [
            {
              id: "citation-1",
              evidenceItemId: "evidence-1",
              description: "Verified shutdown test record",
              citationBasis: "Cited for inspection.",
              verifiedBy: "verifier-1",
              verifiedAt: "2026-07-01T00:00:00Z",
            },
          ],
        },
      ],
    });

    const { unmount } = render(<RegulatoryEvidencePacks />);
    expect(
      await screen.findByText("A different person must release this dossier."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Release for inspection" }),
    ).toBeNull();
    fireEvent.change(screen.getByLabelText("Withdrawal reason"), {
      target: { value: "The adopted requirement changed before release." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Withdraw unreleased dossier" }),
    );
    await waitFor(() => expect(withdraw).toHaveBeenCalledTimes(1));
    unmount();

    userId = "releaser-2";
    render(<RegulatoryEvidencePacks />);
    fireEvent.change(await screen.findByLabelText("Release basis"), {
      target: { value: "I release this exact dossier for inspection only." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Release for inspection" }),
    );
    await waitFor(() =>
      expect(release).toHaveBeenCalledWith({
        dossierId: "dossier-1",
        expectedVersion: 1,
        releaseBasis: "I release this exact dossier for inspection only.",
      }),
    );
  });

  it("shows the gap to a technician and does not offer the writer", async () => {
    role = "technician";
    render(<RegulatoryEvidencePacks />);
    expect(
      await screen.findByText(/No current released dossier/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Assemble dossier" }),
    ).toBeNull();
  });
});
