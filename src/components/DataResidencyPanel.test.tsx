import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataResidencyPanel } from "./DataResidencyPanel";

const getTenantResidency = vi.fn();
const declareTenantResidency = vi.fn();
const bindTenantResidencyPath = vi.fn();
let role = "admin";

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role } }),
}));

vi.mock("../services/dataResidencyService", () => ({
  getTenantResidency: () => getTenantResidency(),
  declareTenantResidency: (...args: unknown[]) =>
    declareTenantResidency(...args),
  bindTenantResidencyPath: (...args: unknown[]) =>
    bindTenantResidencyPath(...args),
}));

const empty = {
  declaration: null,
  bindings: [],
  decisions: [],
  boundary: "Bindings compare a path identifier to the tenant-declared region.",
  operationalAuthority: false as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  role = "admin";
  getTenantResidency.mockResolvedValue(empty);
  declareTenantResidency.mockResolvedValue({ region: "canada-central" });
  bindTenantResidencyPath.mockResolvedValue({ pathRef: "failure-evidence" });
});

describe("DataResidencyPanel", () => {
  it("hides the control from roles that cannot declare residency", async () => {
    role = "technician";
    render(<DataResidencyPanel />);
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Data residency" }),
      ).toBeNull();
    });
    expect(getTenantResidency).not.toHaveBeenCalled();
  });

  it("shows that an undeclared region refuses every governed path", async () => {
    render(<DataResidencyPanel />);
    expect(
      await screen.findByText(
        /storage uploads, processing routes, connector transfers and ai-provider calls are refused/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Declare residency region" }),
    ).toBeDisabled();
  });

  it("declares a region and binds a path only to that region", async () => {
    getTenantResidency.mockResolvedValue({
      ...empty,
      declaration: {
        id: 1,
        version: 1,
        region: "canada-central",
        basis: "Tenant contract names this region.",
        declaredAt: "2026-11-03T00:00:00Z",
        declaredByLabel: "Avery Admin",
      },
    });
    render(<DataResidencyPanel />);
    expect(await screen.findByText("canada-central")).toBeInTheDocument();
    expect(
      screen.getByText(/does not authorize plant action/i),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Residency path reference"), {
      target: { value: "failure-evidence" },
    });
    fireEvent.change(screen.getByLabelText("Residency binding basis"), {
      target: {
        value:
          "The failure-evidence bucket is operated in the declared region.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Bind path" }));
    await waitFor(() =>
      expect(bindTenantResidencyPath).toHaveBeenCalledWith(
        "storage",
        "failure-evidence",
        "The failure-evidence bucket is operated in the declared region.",
      ),
    );
  });
});
