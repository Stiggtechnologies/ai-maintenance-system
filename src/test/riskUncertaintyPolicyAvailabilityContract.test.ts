import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Source contracts only. Full-chain multi-session RPC qualification must prove
// actual prompt contention, complete state preservation and lock release.
const migration = readFileSync(
  "supabase/migrations/20270103050000_risk_uncertainty_analysis.sql",
  "utf8",
);
function body(name: string): string {
  const source = migration.match(
    new RegExp(
      `create or replace function public\\.${name}\\([^]*?as \\$\\$([^]*?)\\$\\$;`,
    ),
  )?.[1];
  if (!source) throw new Error(`Missing owned function ${name}`);
  return source
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
const busy = "criteria profile is busy; reload the governed workspace";

describe("U18 bounded policy contention source contract", () => {
  it.each([
    "submit_risk_uncertainty_analysis_internal",
    "review_risk_uncertainty_analysis",
  ])(
    "%s refuses only current criteria contention before writes and unwinds its acquired fence locks",
    (name) => {
      const source = body(name);
      const acquire = source.indexOf(
        "begin select * into c from public.risk_criteria_profiles",
      );
      const firstWrite = source.search(
        /(?:insert into|update) public\.(?:approvals|risk_uncertainty_analyses)/,
      );
      expect(acquire).toBeGreaterThan(
        source.indexOf("public.risk_uncertainty_lock_visibility_context"),
      );
      expect(acquire).toBeLessThan(firstWrite);
      expect(source).toContain(
        "begin select * into c from public.risk_criteria_profiles where id=r.criteria_profile_id and organization_id=v_org for share nowait; exception when lock_not_available then raise exception using errcode='U1801',message='uncertainty current criteria acquisition busy'; end;",
      );
      // The handler belongs to the encompassing function block, not the small
      // criteria block: PostgreSQL must unwind earlier risk/packet fences too.
      expect(source).toMatch(
        new RegExp(
          `exception when sqlstate 'U1801' then return jsonb_build_object\\('error','${busy}'\\); end$`,
        ),
      );
      const handler = source.slice(
        source.lastIndexOf("exception when sqlstate 'U1801'"),
      );
      expect(handler).not.toMatch(
        /when others|deadlock_detected|query_canceled|when lock_not_available/i,
      );
      expect(source.match(/errcode='U1801'/g)).toHaveLength(1);
      expect(source).toContain("auth.uid() is distinct from v_user");
      expect(source).toContain(
        "public.app_current_org() is distinct from v_org",
      );
      expect(source).toContain(
        "public.can_read_risk(r.id) is distinct from true",
      );
      expect(source).toContain("'operationalAuthorization',false");
    },
  );

  it("recognizes committed historical replacement before mutable current-policy contention", () => {
    const source = body("submit_risk_uncertainty_analysis_internal");
    const receipt = source.indexOf(
      "return public.risk_uncertainty_replacement_receipt_payload(v_packet)",
    );
    const acquire = source.indexOf(
      "begin select * into c from public.risk_criteria_profiles",
    );
    expect(receipt).toBeGreaterThan(-1);
    expect(acquire).toBeGreaterThan(receipt);
    expect(source.slice(0, receipt)).toContain(
      "v_packet.replacement_request_fingerprint is distinct from v_fingerprint",
    );
    expect(source.slice(0, receipt)).toContain(
      "current named human engineering or management membership required",
    );
    expect(source).toContain(
      "replacement inputs or policy changed; reload the governed workspace",
    );
  });

  it("keeps the validated writer private and never reclassifies server deadlocks or timeouts as policy contention", () => {
    expect(migration).toContain(
      "revoke all on function public.submit_risk_uncertainty_analysis_internal(uuid,jsonb,uuid[],jsonb) from public,anon,authenticated,service_role;",
    );
    for (const name of [
      "submit_risk_uncertainty_analysis_internal",
      "review_risk_uncertainty_analysis",
    ]) {
      expect(body(name)).not.toMatch(
        /exception when (?:others|deadlock_detected|query_canceled)|sqlstate '(?:40P01|57014)'/i,
      );
    }
  });
});
