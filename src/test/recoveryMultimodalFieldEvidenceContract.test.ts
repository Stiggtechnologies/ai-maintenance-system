import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270101650000_recovery_multimodal_field_evidence.sql",
  "utf8",
).toLowerCase();
const service = readFileSync("src/services/recoveryFieldEvidence.ts", "utf8");
const capture = readFileSync(
  "src/components/RecoveryFieldEvidenceCapture.tsx",
  "utf8",
);
const center = readFileSync("src/components/RecoveryControlCenter.tsx", "utf8");
const matrix = readFileSync("docs/sync-recovery/control-matrix.md", "utf8");

describe("governed Recovery multimodal field evidence", () => {
  it("extends the existing evidence and attachment models instead of creating a parallel store", () => {
    expect(migration).toContain("alter table public.recovery_field_evidence");
    expect(migration).toContain("public.cowork_attachments");
    expect(migration).toContain("public.cowork_workspaces");
    expect(migration).toContain("bucket_id='sync-attachments'");
    expect(migration).not.toMatch(
      /create table (public\.)?recovery_.*attachment/,
    );
    expect(migration).not.toContain("insert into storage.buckets");
  });

  it("covers the bounded popular field-input vocabulary", () => {
    for (const kind of [
      "photo",
      "video",
      "voice",
      "document",
      "measurement",
      "note",
      "checklist",
      "scan",
      "signature",
      "location",
      "drawing",
    ]) {
      expect(migration).toContain(`'${kind}'`);
      expect(service).toContain(`"${kind}"`);
    }
    expect(service).toContain("Barcode / QR / RFID / NFC");
    expect(capture).toContain("Use device location");
    expect(capture).toContain("capture={");
  });

  it("binds every write to actor, tenant, event and same-event work", () => {
    expect(migration).toContain("public.app_current_org()");
    expect(migration).toContain("uploaded_by=auth.uid()");
    expect(migration).toContain("and event_id=p_event_id");
    expect(migration).toContain("and organization_id=v_org");
    expect(migration).toContain("event work is not part of this event");
    expect(migration).toContain(
      "w.context_snapshot->>'recovery_event_id'=p_event_id::text",
    );
    expect(migration).toContain(
      "attachment is not an active Recovery upload for this user and event".toLowerCase(),
    );
    expect(migration).toContain("field evidence authority denied");
    expect(migration).toContain("from public,anon");
    expect(migration).not.toMatch(/grant execute[^;]+to anon/);
  });

  it("keeps Recovery upload contexts creator-private instead of inheriting tenant-wide Cowork writes", () => {
    expect(migration).toContain(
      "workspace_kind not in ('sync','recovery_evidence')",
    );
    expect(migration).toContain("cowork_workspaces_recovery_evidence_read_own");
    expect(migration).toContain("and created_by=auth.uid()::text");
  });

  it("makes linked bytes shareable in-tenant but immutable to creator deletion", () => {
    expect(migration).toContain("cowork_attachments_recovery_evidence_read");
    expect(migration).toContain("sync_attachments_recovery_read");
    expect(migration).toContain("can_read_recovery_field_object");
    expect(migration).toContain("recovery_field_object_is_linked");
    expect(migration).toContain(
      "and not public.recovery_field_object_is_linked(name)",
    );
  });

  it("refuses mismatched media and incomplete structured observations", () => {
    expect(migration).toContain("video evidence requires a video attachment");
    expect(migration).toContain("photo evidence requires an image attachment");
    expect(migration).toContain("voice evidence requires an audio attachment");
    expect(migration).toContain(
      "measurement evidence requires the observed value and unit",
    );
    expect(migration).toContain(
      "checklist evidence requires one or more recorded observations",
    );
    expect(migration).toContain("location evidence is outside valid");
  });

  it("preserves human authority and treats device observations honestly", () => {
    for (const text of [
      "evidence_only_not_approval_or_release",
      "observed_identifier_not_verified_master_data",
      "reported_device_or_manual_location",
    ]) {
      expect(migration).toContain(text);
    }
    expect(capture).toMatch(/cannot\s+approve a plan/);
    expect(matrix).toContain("Signatures never approve or release work");
    expect(matrix).toContain("unverified observations");
  });

  it("detects idempotency-key misuse instead of returning unrelated evidence", () => {
    expect(migration).toContain(
      "client command id is already bound to different field evidence",
    );
    expect(migration).toContain("'replayed',v_replayed");
    expect(migration).toContain("'recovery_field_evidence'");
  });

  it("is actually reachable from the Recovery Control surface", () => {
    expect(center).toContain("RecoveryFieldEvidenceCapture");
    expect(capture).toContain("uploadRecoveryFieldAttachment");
    expect(capture).toContain("recoveryActions.addFieldEvidence");
    expect(capture).toContain("Record governed field evidence");
  });

  it("keeps offline operational writes explicitly deferred", () => {
    expect(matrix).toContain(
      "Offline operational writes and field synchronization remain deliberately deferred.",
    );
    expect(capture).not.toContain("localStorage");
    expect(capture).not.toContain("indexedDB");
  });
});
