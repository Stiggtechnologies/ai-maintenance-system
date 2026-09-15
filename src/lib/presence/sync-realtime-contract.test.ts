import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(relative, "utf8");

describe("Sync Realtime voice production contract", () => {
  it("deploys from the explicit JWT-protected Edge Function boundary", () => {
    const boundary = JSON.parse(read("config/edge-function-boundary.json")) as {
      activeFunctions: string[];
      allowedNoVerifyJwt: string[];
    };
    const workflow = read(".github/workflows/deploy-migrations.yml");
    const config = read("supabase/config.toml");

    expect(boundary.activeFunctions).toContain("sync-realtime-session");
    expect(boundary.allowedNoVerifyJwt).not.toContain("sync-realtime-session");
    expect(workflow).toContain('"supabase/functions/sync-realtime-session/**"');
    expect(workflow).toContain(
      "supabase functions deploy sync-realtime-session",
    );
    expect(workflow).toContain(
      "Sync Realtime Voice is deployed and JWT-protected",
    );
    const functionBlock = config.slice(
      config.indexOf("[functions.sync-realtime-session]"),
    );
    expect(functionBlock).toMatch(/verify_jwt\s*=\s*true/);
  });

  it("authenticates and checks tenant flags and quota before contacting OpenAI", () => {
    const source = read("supabase/functions/sync-realtime-session/index.ts");
    const serve = source.slice(source.indexOf("Deno.serve"));
    const providerCall = serve.indexOf("OPENAI_REALTIME_CALLS_URL");

    expect(serve.indexOf("authenticate(req)")).toBeLessThan(providerCall);
    expect(serve.indexOf("enabledFlags(auth.organizationId)")).toBeLessThan(
      providerCall,
    );
    expect(serve.indexOf("reserveQuota(auth.organizationId)")).toBeLessThan(
      providerCall,
    );
    expect(source).toContain('p_fn: "sync-realtime-session"');
    expect(source).toContain('Deno.env.get("OPENAI_API_KEY")');
    expect(source).not.toMatch(/OPENAI_API_KEY[^\n]*json\(/);
  });

  it("routes plant questions to canonical Sync and leaves action confirmation visible", () => {
    const core = read("supabase/functions/_shared/sync-realtime-core.ts");
    const dock = read("src/components/CopilotDock.tsx");
    const hook = read("src/hooks/useSyncRealtimeVoice.ts");

    expect(core).toContain('name: "ask_sync"');
    expect(core).toMatch(/always call ask_sync/i);
    expect(core).toMatch(/visible human confirmation/i);
    expect(dock).toContain("startSyncRequest(");
    expect(dock).toContain("captured.pendingApproval");
    expect(hook).toContain('call.name === "ask_sync"');
    expect(hook).not.toContain("executeProposal(");
  });

  it("renders a real Start conversation control and privacy notice in global Sync", () => {
    const panel = read("src/components/SyncRealtimeVoicePanel.tsx");
    const shell = read("src/components/AppShell.tsx");

    expect(panel).toContain("Start conversation");
    expect(panel).toContain("microphone audio");
    expect(panel).toMatch(/Sync\s+answers needed for the conversation/);
    expect(panel).toContain("processed by OpenAI");
    expect(panel).toContain("visible human confirmation");
    expect(shell).toContain(
      "<CopilotDock currentPath={currentPath} onNavigate={onNavigate} />",
    );
  });
});
