import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORGANIZATIONAL_MATURITY_DOMAINS } from "../services/organizationalMaturityService";
import { OrganizationalMaturityPage } from "./OrganizationalMaturityPage";

let role = "admin";
const getWorkspace = vi.fn();
const reviewAssessment = vi.fn();

vi.mock("../components/AuthProvider", () => ({
  useAuth: () => ({ profile: { role } }),
}));

vi.mock("../services/organizationalMaturityService", async () => {
  const actual = await vi.importActual<
    typeof import("../services/organizationalMaturityService")
  >("../services/organizationalMaturityService");
  return {
    ...actual,
    getOrganizationalMaturityWorkspace: () => getWorkspace(),
    reviewOrganizationalMaturityAssessment: (input: unknown) =>
      reviewAssessment(input),
    recordOrganizationalMaturityAssessment: vi.fn(),
  };
});

vi.mock("../lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({
              returns: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      }),
    }),
  },
}));

const emptyWorkspace = {
  dimensions: [...ORGANIZATIONAL_MATURITY_DOMAINS],
  scale: [
    { level: 0, label: "Not evidenced" },
    { level: 5, label: "Continuously improved" },
  ],
  assessments: [],
  basis: "Evidence-backed assessment, not certification.",
};

describe("OrganizationalMaturityPage", () => {
  beforeEach(() => {
    role = "admin";
    getWorkspace.mockReset().mockResolvedValue(emptyWorkspace);
    reviewAssessment.mockReset().mockResolvedValue({ decision: "approved" });
  });

  it("renders every required domain and the human-final boundary", async () => {
    render(<OrganizationalMaturityPage />);
    expect(await screen.findByText("Assessment, not certification")).toBeTruthy();
    for (const label of [
      "Leadership",
      "Asset hierarchy",
      "Work management",
      "Planning & scheduling",
      "Failure coding",
      "PM quality",
      "Condition monitoring",
      "Materials",
      "Engineering governance",
      "Data quality",
      "Workforce",
      "Financial integration",
      "AI governance",
    ]) {
      expect(screen.getByLabelText(`${label} score`)).toBeTruthy();
      expect(screen.getByLabelText(`${label} finding`)).toBeTruthy();
      expect(screen.getByLabelText(`${label} evidence`)).toBeTruthy();
    }
    expect(
      screen.getByRole("button", { name: "Submit all 13 dimensions" }),
    ).toBeDisabled();
  });

  it("shows submitted evidence and routes review through the governed service", async () => {
    getWorkspace.mockResolvedValue({
      ...emptyWorkspace,
      assessments: [
        {
          id: "assessment-1",
          title: "Annual baseline",
          scope: "All sites and maintenance functions.",
          evidenceSummary: "Verified source records were reviewed.",
          status: "submitted",
          overallLevel: 2.25,
          minimumLevel: 1,
          assessedBy: "assessor-1",
          assessedAt: "2026-09-15T00:00:00Z",
          nextReview: null,
          reviewedBy: null,
          reviewedAt: null,
          reviewNote: null,
          domains: ORGANIZATIONAL_MATURITY_DOMAINS.map((domainKey) => ({
            domainKey,
            score: 2,
            finding: `A verified finding for ${domainKey} is recorded here.`,
            evidenceItemId: `evidence-${domainKey}`,
            evidenceDescription: `Evidence for ${domainKey}`,
            evidenceVerificationStatus: "verified" as const,
          })),
          recommendations: [],
          operationalAuthorization: false as const,
          certificationClaim: false as const,
        },
      ],
    });
    render(<OrganizationalMaturityPage />);
    expect(await screen.findByText("Annual baseline")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Review note for Annual baseline"), {
      target: {
        value: "Independent review confirms every score and evidence link.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Approve assessment" }));
    expect(reviewAssessment).toHaveBeenCalledWith({
      assessmentId: "assessment-1",
      decision: "approved",
      reviewNote: "Independent review confirms every score and evidence link.",
    });
    expect(
      await screen.findByText(
        "Assessment approved; the decision is now in the canonical approval trail.",
      ),
    ).toBeTruthy();
  });

  it("keeps non-assessor roles read-only", async () => {
    role = "board";
    render(<OrganizationalMaturityPage />);
    expect(
      await screen.findByText(/This is a read-only view for your role/),
    ).toBeTruthy();
    expect(screen.queryByText("Submit a complete assessment")).toBeNull();
  });
});
