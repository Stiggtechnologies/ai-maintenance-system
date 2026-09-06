/**
 * Tenant + owner isolation for Meet Sync durable notes.
 *
 * Notes are signed-in, same-org, same-user. They are not a Decision Case
 * store and they do not authorize plant action.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  grantsAuthenticated,
  resolveChainPolicies,
  usingOf,
  withCheckOf,
} from "./support/migrationPolicies";

const MIGRATION =
  "supabase/migrations/20261214090000_presence_meeting_vault.sql";
const sql = readFileSync(MIGRATION, "utf8");

let chainError: Error | null = null;
let chain = new Map<
  string,
  ReturnType<typeof resolveChainPolicies> extends Map<string, infer V>
    ? V
    : never
>();
try {
  chain = resolveChainPolicies();
} catch (error) {
  chainError = error as Error;
}

const policies = [...chain.values()].filter(
  (p) => p.table === "presence_meeting_vault",
);
const statements = policies.flatMap((p) =>
  p.statements.map((text) => ({ ...p, text })),
);

const normalise = (value: string) => value.replace(/\s+/g, " ").toLowerCase();

describe("presence meeting vault tenancy", () => {
  it("the chain resolved", () => {
    expect(chainError?.message ?? null).toBeNull();
  });

  it("anchors rows to organization and signed-in owner", () => {
    expect(sql).toMatch(
      /organization_id uuid not null references public\.organizations\(id\)/,
    );
    expect(sql).toMatch(
      /user_id uuid not null references public\.user_profiles\(id\)/,
    );
    expect(sql).toMatch(/enable row level security/);
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).toMatch(/security invoker/);
  });

  it("every surviving grant is owner + app_current_org()", () => {
    const granted = statements.filter((p) => grantsAuthenticated(p.text));
    expect(granted.length).toBeGreaterThan(0);
    for (const p of granted) {
      for (const predicate of [usingOf(p.text), withCheckOf(p.text)]) {
        if (!predicate) continue;
        expect(predicate).toMatch(
          /organization_id = public\.app_current_org\(\)/,
        );
        expect(predicate).toMatch(/user_id = auth\.uid\(\)/);
        expect(normalise(predicate)).not.toMatch(/organization_id is null/);
        expect(normalise(predicate)).not.toBe("true");
      }
    }
  });

  it("has no delete, no for-all, and no anon grant", () => {
    expect(
      statements
        .filter((p) => /\bfor\s+delete\b/i.test(p.text))
        .map((p) => p.policy),
    ).toEqual([]);
    expect(
      statements
        .filter((p) => /\bfor\s+all\b/i.test(p.text))
        .map((p) => p.policy),
    ).toEqual([]);
    expect(sql).toMatch(
      /revoke all on table public\.presence_meeting_vault from public, anon/,
    );
    expect(sql).toMatch(
      /grant select, insert, update on table public\.presence_meeting_vault to authenticated/,
    );
  });

  it("stamps tenant and owner so a client cannot spoof another org", () => {
    expect(sql).toMatch(/new\.user_id := auth\.uid\(\)/);
    expect(sql).toMatch(/new\.organization_id := public\.app_current_org\(\)/);
    expect(sql).toMatch(/recommend_not_authorize/);
    expect(sql).not.toMatch(/from\s+['"].*(obsidian|jaredrhod)/i);
  });

  it("mutation-sanity — the leaked null-org form is rejected", () => {
    const leaked =
      "organization_id is null or organization_id = public.app_current_org()";
    const shipped =
      "organization_id = public.app_current_org() and user_id = auth.uid()";
    expect(/organization_id\s+is\s+null/.test(leaked)).toBe(true);
    expect(/organization_id\s+is\s+null/.test(shipped)).toBe(false);
    expect(shipped).toMatch(/user_id = auth\.uid\(\)/);
  });
});
