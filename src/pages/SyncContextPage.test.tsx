import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { contextOperatingFixture } from "../test/support/syncContextOperatingFixture";
import {
  OperatingSiteScopeContext,
  type OperatingSiteScope,
} from "../components/sync-context/OperatingSiteScope";
const { auth, read } = vi.hoisted(() => ({
  auth: { current: {} as Record<string, unknown> },
  read: vi.fn(),
}));
vi.mock("../components/AuthProvider", () => ({ useAuth: () => auth.current }));
vi.mock("../services/syncContextService", () => ({
  getSyncContextOperatingPicture: read,
}));
import { SyncContextPage } from "./SyncContextPage";
import { contextViewKey } from "../lib/sync-context/view-preferences";
const base = {
  actorId: "actor-a",
  organizationId: "org-a",
  siteId: null,
  siteName: "All sites",
};
function tree(scope: OperatingSiteScope | null = base) {
  return (
    <MemoryRouter>
      <OperatingSiteScopeContext.Provider value={scope}>
        <SyncContextPage />
      </OperatingSiteScopeContext.Provider>
    </MemoryRouter>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  auth.current = {
    user: { id: "actor-a" },
    profile: { id: "actor-a", role: "admin" },
    session: { access_token: "ephemeral-a" },
    loading: false,
  };
  read.mockResolvedValue(contextOperatingFixture());
});
describe("governed customer-reachable Context workspace", () => {
  it("renders genuine query coverage, shape inspector and only exact canonical links", async () => {
    render(tree());
    expect(
      await screen.findByRole("group", { name: "Authorized source geometry" }),
    ).toBeInTheDocument();
    expect(read).toHaveBeenCalledWith({ siteId: null });
    fireEvent.click(
      screen.getByRole("button", { name: "Inspect Synthetic Pump A" }),
    );
    const inspector = screen.getByRole("complementary", {
      name: "Selected object inspector",
    });
    expect(
      within(inspector).getByText("Unknown — not supplied; not zero"),
    ).toBeInTheDocument();
    expect(
      within(inspector).getByRole("link", { name: "Open Asset" }),
    ).toHaveAttribute("href", "/assets/ee020000-0000-4000-8000-000000000111");
    expect(
      within(inspector).queryByRole("link", { name: /decision/i }),
    ).not.toBeInTheDocument();
    expect(
      within(inspector).getByText(/PoF\/RUL.*unavailable/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no basemap or survey certification/),
    ).toBeInTheDocument();
  });
  it("uses source/layer filters only for display and does not rewrite server counts", async () => {
    render(tree());
    await screen.findByRole("group", { name: "Authorized source geometry" });
    fireEvent.change(screen.getByLabelText("Source display filter"), {
      target: { value: "simulated_industrial" },
    });
    expect(
      screen.queryByRole("button", { name: "Inspect Synthetic Pump A" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Query coverage" }),
    ).toHaveTextContent("1 / 0");
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("hides prior geometry immediately on refresh and keeps it hidden after revocation refusal", async () => {
    render(tree());
    await screen.findByRole("group", { name: "Authorized source geometry" });
    read.mockRejectedValue(new Error("rights revoked"));
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh authorized data" }),
    );
    expect(
      screen.queryByRole("group", { name: "Authorized source geometry" }),
    ).not.toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Context is unavailable",
    );
    expect(screen.queryByText("Synthetic Pump A")).not.toBeInTheDocument();
  });
  it("rejects late site responses and never renders data for the previous site", async () => {
    let resolveOld!: (v: ReturnType<typeof contextOperatingFixture>) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const rendered = render(tree());
    read.mockResolvedValueOnce(contextOperatingFixture("site-b"));
    rendered.rerender(tree({ ...base, siteId: "site-b", siteName: "Site B" }));
    await screen.findByRole("group", { name: "Authorized source geometry" });
    const old = contextOperatingFixture();
    old.objects[0].name = "Previous secret site";
    await act(async () => resolveOld(old));
    expect(screen.queryByText("Previous secret site")).not.toBeInTheDocument();
    expect(screen.getByText("Site B")).toBeInTheDocument();
  });
  it("occludes old geometry on actor/session mismatch and refuses cross-tenant responses", async () => {
    const rendered = render(tree());
    await screen.findByRole("group", { name: "Authorized source geometry" });
    auth.current = {
      ...auth.current,
      user: { id: "actor-b" },
      session: { access_token: "ephemeral-b" },
    };
    rendered.rerender(tree());
    expect(
      screen.queryByRole("group", { name: "Authorized source geometry" }),
    ).not.toBeInTheDocument();
    auth.current = {
      user: { id: "actor-b" },
      profile: { id: "actor-b", role: "admin" },
      session: { access_token: "ephemeral-b" },
      loading: false,
    };
    read.mockResolvedValue(contextOperatingFixture());
    rendered.rerender(
      tree({ ...base, actorId: "actor-b", organizationId: "org-b" }),
    );
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
  it("restores only metadata after a fresh read, never a saved evidence snapshot", async () => {
    const rendered = render(tree());
    await screen.findByRole("group", { name: "Authorized source geometry" });
    fireEvent.click(
      screen.getByRole("button", { name: "Inspect Synthetic Pump A" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "World" }));
    const saved = sessionStorage.getItem(contextViewKey(base));
    expect(saved).not.toBeNull();
    expect(JSON.parse(saved!)).toEqual({
      version: 1,
      selectedId: "feature-a",
      sourceClass: "all",
      hiddenLayers: [],
      viewport: { x: 0, y: 0, width: 1000, height: 500 },
    });
    expect(saved).not.toMatch(/ephemeral|evidence-a|Synthetic Pump/);
    rendered.unmount();
    render(tree());
    await screen.findByRole("complementary", {
      name: "Selected object inspector",
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(
      screen.getByRole("group", { name: "Authorized source geometry" }),
    ).toHaveAttribute("viewBox", "0 0 1000 500");
  });
  it("refuses a response with the wrong echoed site even in the same tenant", async () => {
    read.mockResolvedValue(contextOperatingFixture("site-b"));
    render(tree());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Context is unavailable",
    );
    expect(screen.queryByText("Synthetic Pump A")).not.toBeInTheDocument();
  });
  it("never constructs canonical links from merely 36-character hyphen/hex strings", async () => {
    const picture = contextOperatingFixture();
    picture.objects[0].subjects[0].id = "------------------------------------";
    read.mockResolvedValue(picture);
    render(tree());
    fireEvent.click(
      await screen.findByRole("button", { name: "Inspect Synthetic Pump A" }),
    );
    expect(
      screen.queryByRole("link", { name: "Open Asset" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/EPSG:4326 · GeoJSON longitude, latitude/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("main")).not.toBeInTheDocument();
  });
  it("keeps refused antimeridian geometry in the list without claiming it was drawn", async () => {
    const picture = contextOperatingFixture();
    picture.objects[0].geometry = {
      type: "LineString",
      coordinates: [
        [179, 0],
        [-179, 0],
      ],
    };
    picture.objects[0].geometryType = "LineString";
    read.mockResolvedValue(picture);
    render(tree());
    await screen.findByRole("group", { name: "Authorized source geometry" });
    expect(
      screen.getByText(/0 drawn shapes · 1 refused shapes/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Uncut antimeridian geometry/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Synthetic Pump A/ }));
    expect(
      screen.getByRole("complementary", { name: "Selected object inspector" }),
    ).toBeInTheDocument();
  });
  it("selects the last target when Previous is used without a selection", async () => {
    const picture = contextOperatingFixture();
    picture.objects.push({
      ...picture.objects[0],
      id: "feature-b",
      name: "Synthetic Pump B",
    });
    picture.coverage.objects.eligible = picture.coverage.objects.returned = 2;
    picture.layers[0].recordCount =
      picture.layers[0].candidateCount =
      picture.layers[0].eligibleCount =
        2;
    read.mockResolvedValue(picture);
    render(tree());
    await screen.findByRole("group", { name: "Authorized source geometry" });
    fireEvent.click(screen.getByRole("button", { name: "Previous target" }));
    expect(
      within(
        screen.getByRole("complementary", {
          name: "Selected object inspector",
        }),
      ).getByRole("heading", { name: "Synthetic Pump B" }),
    ).toBeInTheDocument();
  });
  it("refreshes on visibility resume and rejects the previous session's late read", async () => {
    const rendered = render(tree());
    await screen.findByRole("group", { name: "Authorized source geometry" });
    let resolveOld!: (v: ReturnType<typeof contextOperatingFixture>) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    fireEvent(document, new Event("visibilitychange"));
    expect(
      screen.queryByRole("group", { name: "Authorized source geometry" }),
    ).not.toBeInTheDocument();
    auth.current = {
      ...auth.current,
      session: { access_token: "rotated-session" },
    };
    const fresh = contextOperatingFixture();
    fresh.objects[0].name = "Fresh session only";
    read.mockResolvedValueOnce(fresh);
    rendered.rerender(tree());
    await screen.findByRole("button", { name: "Inspect Fresh session only" });
    const stale = contextOperatingFixture();
    stale.objects[0].name = "Old session secret";
    await act(async () => resolveOld(stale));
    expect(screen.queryByText("Old session secret")).not.toBeInTheDocument();
    expect(read).toHaveBeenCalledTimes(3);
  });
  it.each(["technician", "operator", "supervisor", "board", "unknown"])(
    "redirects %s without making a Context request",
    async (role) => {
      auth.current = { ...auth.current, profile: { id: "actor-a", role } };
      render(tree());
      await waitFor(() => expect(read).not.toHaveBeenCalled());
      expect(
        screen.queryByRole("region", { name: "Sync Context workspace" }),
      ).not.toBeInTheDocument();
    },
  );
});
