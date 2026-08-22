import { describe, expect, it } from "vitest";
import {
  buildSyncAttachmentObjectPath,
  sanitizeSyncAttachmentName,
  validateSyncAttachment,
} from "./attachments";

describe("Sync attachment helpers", () => {
  it("removes path traversal and unsafe filename characters", () => {
    expect(sanitizeSyncAttachmentName("../../pump / trip?.csv")).toBe(
      "pump-trip-.csv",
    );
  });

  it("rejects oversized and unsupported files", () => {
    expect(validateSyncAttachment({ name: "manual.exe", size: 10 })).toMatch(
      /Supported files/,
    );
    expect(
      validateSyncAttachment({ name: "manual.pdf", size: 26 * 1024 * 1024 }),
    ).toMatch(/25 MB/);
  });

  it("builds an org/user/workspace-scoped object key", () => {
    expect(
      buildSyncAttachmentObjectPath({
        organizationId: "org-1",
        userId: "user-1",
        workspaceId: "work-1",
        fileName: "Pump History.csv",
        objectId: "obj-1",
      }),
    ).toBe("org-1/user-1/work-1/obj-1-Pump-History.csv");
  });
});
