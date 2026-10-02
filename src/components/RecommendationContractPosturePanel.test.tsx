import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RecommendationContractPosturePanel } from "./RecommendationContractPosturePanel";

const getPosture = vi.fn();

vi.mock("../services/operatingLoopService", async () => {
  const actual = await vi.importActual<
    typeof import("../services/operatingLoopService")
  >("../services/operatingLoopService");
  return {
    ...actual,
    getRecommendationContractPosture: () => getPosture(),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  getPosture.mockResolvedValue([
    {
      register: "C8.21",
      label: "Method for verifying effectiveness",
      blocking: true,
      populated: 2,
      total: 5,
      share: 0.4,
      releasable_rows: 1,
      blocked_rows: 4,
    },
    {
      register: "C8.13",
      label: "Evidence used",
      blocking: true,
      populated: 5,
      total: 5,
      share: 1,
      releasable_rows: 1,
      blocked_rows: 4,
    },
  ]);
});

describe("RecommendationContractPosturePanel", () => {
  it("shows releasable and blocked totals with verification-method coverage", async () => {
    render(<RecommendationContractPosturePanel />);

    expect(
      await screen.findByText("Method for verifying effectiveness"),
    ).toBeInTheDocument();
    expect(screen.getByText("1 releasable")).toBeInTheDocument();
    expect(screen.getByText("4 blocked")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(
      screen.getByText(/never overrides the binary release gate/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Approval does not prove the outcome/i),
    ).toBeInTheDocument();
  });

  it("does not turn an empty recommendation population into a clean bill", async () => {
    getPosture.mockResolvedValue([]);
    render(<RecommendationContractPosturePanel />);

    expect(
      await screen.findByText(/No recommendations are recorded/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/0 releasable/i)).not.toBeInTheDocument();
  });
});
