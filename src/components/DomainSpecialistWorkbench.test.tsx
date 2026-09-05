import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RiskRecord } from "../types/risk";
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
  };
});

const risk = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Controlled domain decision",
  evidence: [],
} as unknown as RiskRecord;

describe("DomainSpecialistWorkbench", () => {
  it("exposes all 14 modules and refuses a preview without evidence", async () => {
    render(<DomainSpecialistWorkbench risks={[risk]} />);

    const moduleSelect = screen.getByLabelText("Specialist module");
    expect(moduleSelect.querySelectorAll("option")).toHaveLength(14);
    expect(
      screen.getByText(/14 governed modules and 29 deterministic methods/i),
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
});
