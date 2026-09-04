import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlantHistorianConnectorSetup } from "./PlantHistorianConnectorSetup";

const configureSource = vi.fn();
const saveMapping = vi.fn();
const pull = vi.fn();
let role = "admin";

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { role } }),
}));

vi.mock("../services/plantHistorian", () => ({
  plantHistorianActions: {
    configureSource: (...args: unknown[]) => configureSource(...args),
    saveMapping: (...args: unknown[]) => saveMapping(...args),
    pull: (...args: unknown[]) => pull(...args),
  },
}));

beforeEach(() => {
  role = "admin";
  vi.clearAllMocks();
  configureSource.mockResolvedValue({
    ok: true,
    note: "Saved disabled. Seed/sim telemetry remains in force until an administrator enables the source.",
  });
  saveMapping.mockResolvedValue({
    ok: true,
    note: "Draft mapping saved. Approve it before a pull can write canonical rows.",
  });
  pull.mockResolvedValue({ dry_run: true, read: 2, accepted: 2, rejected: 0 });
});

describe("PlantHistorianConnectorSetup", () => {
  it("refuses configuration to non-administrators", () => {
    role = "reliability_engineer";
    render(<PlantHistorianConnectorSetup onConfigured={async () => undefined} />);
    expect(
      screen.getByText(/administrator must configure/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(/Connector key/i),
    ).not.toBeInTheDocument();
  });

  it("saves a disabled source without pretending it is live", async () => {
    const onConfigured = vi.fn().mockResolvedValue(undefined);
    render(<PlantHistorianConnectorSetup onConfigured={onConfigured} />);
    fireEvent.change(screen.getByPlaceholderText(/Connector key/i), {
      target: { value: "site-a-pi" },
    });
    fireEvent.change(screen.getByPlaceholderText("Display name"), {
      target: { value: "Site A PI" },
    });
    fireEvent.change(
      screen.getByPlaceholderText(/Configuration\/activation authority/i),
      {
        target: {
          value: "Pilot historian read for Site A, approved by reliability.",
        },
      },
    );
    fireEvent.click(screen.getByText("Save disabled configuration"));
    await waitFor(() =>
      expect(configureSource).toHaveBeenCalledWith(
        expect.objectContaining({
          key: "site-a-pi",
          enabled: false,
          systemKind: "historian",
        }),
      ),
    );
    expect(saveMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorKey: "site-a-pi",
        approve: false,
      }),
    );
    expect(
      await screen.findByText(/Seed\/sim telemetry remains in force/i),
    ).toBeInTheDocument();
    expect(onConfigured).toHaveBeenCalled();
  });

  it("does not offer a live pull until the source is enabled", () => {
    render(<PlantHistorianConnectorSetup onConfigured={async () => undefined} />);
    expect(screen.getByText("Pull readings")).toBeDisabled();
    expect(screen.getByText("Dry-run pull")).toBeDisabled();
  });
});
