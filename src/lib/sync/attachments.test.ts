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

  it("rejects empty and oversized files — any type is accepted at attach time", () => {
    // The picker never hides the user's documents (the 2026-08-28 case-in-
    // point): type gate removed; extraction reports what the AI can read.
    expect(validateSyncAttachment({ name: "manual.exe", size: 10 })).toBeNull();
    expect(
      validateSyncAttachment({ name: "manual.pdf", size: 26 * 1024 * 1024 }),
    ).toMatch(/25 MB/);
    expect(validateSyncAttachment({ name: "report.docx", size: 0 })).toMatch(/empty/);
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
