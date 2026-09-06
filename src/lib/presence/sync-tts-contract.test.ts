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
  });

  it("uses the existing OPENAI_API_KEY and does not require ElevenLabs", () => {
    const fn = read("supabase/functions/sync-tts/index.ts");
    const core = read("supabase/functions/_shared/sync-tts-core.ts");
    expect(fn).toContain('Deno.env.get("OPENAI_API_KEY")');
    expect(fn).toContain("auth.getUser()");
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
});
