import { describe, expect, it } from "vitest";
import { resolveSupabasePublicKey } from "./supabase-config";

describe("resolveSupabasePublicKey", () => {
  it("prefers an explicitly configured publishable key", () => {
    expect(
      resolveSupabasePublicKey(
        "https://pjvoswbwomesuwhygpby.supabase.co",
        "sb_publishable_new",
        "legacy-jwt",
      ),
    ).toBe("sb_publishable_new");
  });

  it("falls back to a legacy anon key during environment migration", () => {
    expect(
      resolveSupabasePublicKey(
        "https://pjvoswbwomesuwhygpby.supabase.co/",
        "",
        "legacy-jwt",
      ),
    ).toBe("legacy-jwt");
  });

  it("preserves environment configuration for other projects", () => {
    expect(
      resolveSupabasePublicKey(
        "https://local-project.supabase.co",
        "",
        "local-anon-key",
      ),
    ).toBe("local-anon-key");
  });
});
