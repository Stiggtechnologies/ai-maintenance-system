import { beforeEach, describe, expect, it, vi } from "vitest";
import { listServiceLevelAssets, listAssetServiceLevels, listServiceLevelEvidence, verifyAssetServiceLevel, reconcileAssetServiceLevelCommand, ServiceLevelRefusal } from "./assetServiceLevelService";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../lib/supabase", () => ({ supabase: { rpc } }));
const scope = { actorId: "33333333-3333-4333-8333-333333333333", organizationId: "44444444-4444-4444-8444-444444444444" };
const assetId = "11111111-1111-4111-8111-111111111111";
const commandId = "55555555-5555-4555-8555-555555555555";
const request = { p_asset_id: assetId, p_expected_version: 1, p_review_note: "Named independent review", p_command_id: commandId, p_observed_actor_id: scope.actorId, p_observed_organization_id: scope.organizationId };
const receipt = { command_id: commandId, actor_id: scope.actorId, organization_id: scope.organizationId, asset_id: assetId, version: 2, status: "verified", operation: "verify", outcome: "committed", request };

describe("observed-context service consequence SDK", () => {
  beforeEach(() => rpc.mockReset());
  it.each([{}, [], null, { ...receipt, command_id: "wrong" }, { ...receipt, actor_id: "wrong" }, { ...receipt, organization_id: "wrong" }, { ...receipt, asset_id: "wrong" }, { ...receipt, version: 1 }, { ...receipt, version: 2.1 }, { ...receipt, version: "2" }, { ...receipt, status: "draft" }, { ...receipt, status: false }, { ...receipt, operation: "record" }])("rejects missing, malformed or incorrectly bound acknowledgement %j as uncertain", async value => {
    rpc.mockResolvedValue({ data: value, error: null });
    await expect(verifyAssetServiceLevel(assetId, 1, "Named independent review", commandId, scope)).rejects.toThrow();
  });
  it("accepts only the exact complete write receipt", async () => {
    rpc.mockResolvedValue({ data: receipt, error: null });
    await expect(verifyAssetServiceLevel(assetId, 1, "Named independent review", commandId, scope)).resolves.toEqual(receipt);
  });
  it.each([{ error: "command already recorded; reconcile" }, { error: "state changed since review began" }, { outcome: "unknown", command_id: commandId, actor_id: scope.actorId, organization_id: scope.organizationId }])("does not misclassify ambiguous duplicate or stale command outcome %j as proven refusal", async value => {
    rpc.mockResolvedValue({ data: value, error: null });
    const failure = await verifyAssetServiceLevel(assetId, 1, "Named independent review", commandId, scope).catch(cause => cause);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ServiceLevelRefusal);
  });
  it("recognizes only an exact context-bound explicit no-write refusal", async () => {
    rpc.mockResolvedValue({ data: { outcome: "refused", error: "Independent human review required", command_id: commandId, actor_id: scope.actorId, organization_id: scope.organizationId }, error: null });
    await expect(verifyAssetServiceLevel(assetId, 1, "Named independent review", commandId, scope)).rejects.toBeInstanceOf(ServiceLevelRefusal);
  });
  it.each(["assets", "levels", "evidence"])("bounds %s read server-side to the observed actor and organization", async section => {
    rpc.mockResolvedValue({ data: { actor_id: scope.actorId, organization_id: scope.organizationId, section, rows: [] }, error: null });
    if (section === "assets") await listServiceLevelAssets(scope);
    else if (section === "levels") await listAssetServiceLevels(scope);
    else await listServiceLevelEvidence(assetId, scope);
    expect(rpc).toHaveBeenCalledWith("get_asset_service_level_editor", expect.objectContaining({ p_section: section, p_observed_actor_id: scope.actorId, p_observed_organization_id: scope.organizationId }));
  });
  it("rejects an otherwise valid read envelope from a stale JWT identity", async () => {
    rpc.mockResolvedValue({ data: { actor_id: "different JWT actor", organization_id: scope.organizationId, section: "assets", rows: [] }, error: null });
    await expect(listServiceLevelAssets(scope)).rejects.toThrow();
  });
  it("bounds reconciliation and rejects a wrong-asset committed receipt without replay", async () => {
    rpc.mockResolvedValue({ data: { ...receipt, asset_id: "wrong" }, error: null });
    await expect(reconcileAssetServiceLevelCommand(commandId, scope, { assetId, version: 2, status: "verified", operation: "verify", request })).rejects.toThrow();
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("get_asset_service_level_command", { p_command_id: commandId, p_observed_actor_id: scope.actorId, p_observed_organization_id: scope.organizationId });
  });
  it("never confirms altered review content against an original same-command receipt", async () => {
    rpc.mockResolvedValue({ data: receipt, error: null });
    await expect(reconcileAssetServiceLevelCommand(commandId, scope, { assetId, version: 2, status: "verified", operation: "verify", request: { ...request, p_review_note: "Changed attempted review" } })).rejects.toThrow(/original request identity/);
  });
});
