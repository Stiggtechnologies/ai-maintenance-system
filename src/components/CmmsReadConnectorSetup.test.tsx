import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CmmsReadConnectorSetup } from "./CmmsReadConnectorSetup";

const auth = vi.hoisted(() => ({ role: "admin" }));
const actions = vi.hoisted(() => ({
  configure: vi.fn(),
  map: vi.fn(),
  pull: vi.fn(),
}));

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role: auth.role } }),
}));
vi.mock("../services/cmmsRead", () => ({ cmmsReadActions: actions }));

beforeEach(() => {
  auth.role = "admin";
  actions.configure.mockReset().mockResolvedValue({ note: "Source saved." });
  actions.map.mockReset().mockResolvedValue({ note: "Mapping approved." });
  actions.pull.mockReset().mockResolvedValue({
    pages: 2,
    read: 2,
    accepted: 2,
    rejected: 0,
  });
});

describe("CMMS read connector setup", () => {
  it("submits an explicit bounded pagination profile with the governed source", async () => {
    const onConfigured = vi.fn().mockResolvedValue(undefined);
    render(<CmmsReadConnectorSetup onConfigured={onConfigured} />);

    fireEvent.change(screen.getByPlaceholderText("Connector key"), {
      target: { value: "mine-maximo" },
    });
    fireEvent.change(screen.getByPlaceholderText("Display name"), {
      target: { value: "Mine Maximo" },
    });
    fireEvent.change(
      screen.getByPlaceholderText("https://cmms.example.com/work-orders"),
      { target: { value: "https://maximo.example.com/api/work-orders" } },
    );
    fireEvent.change(screen.getByPlaceholderText("vault://tenant/cmms"), {
      target: { value: "vault://tenant/maximo" },
    });
    fireEvent.change(screen.getByLabelText("Pagination mode"), {
      target: { value: "next_url" },
    });
    fireEvent.change(screen.getByLabelText("Next-link JSON path"), {
      target: { value: "response.links.next" },
    });
    fireEvent.change(screen.getByLabelText("Maximum pages per pull"), {
      target: { value: "25" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(
        "Activation authority and mapping basis (20+ characters)",
      ),
      {
        target: {
          value:
            "The named administrator approved this bounded read-only source.",
        },
      },
    );
    fireEvent.click(
      screen.getByLabelText(
        "Approve the displayed canonical work-order mapping.",
      ),
    );
    fireEvent.click(
      screen.getByLabelText(
        "Enable this read-only source after deployment configuration is present.",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save and enable" }));

    await waitFor(() => expect(actions.configure).toHaveBeenCalledTimes(1));
    expect(actions.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "mine-maximo",
        endpointUrl: "https://maximo.example.com/api/work-orders",
        credentialRef: "vault://tenant/maximo",
        paginationMode: "next_url",
        paginationNextPath: "response.links.next",
        paginationMaxPages: 25,
        enabled: true,
      }),
    );
    expect(actions.map).toHaveBeenCalledWith(
      "mine-maximo",
      "work_orders",
      true,
      expect.stringContaining("named administrator"),
    );
    expect(onConfigured).toHaveBeenCalledTimes(1);
  });

  it("keeps configuration unavailable to non-administrators", () => {
    auth.role = "planner";
    render(<CmmsReadConnectorSetup onConfigured={vi.fn()} />);
    expect(
      screen.getByText(
        "An administrator must configure or enable this source.",
      ),
    ).toBeTruthy();
    expect(screen.queryByPlaceholderText("Connector key")).toBeNull();
  });
});
