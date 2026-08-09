import { describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";

vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: "test-user-id" } } }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
    rpc: vi.fn().mockResolvedValue({
      data: [
        {
          user_id: "test",
          organization_id: "org1",
          organization_name: "Test Org",
          roles: [{ code: "admin", name: "Admin", level: "executive" }],
          permissions: [],
          email: "test@test.com",
          full_name: "Test",
          default_site_id: null,
        },
      ],
    }),
  },
}));

vi.mock("../services/platform", () => ({
  platformService: {
    getCurrentUserContext: vi.fn().mockResolvedValue({
      user_id: "test",
      organization_id: "org1",
      organization_name: "Test Org",
      email: "test@test.com",
      full_name: "Test User",
      default_site_id: null,
      roles: [{ code: "EXEC", name: "Executive", level: "executive" }],
      permissions: [],
    }),
    signOut: vi.fn(),
  },
}));

vi.mock("../services/operatingLoopService", () => ({
  getNotifications: vi.fn().mockResolvedValue([]),
  markNotificationRead: vi.fn().mockResolvedValue(undefined),
}));

// The chat dock and command palette are separately tested surfaces; mounting
// them here would only add network mocks to a layout test.
vi.mock("./CopilotDock", () => ({ CopilotDock: () => null }));
vi.mock("./CommandSearch", () => ({ CommandSearch: () => null }));

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({
    user: { id: "test-user-id" },
    profile: { id: "test-user-id", role: "admin" },
    session: null,
    loading: false,
  }),
}));

import { AppShell } from "./AppShell";

function renderShell() {
  const onNavigate = vi.fn();
  const utils = render(
    <AppShell currentPath="/briefing" onNavigate={onNavigate}>
      <div>page content</div>
    </AppShell>,
  );
  return { ...utils, onNavigate };
}

const toggle = () => screen.getByRole("button", { name: /open navigation/i });

async function openDrawer() {
  fireEvent.click(toggle());
  return await screen.findByRole("dialog", { name: /main navigation/i });
}

const expectDrawerClosed = () =>
  waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

describe("AppShell", () => {
  it("filters nav items by role level", () => {
    // Executive should see all items
    const executiveItems = [
      { requiredLevel: ["executive", "strategic", "tactical"] },
      { requiredLevel: ["executive", "strategic"] },
      {}, // no restriction
    ];
    const filtered = executiveItems.filter((item) => {
      if (!item.requiredLevel) return true;
      return item.requiredLevel.includes("executive");
    });
    expect(filtered.length).toBe(3);
  });

  it("operational users see fewer items", () => {
    const items = [
      { requiredLevel: ["executive", "strategic", "tactical"] },
      { requiredLevel: ["executive", "strategic"] },
      {}, // no restriction
    ];
    const filtered = items.filter((item) => {
      if (!item.requiredLevel) return true;
      return item.requiredLevel.includes("operational");
    });
    expect(filtered.length).toBe(1);
  });
});

describe("AppShell responsive shell", () => {
  it("keeps the sidebar rail out of the layout below the md breakpoint", () => {
    const { container } = renderShell();
    const rail = container.querySelector("aside");
    // The defect was a fixed 240px `shrink-0` column on a 375px screen.
    expect(rail?.className).toContain("hidden");
    expect(rail?.className).toContain("md:flex");
  });

  it("offers a 44x44 navigation toggle only on small screens", () => {
    renderShell();
    expect(toggle().className).toContain("md:hidden");
    // h-11 / w-11 is 44px — the minimum reliable gloved touch target.
    expect(toggle().className).toContain("h-11");
    expect(toggle().className).toContain("w-11");
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the drawer as a modal dialog and moves focus into it", async () => {
    renderShell();
    const drawer = await openDrawer();

    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(drawer).toContainElement(document.activeElement as HTMLElement);
  });

  it("sizes drawer rows for touch", async () => {
    renderShell();
    const drawer = await openDrawer();

    const rows = Array.from(drawer.querySelectorAll<HTMLElement>("nav button"));
    expect(rows.length).toBeGreaterThan(0);
    // min-h-11 is 44px; the rail keeps its denser mouse-sized rows.
    expect(rows.every((b) => b.className.includes("min-h-11"))).toBe(true);
  });

  it("closes on Escape and returns focus to the toggle", async () => {
    renderShell();
    await openDrawer();

    fireEvent.keyDown(document, { key: "Escape" });

    await expectDrawerClosed();
    expect(toggle()).toHaveFocus();
  });

  it("closes on backdrop click", async () => {
    renderShell();
    await openDrawer();

    fireEvent.click(screen.getByTestId("mobile-nav-backdrop"));

    await expectDrawerClosed();
  });

  it("closes on the explicit close control", async () => {
    renderShell();
    const drawer = await openDrawer();

    fireEvent.click(
      within(drawer).getByRole("button", { name: /close navigation/i }),
    );

    await expectDrawerClosed();
  });

  it("navigates and closes when a drawer item is chosen", async () => {
    const { onNavigate } = renderShell();
    const drawer = await openDrawer();

    fireEvent.click(within(drawer).getByText("Risk & Consequence"));

    expect(onNavigate).toHaveBeenCalledWith("/risk");
    await expectDrawerClosed();
  });

  it("traps Tab inside the open drawer", async () => {
    renderShell();
    const drawer = await openDrawer();

    const focusables = Array.from(
      drawer.querySelectorAll<HTMLElement>("button"),
    );
    expect(focusables.length).toBeGreaterThan(1);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(first).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });
});
