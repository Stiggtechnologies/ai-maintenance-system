import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(relative, "utf8");

describe("sync-tts deploy and honesty contract", () => {
  it("is an explicit JWT-verified edge function on the approved boundary", () => {
    const boundary = JSON.parse(read("config/edge-function-boundary.json")) as {
      activeFunctions: string[];
      allowedNoVerifyJwt: string[];
    };
    const deploy = read(".github/workflows/deploy-migrations.yml");
    expect(boundary.activeFunctions).toContain("sync-tts");
    expect(boundary.allowedNoVerifyJwt).not.toContain("sync-tts");
    expect(deploy).toContain('"supabase/functions/sync-tts/**"');
    expect(deploy).toContain("supabase functions deploy sync-tts");
    expect(deploy).not.toMatch(
      /supabase functions deploy sync-tts[^\n]*--no-verify-jwt/,
    );
    const config = read("supabase/config.toml");
    const syncTtsStart = config.indexOf("[functions.sync-tts]");
    const nextFunction = config.indexOf("[functions.", syncTtsStart + 1);
    const syncTtsBlock = config.slice(syncTtsStart, nextFunction);
    expect(syncTtsBlock).toMatch(/verify_jwt\s*=\s*true/);
    expect(syncTtsBlock).not.toMatch(/verify_jwt\s*=\s*false/);
  });

  it("uses the existing OPENAI_API_KEY and does not require ElevenLabs", () => {
    const fn = read("supabase/functions/sync-tts/index.ts");
    const core = read("supabase/functions/_shared/sync-tts-core.ts");
    expect(fn).toContain('Deno.env.get("OPENAI_API_KEY")');
    expect(fn).toContain("auth.getUser()");
    expect(fn).toContain('json({ error: "unauthorized" }, 401)');
    expect(fn).toContain("audio/mpeg");
    expect(fn).toContain("validateSyncTtsInput");
    expect(core).toContain("gpt-4o-mini-tts");
    expect(core).toContain("tts-1");
    expect(core).toContain("onyx");
    expect(fn).not.toMatch(/Deno\.env\.get\("ELEVENLABS_API_KEY"\)/);
    expect(fn).not.toMatch(/api\.elevenlabs\.io/);
    expect(core).not.toMatch(/api\.elevenlabs\.io/);
    expect(fn).not.toMatch(/backtalk|fullstack-agent|kokoro/i);
    expect(core).not.toMatch(/backtalk|fullstack-agent|kokoro/i);
  });

  it("meters speech before the provider call and does not touch commercial plan policy", () => {
    const fn = read("supabase/functions/sync-tts/index.ts");
    const core = read("supabase/functions/_shared/sync-tts-core.ts");
    const meteredAt = fn.indexOf("await runMeteredSyncTts");
    expect(meteredAt).toBeGreaterThan(-1);
    expect(fn.indexOf("tts_usage_unavailable")).toBeLessThan(meteredAt);
    expect(fn.indexOf("organization_required")).toBeLessThan(meteredAt);
    expect(fn.lastIndexOf("synthesizeOpenAiSpeech")).toBeGreaterThan(meteredAt);
    expect(fn).toContain('from("user_profiles")');
    expect(fn).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(core.indexOf('input.rpc("reserve_sync_tts_usage"')).toBeLessThan(
      core.indexOf("input.synthesize("),
    );
    expect(core.indexOf("input.synthesize(")).toBeLessThan(
      core.indexOf('input.rpc("settle_sync_tts_usage"'),
    );
    expect(core).toContain("tts_usage_record_failed");
    expect(core).toContain("user_rate_limit_exceeded");
    expect(core).toContain("org_daily_character_quota_exceeded");
    for (const source of [fn, core]) {
      expect(source).not.toContain("configure_ai_commercial_plan_policy");
      expect(source).not.toContain("approve_ai_commercial_plan_policy");
      expect(source).not.toContain("check_llm_commercial_quota");
      expect(source).not.toContain("check_llm_quota");
    }
  });

  it("wires Meet Sync presence through useSpeechOutput without claiming premium when fallback", () => {
    const welcome = read("src/components/PresenceWelcome.tsx");
    const booth = read("src/components/PresenceBoothConversation.tsx");
    const hook = read("src/hooks/useSpeechOutput.ts");
    expect(welcome).toContain("useSpeechOutput");
    expect(welcome).toContain("describePresenceVoiceHonesty");
    expect(welcome).toContain("speak={speak}");
    expect(booth).toContain("speak(spoken)");
    expect(hook).toContain("requestSyncTtsAudio");
    expect(hook).toContain("speechSynthesis");
    expect(welcome).not.toMatch(/premium quality/i);
    expect(welcome).not.toMatch(/ElevenLabs/i);
  });

  it("does not pull src/ into the functions tree and still shares stripForSpeech", () => {
    const coreTest = read("supabase/functions/_shared/sync-tts-core.test.ts");
    const booth = read("src/lib/presence/booth.ts");
    expect(coreTest).not.toMatch(/from ["']\.\.\/\.\.\/\.\.\/src\//);
    expect(booth).toContain(
      'from "../../../supabase/functions/_shared/sync-tts-core"',
    );
  });
});
