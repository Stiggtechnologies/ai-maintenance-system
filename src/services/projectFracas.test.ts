import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attestProjectCaStage,
  getProjectCaVerification,
  requestProjectStandardRevision,
  decideProjectStandardRevision,
  screenProjectCaExposure,
  registerStandardWorkBaseline,
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
  it("passes baseline evidence and preserves the verified-registration boundary", async () => {
    rpc.mockResolvedValue({
      data: { standardWorkId: 1, status: "human_verified" },
      error: null,
    });
    await expect(
      registerStandardWorkBaseline({
        workKey: "estimate",
        title: "Estimate",
        language: "en",
        content: "Original procedure",
        basis: "Controlled document",
        evidenceId: "e",
      }),
    ).resolves.toMatchObject({ standardWorkId: 1 });
    expect(rpc).toHaveBeenCalledWith(
      "register_standard_work_baseline",
      expect.objectContaining({
        p_evidence_id: "e",
        p_content: "Original procedure",
      }),
    );
  });
  it("does not present a pending revision as adopted", async () => {
    rpc.mockResolvedValue({
      data: { revisionId: 2, approvalId: "a", status: "draft" },
      error: null,
    });
    await expect(
      requestProjectStandardRevision({
        verificationId: "v",
        previousId: 1,
        language: "en",
        content: "Changed",
        changeSummary: "Review added",
        basis: "Evidence",
      }),
    ).resolves.toMatchObject({ status: "draft" });
  });
  it("refuses a decision response for another revision", async () => {
    rpc.mockResolvedValue({
      data: { revisionId: 3, status: "approved", detail: "Done" },
      error: null,
    });
    await expect(
      decideProjectStandardRevision(2, "approved", "Reviewed"),
    ).rejects.toThrow("matching receipt");
  });
  it("accepts an explicitly empty screening population without inventing matches", async () => {
    rpc.mockResolvedValue({
      data: {
        screenedAt: "2026-09-29",
        actorId: "a",
        limitation: "Not proof",
        population: [],
        matches: [],
        populationCount: 0,
        matchCount: 0,
      },
      error: null,
    });
    await expect(
      screenProjectCaExposure("v", "Reviewed"),
    ).resolves.toMatchObject({ matchCount: 0 });
  });
  it("rejects matches outside the screened population", async () => {
    rpc.mockResolvedValue({
      data: {
        screenedAt: "2026-09-29",
        actorId: "a",
        limitation: "Not proof",
        population: [],
        matches: ["foreign"],
        populationCount: 0,
        matchCount: 1,
      },
      error: null,
    });
    await expect(screenProjectCaExposure("v", "Reviewed")).rejects.toThrow(
      "consistent population",
    );
  });
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
