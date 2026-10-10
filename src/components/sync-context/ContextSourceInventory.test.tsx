import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { contextInventoryFixture } from "../../test/support/syncContextInventoryFixture";
import { parseSyncContextSourceInventory } from "../../lib/sync-context/source-inventory";
import { ContextSourceInventory } from "./ContextSourceInventory";
const fixture = () =>
  parseSyncContextSourceInventory(contextInventoryFixture());
describe("honest organization-wide source inventory", () => {
  it("makes unused disconnected feeds discoverable without claiming coverage or a successful check", () => {
    render(
      <ContextSourceInventory
        status="ready"
        inventory={fixture()}
        refresh={vi.fn()}
      />,
    );
    const panel = screen.getByRole("region", {
      name: "Organization source inventory",
    });
    expect(
      within(panel).getByText("Synthetic disconnected source"),
    ).toBeVisible();
    expect(panel).toHaveTextContent("not_connected");
    expect(panel).toHaveTextContent("not selected-site coverage");
    expect(panel).toHaveTextContent(
      "Unknown — no governed coverage measurement",
    );
    expect(panel).toHaveTextContent("Unknown — no transport-success receipt");
    expect(panel).toHaveTextContent("60 seconds at inventory snapshot");
    expect(panel).toHaveTextContent("Unknown — not supplied; not zero");
    expect(panel).toHaveTextContent("No — not eligible to emit");
    expect(panel).toHaveTextContent("No operational authority");
  });
  it("shows a real empty classified registry without inventing no-feed or complete coverage claims", () => {
    render(
      <ContextSourceInventory
        status="ready"
        inventory={{ ...fixture(), sources: [] }}
        refresh={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/No classified sources returned/),
    ).toHaveTextContent("not proof that no other integrations exist");
  });
  it.each(["loading", "unauthorized", "error"] as const)(
    "never renders prior inventory during %s",
    (status) => {
      const refresh = vi.fn();
      render(
        <ContextSourceInventory
          status={status}
          inventory={fixture()}
          refresh={refresh}
        />,
      );
      expect(
        screen.queryByText("Synthetic disconnected source"),
      ).not.toBeInTheDocument();
      if (status === "error") {
        expect(screen.getByRole("alert")).toHaveTextContent(
          "Unavailable is not an empty registry",
        );
        fireEvent.click(
          screen.getByRole("button", { name: "Retry source inventory" }),
        );
        expect(refresh).toHaveBeenCalledTimes(1);
      }
    },
  );
  it("renders null clock and enablement facts as unknown, never zero or active", () => {
    const inventory = fixture();
    Object.assign(inventory.sources[0], {
      checkedAt: null,
      checkAgeSeconds: null,
      enabled: null,
      registryStatus: null,
    });
    render(
      <ContextSourceInventory
        status="ready"
        inventory={inventory}
        refresh={vi.fn()}
      />,
    );
    expect(
      screen.getAllByText("Unknown — not supplied; not zero"),
    ).toHaveLength(2);
    expect(
      screen.getByText("Registry enablement / status").nextElementSibling,
    ).toHaveTextContent(
      "Unknown — not supplied · Unknown — not supplied; not active",
    );
    expect(
      screen.getByText("Source observation / age").nextElementSibling,
    ).toHaveTextContent("Unknown — not supplied; not zero");
  });
});
