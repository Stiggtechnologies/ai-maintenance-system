import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RiskRecord } from "../types/risk";
import {
  getDomainSpecialistRuns,
  reviewDomainSpecialistRun,
  type DomainSpecialistRunRow,
} from "../services/domainSpecialistService";
import { DomainSpecialistWorkbench } from "./DomainSpecialistWorkbench";

vi.mock("../services/domainSpecialistService", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../services/domainSpecialistService")
    >();
  return {
    ...actual,
    getDomainSpecialistRuns: vi.fn().mockResolvedValue([]),
    recordDomainSpecialistRun: vi.fn(),
    reviewDomainSpecialistRun: vi.fn().mockResolvedValue({}),
  };
});

const risk = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Controlled domain decision",
  evidence: [],
} as unknown as RiskRecord;

describe("DomainSpecialistWorkbench", () => {
  beforeEach(() => {
    vi.mocked(getDomainSpecialistRuns).mockResolvedValue([]);
    vi.mocked(reviewDomainSpecialistRun).mockClear();
  });

  it("exposes all 15 modules and refuses a preview without evidence", async () => {
    render(<DomainSpecialistWorkbench risks={[risk]} />);

    const moduleSelect = screen.getByLabelText("Specialist module");
    expect(moduleSelect.querySelectorAll("option")).toHaveLength(15);
    expect(
      screen.getByText(/15 governed modules and 37 deterministic methods/i),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Preview locally" }));

    expect(
      await screen.findByText(
        /refused to calculate because required inputs, evidence provenance/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Missing required evidence reference: geotechnical-model/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/cannot certify compliance/i)).toBeInTheDocument();
  });

  it("switches to the three-method aviation module without losing the governed risk", () => {
    render(<DomainSpecialistWorkbench risks={[risk]} />);
    fireEvent.change(screen.getByLabelText("Specialist module"), {
      target: { value: "aviation-airworthiness" },
    });
    expect(screen.getByLabelText("Governed risk")).toHaveValue(risk.id);
    expect(
      screen.getByLabelText("Method").querySelectorAll("option"),
    ).toHaveLength(3);
    expect(
      screen.getByRole("option", { name: /Airworthiness directive/i }),
    ).toBeInTheDocument();
  });

  it("makes every buildings and facilities method reachable from the governed workbench", () => {
    render(<DomainSpecialistWorkbench risks={[risk]} />);
    fireEvent.change(screen.getByLabelText("Specialist module"), {
      target: { value: "buildings-infrastructure" },
    });
    const methods = screen.getByLabelText("Method").querySelectorAll("option");
    expect(methods).toHaveLength(7);
    expect([...methods].map((option) => option.getAttribute("value"))).toEqual([
      "code-compliance",
      "fire-life-safety",
      "occupancy-accessibility",
      "occupant-environment",
      "bas-control-integrity",
      "energy-water-performance",
      "facility-renewal-priority",
    ]);
  });

  it("exposes the persisted specialist-role gate and records a review", async () => {
    const run = {
      id: "22222222-2222-4222-8222-222222222222",
      risk_id: risk.id,
      module_key: "oil-sands-tailings",
      method_key: "tailings-geotechnical",
      required_reviewer_role_key: "domain_tailings_reviewer",
      run_status: "draft",
      evidence_item_ids: ["33333333-3333-4333-8333-333333333333"],
      created_at: "2026-09-05T00:00:00Z",
      result_envelope: {
        moduleKey: "oil-sands-tailings",
        methodKey: "tailings-geotechnical",
        modelKey: "domain.oil-sands-tailings.tailings-geotechnical",
        modelVersion: "1.0.0",
        status: "draft",
        summary: "Controlled draft",
        metrics: [],
        findings: [],
        gaps: [],
        assumptions: [],
        formulae: [],
        authorityBoundary: "Non-authoritative.",
        requiredApproverRole: "Geotechnical authority",
        requiredApproverRoleKey: "domain_tailings_reviewer",
        humanApprovalRequired: true,
        authoritative: false,
      },
    } as unknown as DomainSpecialistRunRow;
    vi.mocked(getDomainSpecialistRuns).mockResolvedValue([run]);

    render(<DomainSpecialistWorkbench risks={[risk]} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /tailings-geotechnical/i }),
    );
    expect(screen.getAllByText(/domain_tailings_reviewer/)).toHaveLength(2);
    fireEvent.change(screen.getByLabelText("Review basis"), {
      target: {
        value:
          "I independently verified the evidence, assumptions, and calculation.",
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Record independent review" }),
    );

    await waitFor(() =>
      expect(reviewDomainSpecialistRun).toHaveBeenCalledWith(
        run.id,
        "reviewed",
        "I independently verified the evidence, assumptions, and calculation.",
      ),
    );
  });
});
