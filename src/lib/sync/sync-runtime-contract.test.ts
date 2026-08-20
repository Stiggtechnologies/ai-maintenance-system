import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const read = (relative: string) =>
  fs.readFileSync(path.join(root, relative), "utf8");

const runtime = read("supabase/functions/sync-runtime/index.ts");
const migration = read(
  "supabase/migrations/20260919090000_sync_conversation_extensions.sql",
);
const flagAdmin = read(
  "supabase/migrations/20260919091000_sync_flag_admin.sql",
);
const boundary = read("config/edge-function-boundary.json");
const deploy = read(".github/workflows/deploy-migrations.yml");
const dock = read("src/components/CopilotDock.tsx");
const settings = read("src/pages/SettingsPage.tsx");

describe("Sync end-to-end runtime contract", () => {
  it("reuses the governed Reliability Engineer instead of creating an unmetered model rail", () => {
    expect(runtime).toContain("/functions/v1/ai-agent-processor");
    expect(runtime).toContain("selectReliabilitySpecialists");
    expect(runtime).not.toMatch(
      /api\.openai\.com|OPENAI_API_KEY|callWithResilience/,
    );
  });

  it("enforces rollout flags again on the server", () => {
    expect(runtime).toContain('flags.has("sync_global_shell")');
    expect(runtime).toContain('flags.has("sync_agent_routing")');
    expect(runtime).toContain('flags.has("sync_tools")');
    expect(runtime).toContain('flags.has("sync_meeting_mode")');
    expect(runtime).toContain('flags.has("sync_field_mode")');
    expect(runtime).toContain("feature_flags");
  });

  it("gives meeting and field modes server-owned behavioral boundaries", () => {
    expect(runtime).toContain("MEETING MODE — FACILITATION CONTRACT");
    expect(runtime).toContain("Do not infer speaker identity");
    expect(runtime).toContain("FIELD MODE — CONTROLLED GUIDANCE CONTRACT");
    expect(runtime).toContain("Never instruct a user to bypass isolation/LOTO");
    expect(runtime).toContain("modeNotice");
  });

  it("extends canonical Cowork persistence rather than creating Sync tables", () => {
    expect(migration).toContain("alter table public.cowork_workspaces");
    expect(migration).toContain("alter table public.cowork_messages");
    expect(runtime).toContain('.from("cowork_workspaces")');
    expect(runtime).toContain('.from("cowork_messages")');
    expect(migration).not.toMatch(/create\s+table[^;]*sync_/i);
  });

  it("keeps confirmed actions human initiated, user scoped and idempotent", () => {
    expect(dock).toContain("Confirm action");
    expect(runtime).toContain("toolExecution");
    expect(runtime).toContain("raise_maintenance_notification");
    expect(runtime).toContain('Authorization: `Bearer ${auth.token}`');
    expect(runtime).toContain('.from("audit_events")');
    expect(migration).toContain("idx_audit_sync_tool_idempotency");
    expect(migration).toContain("idx_audit_sync_tool_proposal");
  });

  it("keeps rollout mutations behind an admin-only audited RPC and existing Settings", () => {
    expect(flagAdmin).toContain("set_sync_feature_flag");
    expect(flagAdmin).toContain("security definer");
    expect(flagAdmin).toContain("('admin', 'ai_admin')");
    expect(flagAdmin).toContain("'sync_feature_flag'");
    expect(flagAdmin).toContain("audit_events");
    expect(flagAdmin).toContain(
      "grant execute on function public.set_sync_feature_flag(text, boolean) to authenticated",
    );
    expect(settings).toContain("SyncRolloutTab");
    expect(settings).toContain('supabase.rpc("set_sync_feature_flag"');
    expect(settings).toContain("announceSyncFeatureFlagsChanged");
  });

  it("deploys only through the explicit edge-function boundary", () => {
    const parsed = JSON.parse(boundary) as { activeFunctions: string[] };
    expect(parsed.activeFunctions).toContain("sync-runtime");
    expect(deploy).toContain('"supabase/functions/sync-runtime/**"');
    expect(deploy).toContain("supabase functions deploy sync-runtime");
  });

  it("wires the global shell to streaming, stop/regenerate and voice adapters", () => {
    expect(dock).toContain('useFeatureFlag("sync_global_shell")');
    expect(dock).toContain("useSyncStream()");
    expect(dock).toContain("stream.cancel");
    expect(dock).toContain("Regenerate");
    expect(dock).toContain("useDictation");
    expect(dock).toContain("useSpeechOutput");
    expect(dock).toContain("loadLatestSyncConversation");
  });
});
