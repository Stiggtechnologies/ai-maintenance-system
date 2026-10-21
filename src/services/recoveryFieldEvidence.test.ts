import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildRecoveryEvidenceMetadata,
  RECOVERY_ATTACHMENT_KINDS,
  RECOVERY_FIELD_EVIDENCE_KINDS,
  recoveryEvidenceAccept,
  uploadRecoveryFieldAttachment,
  validateRecoveryEvidenceFile,
  validateRecoveryEvidenceMetadata,
} from "./recoveryFieldEvidence";

const rpc = vi.fn();
const uploadSyncAttachment = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

vi.mock("./syncConversation", () => ({
  uploadSyncAttachment: (...args: unknown[]) => uploadSyncAttachment(...args),
}));

describe("Recovery multimodal field evidence", () => {
  beforeEach(() => {
    rpc.mockReset();
    uploadSyncAttachment.mockReset();
  });

  it("offers the bounded field-input vocabulary", () => {
    expect(RECOVERY_FIELD_EVIDENCE_KINDS).toEqual([
      "note",
      "photo",
      "video",
      "voice",
      "document",
      "measurement",
      "checklist",
      "scan",
      "signature",
      "location",
      "drawing",
    ]);
    expect([...RECOVERY_ATTACHMENT_KINDS]).toEqual([
      "photo",
      "video",
      "voice",
      "document",
      "signature",
      "drawing",
    ]);
    expect(recoveryEvidenceAccept("video")).toBe("video/*");
    expect(recoveryEvidenceAccept("voice")).toBe("audio/*");
  });

  it("requires media to match its governed input kind", () => {
    expect(validateRecoveryEvidenceFile("video", null)).toMatch(
      /requires a file/i,
    );
    expect(
      validateRecoveryEvidenceFile("video", { type: "image/jpeg" }),
    ).toMatch(/video file/i);
    expect(
      validateRecoveryEvidenceFile("video", { type: "video/mp4" }),
    ).toBeNull();
    expect(
      validateRecoveryEvidenceFile("signature", { type: "application/pdf" }),
    ).toBeNull();
    expect(validateRecoveryEvidenceFile("note", null)).toBeNull();
  });

  it("builds structured observations without inventing verification", () => {
    expect(
      buildRecoveryEvidenceMetadata("measurement", {
        measurementValue: " 12.4 ",
        measurementUnit: " mm/s ",
        instrument: " Vib-17 ",
      }),
    ).toEqual({
      value: "12.4",
      unit: "mm/s",
      instrument: "Vib-17",
      capture_method: "human_field_entry",
    });
    expect(
      buildRecoveryEvidenceMetadata("checklist", {
        checklistText: " Guard fitted\n\nFasteners witness-marked ",
      }),
    ).toEqual({
      items: [
        { observation: "Guard fitted" },
        { observation: "Fasteners witness-marked" },
      ],
      capture_method: "human_checklist_entry",
    });
    expect(buildRecoveryEvidenceMetadata("signature", {})).toMatchObject({
      authority_boundary: "evidence_only_not_approval_or_release",
    });
  });

  it("rejects incomplete structured evidence before the RPC", () => {
    expect(
      validateRecoveryEvidenceMetadata("measurement", { value: "12.4" }),
    ).toMatch(/value and unit/i);
    expect(
      validateRecoveryEvidenceMetadata("checklist", { items: [] }),
    ).toMatch(/at least one/i);
    expect(validateRecoveryEvidenceMetadata("scan", { code: "" })).toMatch(
      /observed identifier/i,
    );
    expect(
      validateRecoveryEvidenceMetadata("location", {
        latitude: 91,
        longitude: -113,
      }),
    ).toMatch(/valid latitude/i);
  });

  it("creates one governed Recovery upload context before using the canonical attachment rail", async () => {
    const file = new File(["clip"], "walkdown.mp4", { type: "video/mp4" });
    const attachment = {
      id: "attachment-1",
      workspaceId: "workspace-1",
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      objectPath: "org/user/workspace/clip",
      extractionStatus: "unsupported" as const,
      createdAt: "2026-10-03T00:00:00Z",
    };
    rpc.mockResolvedValue({ data: "workspace-1", error: null });
    uploadSyncAttachment.mockResolvedValue(attachment);

    await expect(
      uploadRecoveryFieldAttachment("event-1", file),
    ).resolves.toEqual(attachment);
    expect(rpc).toHaveBeenCalledWith(
      "get_or_create_recovery_evidence_workspace",
      { p_event_id: "event-1" },
    );
    expect(uploadSyncAttachment).toHaveBeenCalledWith("workspace-1", file);
  });
});
