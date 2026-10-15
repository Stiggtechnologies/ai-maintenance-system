import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));
import { getSyncContextSourceInventory } from "./syncContextService";
import { contextInventoryFixture } from "../test/support/syncContextInventoryFixture";
beforeEach(() => rpc.mockReset());
describe("parameterless canonical source inventory read", () => {
  it("makes one read, accepts disconnected sources and supplies no tenant/site/actor", async () => {
    rpc.mockResolvedValue({ data: contextInventoryFixture(), error: null });
    expect((await getSyncContextSourceInventory()).sources).toHaveLength(1);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "get_sync_context_source_inventory",
    );
  });
  it.each([
    { data: null, error: { message: "private diagnostic" } },
    { data: { error: "private refusal" }, error: null },
    { data: null, error: null },
    { data: { ...contextInventoryFixture(), complete: false }, error: null },
  ])(
    "never falls back to operating data or fabricates empty inventory %j",
    async (response) => {
      rpc.mockResolvedValue(response);
      await expect(getSyncContextSourceInventory()).rejects.toThrow();
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );
});
