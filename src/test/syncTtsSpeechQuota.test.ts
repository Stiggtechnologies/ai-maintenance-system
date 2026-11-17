/**
 * sync-tts speech quota — the abuse ceiling stays off the commercial token
 * ledger. These assertions pin the migration text the same way
 * llmCostGuardrails.test.ts pins check_llm_quota.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SYNC_TTS_MAX_UTTERANCE_CHARS,
  SYNC_TTS_QUOTA_CONFIG,
} from "../../supabase/functions/_shared/sync-tts-core";

const migration = readFileSync(
  "supabase/migrations/20270105160102_sync_tts_speech_quota.sql",
  "utf8",
);
const executable = migration
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

function functionBody(name: string): string {
  const start = executable.indexOf(`function public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const end = executable.indexOf("comment on function", start);
  return executable.slice(start, end === -1 ? undefined : end);
}

describe("sync-tts speech usage ledger", () => {
  it("is a private speech ledger, not a second commercial token ledger", () => {
    expect(executable).toContain(
      "create table if not exists private.sync_tts_usage",
    );
    expect(executable).not.toContain("private.llm_usage");
    expect(executable).not.toContain("private.llm_org_quotas");
    expect(executable).not.toContain("ai_commercial_plan_policies");
    expect(executable).not.toContain("billing_subscriptions");
    expect(executable).not.toContain("configure_ai_commercial_plan_policy");
    expect(executable).not.toContain("approve_ai_commercial_plan_policy");
    expect(executable.toLowerCase()).not.toContain("marketplace");
    const table = executable.slice(
      executable.indexOf("create table if not exists private.sync_tts_usage"),
      executable.indexOf("comment on table"),
    );
    expect(table).not.toMatch(/spoken|prompt|utterance/i);
  });

  it("enables RLS and revokes the table from every app role", () => {
    expect(executable).toContain(
      "alter table private.sync_tts_usage enable row level security",
    );
    expect(executable).toContain(
      "revoke all on private.sync_tts_usage from public, anon, authenticated",
    );
  });

  it("pins the configured ceilings and refuses to raise them", () => {
    expect(executable).toContain(
      `c_default_max_characters constant integer := ${SYNC_TTS_QUOTA_CONFIG.dailyCharactersPerTenant}`,
    );
    expect(executable).toContain(
      `c_default_max_requests constant integer := ${SYNC_TTS_QUOTA_CONFIG.userRequestsPerWindow}`,
    );
    expect(executable).toContain(
      `c_default_window_seconds constant integer := ${SYNC_TTS_QUOTA_CONFIG.userWindowSeconds}`,
    );
    expect(executable).toContain(
      `characters > 0 and characters <= ${SYNC_TTS_MAX_UTTERANCE_CHARS}`,
    );
    const reserve = functionBody("reserve_sync_tts_usage");
    expect(reserve).toContain(
      "least(p_max_characters, c_default_max_characters)",
    );
    expect(reserve).toContain("least(p_max_requests, c_default_max_requests)");
    expect(reserve).toContain(
      "p_max_characters is null or p_max_characters < 1",
    );
    expect(reserve).toContain("p_window_seconds < c_default_window_seconds");
    expect(reserve).toContain("v_window_seconds := c_default_window_seconds");
    expect(reserve).not.toContain("v_window_seconds := p_window_seconds");
  });

  it("locks, checks both limits, and inserts the usage row only after both pass", () => {
    const reserve = functionBody("reserve_sync_tts_usage");
    const lockAt = reserve.indexOf("pg_advisory_xact_lock");
    const rateAt = reserve.indexOf("user_rate_limit_exceeded");
    const quotaAt = reserve.indexOf("org_daily_character_quota_exceeded");
    const insertAt = reserve.indexOf("insert into private.sync_tts_usage");
    expect(lockAt).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(rateAt);
    expect(rateAt).toBeLessThan(quotaAt);
    expect(quotaAt).toBeLessThan(insertAt);
    expect(reserve).toContain("v_user_requests >= v_max_requests");
    expect(reserve).toContain("v_chars_used + p_characters > v_max_characters");
    expect(reserve).toContain(
      "v_profile_org is distinct from p_organization_id",
    );
    expect(reserve).toContain("'limit', 'organization_mismatch'");
    expect(reserve).toMatch(
      /date_trunc\('day', now\(\) at time zone 'utc'\) at time zone 'utc'/,
    );
  });

  it("settles the model without changing the character count, and releases only open rows", () => {
    const settle = functionBody("settle_sync_tts_usage");
    expect(settle).toContain("set reserved = false");
    expect(settle).toContain("and reserved");
    expect(settle).not.toContain("characters =");
    expect(settle).toContain("'recorded', v_count = 1");
    const release = functionBody("release_sync_tts_usage");
    expect(release).toContain("delete from private.sync_tts_usage");
    expect(release).toContain("and reserved");
    expect(release).toContain("'released', v_count = 1");
  });

  it("is service-role-only on the write path and session-scoped on the tenant read", () => {
    const compact = executable.replace(/\s+/g, " ");
    for (const signature of [
      "public.reserve_sync_tts_usage( uuid, uuid, integer, integer, integer, integer )",
      "public.settle_sync_tts_usage(bigint, uuid, uuid, text)",
      "public.release_sync_tts_usage(bigint, uuid, uuid)",
      "public.get_sync_tts_usage(uuid)",
    ]) {
      expect(compact).toContain(
        `revoke all on function ${signature} from public, anon, authenticated`,
      );
      expect(compact).toContain(
        `grant execute on function ${signature} to service_role`,
      );
    }
    const mine = functionBody("get_my_sync_tts_usage");
    expect(mine).toContain("auth.uid()");
    expect(mine).toContain("where id = v_uid");
    expect(mine).toContain("organization_id = v_org");
    expect(mine).not.toContain("p_organization_id");
    expect(compact).toContain(
      "revoke all on function public.get_my_sync_tts_usage() from public, anon",
    );
    expect(compact).toContain(
      "grant execute on function public.get_my_sync_tts_usage() to authenticated",
    );
    expect(executable).not.toContain(
      "grant execute on function public.get_sync_tts_usage(uuid) to authenticated",
    );
  });
});
