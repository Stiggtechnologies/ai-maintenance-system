import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270103050000_risk_uncertainty_analysis.sql",
  "utf8",
);
// Pinned BEFORE extending the byte-identical extraction. These exact published
// 16c blocks retain ALL proposal validators, arithmetic and initial digest
// finalization while replacement changes only lifecycle/locking/persistence.
const publishedBlocks = [
  [
    "  if jsonb_typeof(p_analysis)",
    "  select coalesce(array_agg(distinct x",
    "5ee34caf458e0672f65492e37263415bafba5db00df6ce33005b996653c27322",
  ],
  [
    "  v_input_binding_snapshot:=",
    "  select coalesce(max(version)",
    "7d8b0f0733f8404ae7945c135b562286a93bad9019693e625db552cce17c102f",
  ],
  [
    "  insert into public.risk_uncertainty_analysis_evidence",
    "  update public.risks set value_of_information",
    "30ef553128f67c453cee415c4432b96d7cfe21f35c467d0c81706e40dd1e24e0",
  ],
] as const;

function definition(name: string): string {
  const text = migration.match(
    new RegExp(`create or replace function public\\.${name}\\([^]*?\\$\\$;`),
  )?.[0];
  expect(text, `${name} definition exists`).toBeDefined();
  return text ?? "";
}

function body(name: string): string {
  const text = definition(name).match(/as \$\$([^]*?)\$\$;/)?.[1];
  expect(text, `${name} body exists`).toBeDefined();
  return text ?? "";
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

describe("U18 shared uncertainty submission writer extraction", () => {
  it("retains the exact published validation, calculation and digest blocks in one private writer", () => {
    const internalDefinition = definition(
      "submit_risk_uncertainty_analysis_internal",
    );
    const internal = body("submit_risk_uncertainty_analysis_internal");

    expect(internalDefinition).toMatch(
      /function public\.submit_risk_uncertainty_analysis_internal\(\s*p_risk_id uuid,p_analysis jsonb,p_evidence_item_ids uuid\[\],p_replacement jsonb default null\s*\)/,
    );
    for (const [start, end, hash] of publishedBlocks) {
      const from = internal.indexOf(start);
      const to = internal.indexOf(end, from);
      expect(from).toBeGreaterThan(-1);
      expect(to).toBeGreaterThan(from);
      expect(sha256(internal.slice(from, to))).toBe(hash);
    }
  });

  it("keeps the public security-definer door as only an authenticated organization guard and exact delegate", () => {
    const publicDefinition = definition("submit_risk_uncertainty_analysis");
    const publicBody = body("submit_risk_uncertainty_analysis");

    expect(publicDefinition).toMatch(
      /function public\.submit_risk_uncertainty_analysis\(\s*p_risk_id uuid,p_analysis jsonb,p_evidence_item_ids uuid\[\]\s*\) returns jsonb language plpgsql security definer set search_path=public as \$\$/,
    );
    expect(publicBody.replace(/\s+/g, " ").trim()).toBe(
      "begin if auth.uid() is null or public.app_current_org() is null then return jsonb_build_object('error','authenticated organization member required'); end if; return public.submit_risk_uncertainty_analysis_internal(p_risk_id,p_analysis,p_evidence_item_ids); end",
    );
    expect(
      publicBody.match(/submit_risk_uncertainty_analysis_internal\s*\(/g),
    ).toHaveLength(1);
    expect(publicBody).not.toMatch(
      /\b(?:insert|update|delete|select|perform)\b|v_voi_|v_digest|v_packet/i,
    );
  });

  it("revokes every client and service role from the private implementation", () => {
    expect(migration).toContain(
      "revoke all on function public.submit_risk_uncertainty_analysis_internal(uuid,jsonb,uuid[],jsonb) from public,anon,authenticated,service_role;",
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.submit_risk_uncertainty_analysis_internal\(uuid,jsonb,uuid\[\],jsonb\)/,
    );
  });
});
