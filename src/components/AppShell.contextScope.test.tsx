import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { AppShell } from "./AppShell";
import { useOperatingSiteScope } from "./sync-context/OperatingSiteScope";
import type { UserContext } from "../services/platform";

const {
  auth,
  contextRead,
  sitesRead,
  badgeRead,
  notificationRead,
  authRead,
  profileWrite,
} = vi.hoisted(() => ({
  auth: { current: {} as Record<string, unknown> },
  contextRead: vi.fn(),
  sitesRead: vi.fn(),
  badgeRead: vi.fn(),
  notificationRead: vi.fn(),
  authRead: vi.fn(),
  profileWrite: vi.fn(),
}));
vi.mock("./AuthProvider", () => ({ useAuth: () => auth.current }));
vi.mock("../lib/useMediaQuery", () => ({ useMediaQuery: () => true }));
vi.mock("../services/uiEvents", () => ({ trackUiEvent: vi.fn() }));
vi.mock("./CopilotDock", () => ({ CopilotDock: () => null }));
vi.mock("./PresenceWelcome", () => ({ PresenceWelcome: () => null }));
vi.mock("../services/platform", () => ({
  platformService: { getCurrentUserContext: contextRead, signOut: vi.fn() },
}));
vi.mock("../services/operatingLoopService", () => ({
  getNotifications: notificationRead,
  markNotificationRead: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: { getUser: authRead },
    from: (table: string) => ({
      update: (value: unknown) => ({
        eq: (field: string, id: string) =>
          profileWrite(table, value, field, id),
      }),
      select: () => ({
        eq: (_field: string, org: string) =>
          table === "sites"
            ? { order: () => sitesRead(org) }
            : badgeRead(table),
        in: () => badgeRead(table),
      }),
    }),
  },
}));

function context(
  actor = "actor-a",
  org = "org-a",
  site: string | null = null,
): UserContext {
  return {
    user_id: actor,
    organization_id: org,
    default_site_id: site,
    organization_name: org,
    email: "synthetic@example.invalid",
    full_name: null,
    roles: [],
    permissions: [],
  };
}
function Probe() {
  const scope = useOperatingSiteScope();
  return <output data-testid="scope">{JSON.stringify(scope)}</output>;
}
function tree() {
  return (
    <AppShell currentPath="/context" onNavigate={vi.fn()}>
      <Probe />
    </AppShell>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("__BUILD_SHA__", "synthetic-test");
  auth.current = {
    user: { id: "actor-a" },
    profile: { id: "actor-a", role: "admin", organization_id: "org-a" },
  };
  contextRead.mockResolvedValue(context());
  sitesRead.mockResolvedValue({
    data: [{ id: "site-a", name: "Synthetic Site A", code: "A" }],
  });
  badgeRead.mockResolvedValue({ count: 0 });
  notificationRead.mockResolvedValue([]);
  authRead.mockResolvedValue({ data: { user: null } });
  profileWrite.mockResolvedValue({ error: null });
});
describe("AppShell owns the one live Context site scope", () => {
  it("never writes an old selected site into a new actor's profile after a delayed auth read", async () => {
    let resolveAuth!: (v: { data: { user: { id: string } } }) => void;
    authRead.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAuth = resolve;
        }),
    );
    const rendered = render(tree());
    fireEvent.click(await screen.findByRole("button", { name: /All Sites/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Synthetic Site A/ }),
    );
    expect(authRead).toHaveBeenCalledTimes(1);
    auth.current = {
      user: { id: "actor-b" },
      profile: { id: "actor-b", role: "admin", organization_id: "org-b" },
    };
    contextRead.mockResolvedValueOnce(context("actor-b", "org-b"));
    rendered.rerender(tree());
    await waitFor(() =>
      expect(screen.getByTestId("scope")).toHaveTextContent("org-b"),
    );
    await act(async () => resolveAuth({ data: { user: { id: "actor-b" } } }));
    expect(profileWrite).not.toHaveBeenCalled();
  });
  it("occludes old notification content and drops old-tenant late notification and badge reads", async () => {
    let resolveNotifications!: (value: unknown[]) => void;
    let resolveBadges!: (value: { count: number }) => void;
    badgeRead.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveBadges = resolve;
        }),
    );
    notificationRead.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveNotifications = resolve;
        }),
    );
    const rendered = render(tree());
    await waitFor(() =>
      expect(screen.getByTestId("scope")).toHaveTextContent("org-a"),
    );
    fireEvent.click(
      within(screen.getByRole("banner")).getByRole("button", {
        name: "Notifications",
      }),
    );
    expect(notificationRead).toHaveBeenCalledTimes(1);
    auth.current = {
      user: { id: "actor-b" },
      profile: { id: "actor-b", role: "admin", organization_id: "org-b" },
    };
    contextRead.mockResolvedValueOnce(context("actor-b", "org-b"));
    rendered.rerender(tree());
    await waitFor(() =>
      expect(screen.getByTestId("scope")).toHaveTextContent("org-b"),
    );
    await act(async () => {
      resolveNotifications([
        {
          id: "secret",
          title: "Old tenant confidential title",
          message: "Old tenant content",
          read: false,
          created_at: "2026-10-10T01:00:00Z",
        },
      ]);
      resolveBadges({ count: 55555 });
    });
    fireEvent.click(
      within(screen.getByRole("banner")).getByRole("button", {
        name: "Notifications",
      }),
    );
    await waitFor(() => expect(notificationRead).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByText("Old tenant confidential title"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("55555")).not.toBeInTheDocument();
  });
  it("passes the authenticated canonical organization and selected site, not fallback roles", async () => {
    contextRead.mockResolvedValue(context("actor-a", "org-a", "site-a"));
    render(tree());
    await waitFor(() =>
      expect(screen.getByTestId("scope")).toHaveTextContent(
        '"siteId":"site-a"',
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("scope")).toHaveTextContent(
        '"siteName":"Synthetic Site A"',
      ),
    );
    expect(sitesRead).toHaveBeenCalledWith("org-a");
  });
  it("occludes the scope immediately for a new actor and rejects a previous actor's late context", async () => {
    let resolveOld!: (v: UserContext) => void;
    contextRead.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const rendered = render(tree());
    auth.current = {
      user: { id: "actor-b" },
      profile: { id: "actor-b", role: "admin", organization_id: "org-b" },
    };
    contextRead.mockResolvedValueOnce(context("actor-b", "org-b"));
    rendered.rerender(tree());
    expect(screen.getByTestId("scope")).toHaveTextContent("null");
    await waitFor(() =>
      expect(screen.getByTestId("scope")).toHaveTextContent(
        '"organizationId":"org-b"',
      ),
    );
    await act(async () => resolveOld(context()));
    expect(screen.getByTestId("scope")).not.toHaveTextContent("org-a");
  });
  it("rejects late site names from a previous organization even for the same actor", async () => {
    let resolveOld!: (v: {
      data: { id: string; name: string; code: string }[];
    }) => void;
    sitesRead.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const rendered = render(tree());
    await waitFor(() => expect(sitesRead).toHaveBeenCalledWith("org-a"));
    auth.current = {
      user: { id: "actor-a" },
      profile: { id: "actor-a", role: "admin", organization_id: "org-b" },
    };
    contextRead.mockResolvedValueOnce(context("actor-a", "org-b", "site-b"));
    sitesRead.mockResolvedValueOnce({
      data: [{ id: "site-b", name: "New organization site", code: "B" }],
    });
    rendered.rerender(tree());
    expect(screen.getByTestId("scope")).toHaveTextContent("null");
    await waitFor(() =>
      expect(screen.getByTestId("scope")).toHaveTextContent(
        "New organization site",
      ),
    );
    await act(async () =>
      resolveOld({
        data: [{ id: "site-b", name: "Old tenant secret name", code: "X" }],
      }),
    );
    expect(screen.getByTestId("scope")).not.toHaveTextContent("Old tenant");
    expect(screen.getByTestId("scope")).toHaveTextContent(
      "New organization site",
    );
  });
  it("fails closed for mismatched profile/context tenants or a failed context read", async () => {
    contextRead.mockResolvedValueOnce(context("actor-a", "foreign-org"));
    const rendered = render(tree());
    await waitFor(() => expect(contextRead).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("scope")).toHaveTextContent("null");
    auth.current = {
      user: { id: "actor-b" },
      profile: { id: "actor-b", role: "admin", organization_id: "org-b" },
    };
    contextRead.mockRejectedValueOnce(new Error("refused"));
    rendered.rerender(tree());
    await waitFor(() => expect(contextRead).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("scope")).toHaveTextContent("null");
  });
  it("uses the existing global selector to change Context scope", async () => {
    render(tree());
    await waitFor(() =>
      expect(screen.getByTestId("scope")).toHaveTextContent("org-a"),
    );
    fireEvent.click(await screen.findByRole("button", { name: /All Sites/i }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Synthetic Site A/ }),
    );
    expect(screen.getByTestId("scope")).toHaveTextContent('"siteId":"site-a"');
  });
});
