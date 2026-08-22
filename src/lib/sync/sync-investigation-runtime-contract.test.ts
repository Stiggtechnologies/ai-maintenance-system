import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8");

const runtime = read("supabase/functions/sync-investigation-runtime/index.ts");
const provider = read("supabase/functions/_shared/llm-provider-stream.ts");
const policy = read("supabase/functions/_shared/sync-response-policy.ts");
const investigation = read("supabase/functions/_shared/sync-investigation.ts");
const migration = read("supabase/migrations/20260921110000_sync_investigation_v2.sql");
const attachmentControl = read("supabase/migrations/20260921110100_sync_attachment_controls.sql");
const dock = read("src/components/CopilotDock.tsx");
const boundary = JSON.parse(read("config/edge-function-boundary.json")) as { activeFunctions: string[] };
const deploy = read(".github/workflows/deploy-migrations.yml");

describe("Sync Investigation Runtime v2 contract", () => {
  it("uses real provider streaming rather than post-hoc answer chunking", () => {
    expect(runtime).toContain("callWithResilienceStream");
    expect(provider).toContain("stream: true");
    expect(provider).toContain("await opts.onDelta(text)");
    expect(runtime).toContain('type: "assistant.delta"');
    expect(runtime).not.toContain("const chunkSize = 160");
    expect(provider).toContain("failover refused to prevent duplicate or contradictory prose");
  });

  it("executes deterministic operational checks and does not trust client liveContext", () => {
    expect(runtime).toContain('client.rpc("get_kpi_dashboard")');
    expect(runtime).toContain('item.id === "asset-data-integrity"');
    expect(runtime).toContain('item.id === "safety-indicators"');
    expect(runtime).toContain('item.id === "open-recommendations"');
    expect(investigation).toContain('id: "risk-ranking"');
    expect(runtime).not.toContain("body.context?.liveContext");
  });

  it("makes response depth a server policy", () => {
    expect(runtime).toContain("buildSyncResponsePolicy(question)");
    expect(policy).toContain("SERVER POLICY");
    expect(dock).not.toContain("syncResponseGuidance");
  });

  it("only says specialist execution when specialist model calls actually run", () => {
    expect(runtime).toContain("runFocusedSpecialist");
    expect(runtime).toContain('executionMode: "executed"');
    expect(runtime).toContain("specialistOutputs.push");
    expect(runtime).toContain("EXECUTED SPECIALIST RESULTS");
  });

  it("persists investigation trace, telemetry, evidence and response mode on canonical Cowork messages", () => {
    expect(runtime).toContain('.from("cowork_messages")');
    expect(runtime).toContain("investigation_checks: investigation.checks");
    expect(runtime).toContain("telemetry,");
    expect(runtime).toContain("response_mode: responsePolicy.mode");
    expect(runtime).toContain("evidenceRefs: allEvidence");
    expect(runtime).not.toMatch(/create\s+table[^;]*sync_(conversation|message|evidence|audit)/i);
  });

  it("extends canonical Cowork with creator-private attachment sources", () => {
    expect(migration).toContain("create table if not exists public.cowork_attachments");
    expect(migration).toContain("cowork_attachments_sync_read_own");
    expect(migration).toContain("uploaded_by = auth.uid()");
    expect(migration).toContain("storage.buckets");
    expect(migration).toContain("sync-attachments");
    expect(attachmentControl).toContain("delete_sync_attachment");
    expect(runtime).toContain('.from("cowork_attachments")');
  });

  it("grounds PDFs/images/text/spreadsheets as source material without publishing them to the KB", () => {
    expect(runtime).toContain('mime === "application/pdf"');
    expect(runtime).toContain('mime.startsWith("image/")');
    expect(runtime).toContain("XLSX.utils.sheet_to_csv");
    expect(runtime).toContain('sourceType: "attachment"');
    expect(runtime).not.toContain('.from("reliability_knowledge_base").insert');
  });

  it("keeps governed tool execution on the existing proof/idempotency runtime", () => {
    expect(runtime).toContain('/functions/v1/sync-runtime');
    expect(runtime).toContain("proxyGovernedTool");
    expect(runtime).toContain("persistToolProposal");
    expect(runtime).toContain("proposalParamsHash");
  });

  it("uses the shared notification classifier for governed proposals", () => {
    expect(runtime).toContain("notificationTypeFor(question)");
  });

  it("deploys v2 explicitly when its backend changes land on main", () => {
    expect(boundary.activeFunctions).toContain("sync-investigation-runtime");
    expect(deploy).toContain('"supabase/functions/sync-investigation-runtime/**"');
    expect(deploy).toContain("supabase functions deploy sync-investigation-runtime");
  });

  it("wires the global shell to history, files, full-screen, provenance and persistent traces", () => {
    expect(dock).toContain("SyncConversationSidebar");
    expect(dock).toContain("uploadSyncAttachment");
    expect(dock).toContain("textarea");
    expect(dock).toContain('type ViewMode = "dock" | "expanded" | "fullscreen"');
    expect(dock).toContain("SyncResponseBody");
    expect(dock).toContain("sync-investigation-runtime");
    expect(dock).toContain("attachmentIds");
  });
});
