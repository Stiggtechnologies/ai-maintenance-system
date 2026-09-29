import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attestProjectCaStage,
  getProjectCaVerification,
  startProjectCaVerification,
} from "./developService";

const rpc = vi.hoisted(() => vi.fn());
const query = vi.hoisted(() => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({ supabase: { rpc, from: () => query } }));
beforeEach(() => rpc.mockReset());
describe("project closure service receipts", () => {
  it("loads only the requested canonical lesson closure", async () => {
    query.maybeSingle.mockResolvedValue({ data: { id: "v" }, error: null });
    await expect(getProjectCaVerification("lesson")).resolves.toMatchObject({
      id: "v",
    });
    expect(query.eq).toHaveBeenCalledWith("project_lesson_id", "lesson");
  });
  it("does not report read failure as absent closure", async () => {
    query.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: "Unavailable" },
    });
    await expect(getProjectCaVerification("lesson")).rejects.toThrow(
      "Unavailable",
    );
  });
  it("preserves the lesson and basis on start", async () => {
    rpc.mockResolvedValue({
      data: { id: "v", status: "open", detail: "Unverified" },
      error: null,
    });
    await expect(
      startProjectCaVerification("lesson", "Source review"),
    ).resolves.toMatchObject({ status: "open" });
    expect(rpc).toHaveBeenCalledWith("start_project_ca_verification", {
      p_lesson_id: "lesson",
      p_basis: "Source review",
    });
  });
  it.each([null, {}, { error: "Forbidden" }])(
    "refuses missing or rejected receipts: %j",
    async (data) => {
      rpc.mockResolvedValue({ data, error: null });
      await expect(
        startProjectCaVerification("lesson", "basis"),
      ).rejects.toThrow();
    },
  );
  it("does not accept a different stage receipt", async () => {
    rpc.mockResolvedValue({
      data: { ok: true, stage: "causal", detail: "Recorded" },
      error: null,
    });
    await expect(
      attestProjectCaStage({
        verificationId: "v",
        stage: "implementation",
        note: "Observed",
        evidenceId: "e",
      }),
    ).rejects.toThrow("matching receipt");
  });
  it("surfaces transport errors", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Unavailable" } });
    await expect(startProjectCaVerification("lesson", "basis")).rejects.toThrow(
      "Unavailable",
    );
  });
});
