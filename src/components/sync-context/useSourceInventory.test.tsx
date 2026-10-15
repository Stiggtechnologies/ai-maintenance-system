import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { contextInventoryFixture } from "../../test/support/syncContextInventoryFixture";
import {
  parseSyncContextSourceInventory,
  type SyncContextSourceInventory,
} from "../../lib/sync-context/source-inventory";
import {
  OperatingSiteScopeContext,
  type OperatingSiteScope,
} from "./OperatingSiteScope";
const { auth, read } = vi.hoisted(() => ({
  auth: { current: {} as Record<string, unknown> },
  read: vi.fn(),
}));
vi.mock("../AuthProvider", () => ({ useAuth: () => auth.current }));
vi.mock("../../services/syncContextService", () => ({
  getSyncContextSourceInventory: read,
}));
import { useSourceInventory } from "./useSourceInventory";
let scope: OperatingSiteScope | null;
const fixture = () =>
  parseSyncContextSourceInventory(contextInventoryFixture());
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <OperatingSiteScopeContext.Provider value={scope}>
      {children}
    </OperatingSiteScopeContext.Provider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  scope = {
    actorId: "actor-a",
    organizationId: fixture().organizationId,
    siteId: null,
    siteName: "All sites",
  };
  auth.current = {
    user: { id: "actor-a" },
    profile: { id: "actor-a", role: "admin" },
    session: { access_token: "ephemeral-a" },
    loading: false,
  };
  read.mockResolvedValue(fixture());
});
describe("ephemeral organization inventory lifetime", () => {
  it("reads without site/tenant/actor parameters and survives a site-only change", async () => {
    const { result, rerender } = renderHook(useSourceInventory, { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(read).toHaveBeenCalledExactlyOnceWith();
    scope = { ...scope!, siteId: "another-site", siteName: "Another site" };
    rerender();
    expect(result.current.status).toBe("ready");
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.current.inventory?.sources[0].state).toBe("not_connected");
  });
  it.each([
    "ai_admin",
    "executive",
    "maintenance_manager",
    "reliability_engineer",
    "planner",
  ])("reuses the existing Context role gate for %s", async (role) => {
    auth.current.profile = { id: "actor-a", role };
    const { result } = renderHook(useSourceInventory, { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });
  it.each([
    { profile: { id: "actor-a", role: "technician" } },
    { profile: { id: "other-actor", role: "admin" } },
    { session: null },
    { user: null },
    { loading: true },
  ])(
    "does not request or display data without matching current authorization %j",
    (change) => {
      auth.current = { ...auth.current, ...change };
      const { result } = renderHook(useSourceInventory, { wrapper });
      expect(result.current.status).toBe("unauthorized");
      expect(result.current.inventory).toBeNull();
      expect(read).not.toHaveBeenCalled();
    },
  );
  it("refuses absent, mismatched or empty canonical organization scope", () => {
    scope = null;
    const { result, rerender } = renderHook(useSourceInventory, { wrapper });
    expect(result.current.status).toBe("unauthorized");
    scope = {
      actorId: "other-actor",
      organizationId: fixture().organizationId,
      siteId: null,
      siteName: "All sites",
    };
    rerender();
    expect(result.current.status).toBe("unauthorized");
    scope = { ...scope, actorId: "actor-a", organizationId: "" };
    rerender();
    expect(read).not.toHaveBeenCalled();
  });
  it("occludes the prior organization immediately and discards its late response", async () => {
    let resolveOld!: (value: SyncContextSourceInventory) => void;
    read.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
    );
    const { result, rerender } = renderHook(useSourceInventory, { wrapper });
    const next = {
      ...fixture(),
      organizationId: "ee020000-0000-4000-8000-000000000099",
      sources: [],
    };
    scope = { ...scope!, organizationId: next.organizationId };
    read.mockResolvedValueOnce(next);
    rerender();
    expect(result.current.inventory).toBeNull();
    await waitFor(() =>
      expect(result.current.inventory?.organizationId).toBe(
        next.organizationId,
      ),
    );
    await act(async () => resolveOld(fixture()));
    expect(result.current.inventory?.organizationId).toBe(next.organizationId);
    expect(result.current.inventory?.sources).toEqual([]);
  });
  it("refresh hides old records immediately and a refused read never becomes empty", async () => {
    const { result } = renderHook(useSourceInventory, { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    read.mockRejectedValueOnce(new Error("private refusal"));
    act(() => result.current.refresh());
    expect(result.current.status).toBe("loading");
    expect(result.current.inventory).toBeNull();
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.inventory).toBeNull();
  });
  it("does not accept an organization response just because its request succeeded", async () => {
    read.mockResolvedValueOnce({
      ...fixture(),
      organizationId: "ee020000-0000-4000-8000-000000000099",
    });
    const { result } = renderHook(useSourceInventory, { wrapper });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.inventory).toBeNull();
  });
  it("session rotation and role revocation synchronously hide prior inventory", async () => {
    const { result, rerender } = renderHook(useSourceInventory, { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    read.mockReturnValueOnce(new Promise(() => {}));
    auth.current.session = { access_token: "ephemeral-b" };
    rerender();
    expect(result.current.status).toBe("loading");
    expect(result.current.inventory).toBeNull();
    auth.current.profile = { id: "actor-a", role: "technician" };
    rerender();
    expect(result.current.status).toBe("unauthorized");
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("refreshes on visible-page return without persisting source data", async () => {
    const local = vi.spyOn(Storage.prototype, "setItem");
    const { result } = renderHook(useSourceInventory, { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(local).not.toHaveBeenCalled();
    local.mockRestore();
  });
});
