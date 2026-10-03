import { beforeEach, expect, it, vi } from "vitest";
import { listOrgEvidenceItems } from "./developService";
const query = vi.hoisted(() => ({
  select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
  ilike: vi.fn().mockReturnThis(), data: [], error: null as null | { message: string },
}));
const from = vi.hoisted(() => vi.fn());
vi.mock("../lib/supabase", () => ({ supabase: { from } }));
beforeEach(() => { vi.clearAllMocks(); query.error = null; from.mockReturnValue(query); });
it("uses an exact UUID filter on the canonical evidence table", async () => {
  const id = "98551000-0000-4000-8000-000000000001";
  await listOrgEvidenceItems(` ${id} `);
  expect(from).toHaveBeenCalledWith("evidence_items");
  expect(query.eq).toHaveBeenCalledWith("id", id);
  expect(query.ilike).not.toHaveBeenCalled();
});
it("escapes literal description wildcard characters", async () => {
  await listOrgEvidenceItems("95% flush_record");
  expect(query.ilike).toHaveBeenCalledWith("description", "%95\\% flush\\_record%");
  expect(query.eq).not.toHaveBeenCalled();
});
it("keeps the existing recent-items query for blank searches", async () => {
  await listOrgEvidenceItems(" ");
  expect(query.order).toHaveBeenCalledWith("created_at", { ascending: false });
  expect(query.limit).toHaveBeenCalledWith(200);
  expect(query.eq).not.toHaveBeenCalled();
  expect(query.ilike).not.toHaveBeenCalled();
});
it("propagates read failure instead of an empty evidence set", async () => {
  query.error = { message: "Read denied" };
  await expect(listOrgEvidenceItems("older source")).rejects.toThrow("Read denied");
});
