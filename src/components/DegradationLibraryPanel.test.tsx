import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DegradationLibraryPanel } from "./DegradationLibraryPanel";
import type {
  DegradationFamilyKey,
  DegradationLibraryWorkspace,
  DegradationProfileFamily,
} from "../services/degradationLibraryService";

const getWorkspace = vi.fn();
const propose = vi.fn();
const review = vi.fn();

vi.mock("../services/degradationLibraryService", () => ({
  getDegradationLibraryWorkspace: (...args: unknown[]) =>
    getWorkspace(...args),
  proposeDegradationProfileRevision: (...args: unknown[]) => propose(...args),
  reviewDegradationProfile: (...args: unknown[]) => review(...args),
}));

const keys: DegradationFamilyKey[] = [
  "corrosion",
  "fatigue",
  "creep",
  "erosion",
  "wear",
  "embrittlement",
  "chemical",
  "concrete",
  "timber",
  "insulation_ageing",
  "battery",
  "cable",
  "semiconductor",
  "lubricant",
  "coating",
  "soil_foundation",
];

function family(
  familyKey: DegradationFamilyKey,
  index: number,
): DegradationProfileFamily {
  return {
    familyKey,
    mechanismId: `mechanism-${index}`,
    mechanismKey: `${familyKey}_mechanism`,
    mechanismName: `${familyKey} mechanism`,
    mechanismDescription: `Canonical ${familyKey} mechanism`,
    profileId: `profile-${index}`,
    version: index === 1 ? 2 : 1,
    title: `${familyKey.replaceAll("_", " ")} degradation`,
    description: `Governed evidence requirements for ${familyKey} degradation.`,
    stressorRequirements: ["recorded stressor history"],
    damageStateRequirements: ["measured damage state"],
    observationRequirements: ["traceable observation method"],
    candidateModelKinds: ["standards_method"],
    applicabilityQuestions: ["Is the mechanism evidenced?"],
    limitations:
      "No engineering limit, rate, interval or remaining life is supplied.",
    status: index === 1 ? "pending_review" : "reference_draft",
    sourceEvidenceItemId: index === 1 ? "evidence-1" : null,
    authorId: index === 1 ? "author-1" : null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    detectability: [],
    linkedModels: [],
    operationalAuthorization: false,
  };
}

const workspace: DegradationLibraryWorkspace = {
  families: keys.map(family),
  coverage: {
    requiredFamilies: 16,
    representedFamilies: 16,
    approvedFamilies: 0,
    familiesWithLinkedModels: 0,
  },
  boundary:
    "The library supplies no limit, rate, remaining life, interval or operational authority.",
};

describe("DegradationLibraryPanel", () => {
  beforeEach(() => {
    getWorkspace.mockReset().mockResolvedValue(workspace);
    propose.mockReset().mockResolvedValue({ profileId: "new-profile" });
    review.mockReset().mockResolvedValue({ decision: "approved" });
  });

  it("renders all sixteen governed families and the human-final boundary", async () => {
    render(
      <DegradationLibraryPanel
        evidence={[]}
        canManage={false}
        currentUserId="viewer-1"
      />,
    );
    expect(await screen.findByText("16/16 represented")).toBeTruthy();
    expect(screen.getByText("corrosion degradation")).toBeTruthy();
    expect(screen.getByText("soil foundation degradation")).toBeTruthy();
    expect(screen.getByText(/supplies no limit, rate/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Propose revision" })).toBeNull();
  });

  it("submits a sourced revision through the governed RPC", async () => {
    render(
      <DegradationLibraryPanel
        evidence={[
          {
            id: "evidence-1",
            description: "Verified corrosion assessment basis",
            source_system: "inspection",
            data_quality: "good",
            verification_status: "verified",
            quality_grade: "high",
          },
        ]}
        canManage
        currentUserId="reviewer-2"
      />,
    );
    const corrosion = await screen.findByRole("heading", {
      name: "corrosion degradation",
    });
    const card = corrosion.closest("article");
    expect(card).toBeTruthy();
    fireEvent.click(
      within(card as HTMLElement).getByRole("button", {
        name: "Propose revision",
      }),
    );
    fireEvent.change(screen.getByLabelText("Verified source evidence"), {
      target: { value: "evidence-1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Submit for independent review" }),
    );
    expect(propose).toHaveBeenCalledWith(
      expect.objectContaining({
        familyKey: "corrosion",
        evidenceItemId: "evidence-1",
        candidateModelKinds: ["standards_method"],
      }),
    );
    expect(
      await screen.findByText(/revision submitted for independent review/),
    ).toBeTruthy();
  });

  it("allows only a different named manager to disposition a pending profile", async () => {
    render(
      <DegradationLibraryPanel
        evidence={[]}
        canManage
        currentUserId="reviewer-2"
      />,
    );
    const pending = await screen.findByRole("heading", {
      name: "fatigue degradation",
    });
    const card = pending.closest("article");
    expect(card).toBeTruthy();
    fireEvent.change(
      within(card as HTMLElement).getByLabelText(
        "Review basis for fatigue degradation",
      ),
      {
        target: {
          value:
            "Independent evidence confirms the exact profile is bounded and suitable.",
        },
      },
    );
    fireEvent.click(
      within(card as HTMLElement).getByRole("button", { name: "Approve" }),
    );
    expect(review).toHaveBeenCalledWith({
      profileId: "profile-1",
      decision: "approved",
      reviewNote:
        "Independent evidence confirms the exact profile is bounded and suitable.",
    });
  });
});
