import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));
import { getSyncContextOperatingPicture } from "./syncContextService";

const site = "00000000-0000-4000-8000-000000000001";
function empty(
  siteId: string | null = null,
  objectLimit = 250,
  eventLimit = 250,
) {
  return {
    organizationId: "tenant-a",
    generatedAt: "2026-10-10T05:00:00Z",
    operationalAuthority: false,
    sources: [],
    layers: [],
    objects: [],
    events: [],
    scope: { siteId, objectLimit, eventLimit },
    coverage: {
      objects: {
        eligible: 0,
        returned: 0,
        truncated: false,
        draftExcluded: 0,
        expiredExcluded: 0,
        unlinkedExcluded: 0,
        coordinateContractMissing: 0,
        healthBlocked: 0,
        rightsBlocked: 0,
        evidenceBlocked: 0,
        sourceMissing: 0,
        timeBlocked: 0,
        payloadBlocked: 0,
        scopeConflict: 0,
      },
      events: { eligible: 0, returned: 0, truncated: false },
    },
  };
}
beforeEach(() => rpc.mockReset());
describe("SC-02 canonical operating-picture service", () => {
  it("calls the new scoped server projection only and parses a genuine empty result", async () => {
    rpc.mockResolvedValue({ data: empty(site, 30, 0), error: null });
    const result = await getSyncContextOperatingPicture({
      siteId: site,
      objectLimit: 30,
      eventLimit: 0,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "get_sync_context_operating_picture",
      { p_site_id: site, p_object_limit: 30, p_event_limit: 0 },
    );
    expect(result.scope).toEqual({
      siteId: site,
      objectLimit: 30,
      eventLimit: 0,
    });
    expect(result.objects).toEqual([]);
  });
  it("uses explicit bounded defaults for org-wide queries", async () => {
    rpc.mockResolvedValue({ data: empty(), error: null });
    await getSyncContextOperatingPicture();
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "get_sync_context_operating_picture",
      { p_site_id: null, p_object_limit: 250, p_event_limit: 250 },
    );
  });
  it.each([
    { objectLimit: 0 },
    { objectLimit: 501 },
    { objectLimit: 1.5 },
    { eventLimit: -1 },
    { eventLimit: 501 },
    { siteId: "not-a-uuid" },
    { eventLimit: Number.NaN },
  ])(
    "refuses malformed requests before any network call (%j)",
    async (scope) => {
      await expect(getSyncContextOperatingPicture(scope)).rejects.toThrow(
        /scope/i,
      );
      expect(rpc).not.toHaveBeenCalled();
    },
  );
  it.each([
    { error: { message: "private server diagnostics" }, data: null },
    { error: null, data: { error: "private foreign tenant diagnostic" } },
    { error: null, data: null },
  ])(
    "never falls back or fabricates empty data after refusal, transport or malformed output",
    async (response) => {
      rpc.mockResolvedValue(response);
      await expect(getSyncContextOperatingPicture()).rejects.toThrow();
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );
  it("refuses a response for a different scope or silently changed limits", async () => {
    for (const data of [
      empty(null, 30, 0),
      empty(site, 31, 0),
      empty(site, 30, 1),
    ]) {
      rpc.mockResolvedValue({ data, error: null });
      await expect(
        getSyncContextOperatingPicture({
          siteId: site,
          objectLimit: 30,
          eventLimit: 0,
        }),
      ).rejects.toThrow(/scope/i);
    }
  });
});
