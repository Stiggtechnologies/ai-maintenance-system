import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportFailure } from "./fieldCapture";

const { rpc, from, upload, storageFrom } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  upload: vi.fn(),
  storageFrom: vi.fn(),
}));
vi.mock("../lib/supabase", () => ({
  supabase: { rpc, from, storage: { from: storageFrom } },
}));

const assetId = "asset-a";
const input = {
  assetId,
  description: "Seal leak on drive end",
  notificationType: "fault" as const,
  photo: new File(["photo"], "seal leak.jpg", { type: "image/jpeg" }),
};

beforeEach(() => {
  vi.resetAllMocks();
  from.mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: { organization_id: "org-a" },
          error: null,
        }),
      }),
    }),
  });
  storageFrom.mockReturnValue({ upload });
  upload.mockResolvedValue({ error: null });
  rpc.mockImplementation(async (name, args) => ({
    data:
      name === "raise_maintenance_notification"
        ? { id: "report-a" }
        : { attached: args.p_storage_path },
    error: null,
  }));
});

describe("field evidence after filing", () => {
  it("uses the asset's RLS-resolved org as the storage prefix and confirms the same attachment", async () => {
    const result = await reportFailure(input);
    expect(result.photoPath).toMatch(
      /^org-a\/asset-a\/report-a\/\d+-seal_leak\.jpg$/,
    );
    expect(upload).toHaveBeenCalledWith(result.photoPath, input.photo, {
      contentType: "image/jpeg",
    });
    expect(rpc).toHaveBeenLastCalledWith("attach_failure_photo", {
      p_notification_id: "report-a",
      p_asset_id: assetId,
      p_storage_path: result.photoPath,
    });
  });

  it("does not misreport an already filed report when photo storage refuses", async () => {
    upload.mockRejectedValue(new Error("storage unavailable"));
    const result = await reportFailure(input);
    expect(result).toMatchObject({
      notificationId: "report-a",
      photoWarning: expect.stringContaining("Do not file"),
    });
    expect(result.photoPath).toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("does not claim evidence attachment after an application-level refusal", async () => {
    rpc.mockResolvedValueOnce({ data: { id: "report-a" }, error: null });
    rpc.mockResolvedValueOnce({ data: { error: "refused" }, error: null });
    const result = await reportFailure(input);
    expect(result.notificationId).toBe("report-a");
    expect(result.photoWarning).toContain("not confirmed attached");
    expect(result.photoPath).toBeUndefined();
  });
});
