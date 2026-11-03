/**
 * E4.07 — escalation paths for overdue or blocked decisions, work and alerts,
 * including the incident / on-call holder the authority ladder does not name.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20271107120000_subject_escalation_paths.sql",
  "utf8",
);
const service = readFileSync("src/services/escalationPathService.ts", "utf8");
const page = readFileSync("src/pages/EscalationPathsPage.tsx", "utf8");
const app = readFileSync("src/App.tsx", "utf8");
const palette = readFileSync("src/components/CommandSearch.tsx", "utf8");

const doors = [
  "propose_escalation_rule",
  "adopt_escalation_rule",
  "retire_escalation_rule",
  "record_on_call_duty",
  "end_on_call_duty",
  "raise_subject_escalation",
  "acknowledge_subject_escalation",
  "withdraw_subject_escalation",
  "get_escalation_paths",
  "escalation_subject_posture",
];

describe("subject escalation paths", () => {
  it("keeps the path tenant-scoped, audited and closed to direct writes", () => {
    for (const table of [
      "escalation_rules",
      "on_call_duties",
      "escalation_records",
    ]) {
      expect(migration).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(migration).toContain(
        `using (organization_id = public.app_current_org())`,
      );
      expect(migration).toContain(
        `revoke all on public.${table} from public, anon, authenticated`,
      );
      expect(migration).toContain(
        `grant select on public.${table} to authenticated`,
      );
    }
    expect(migration).toContain("insert into public.audit_events");
    expect(migration).toContain("'grantsAuthority',false");
    expect(migration).toContain("app.escalation_path_write");
    expect(migration).not.toMatch(
      /update\s+public\.(decisions|work_orders|condition_alerts|approvals)\b/,
    );
    expect(migration).not.toMatch(
      /insert\s+into\s+public\.(decisions|work_orders|condition_alerts|approvals)\b/,
    );
  });

  it("refuses AI, self-approval and an incident with nobody on call", () => {
    expect(migration).toContain("v_role = 'ai_admin'");
    expect(migration).toContain("app_current_role_is_external()");
    expect(migration).toContain(
      "the proposer cannot adopt their own escalation rule",
    );
    expect(migration).toContain(
      "the person who raised an escalation cannot acknowledge it",
    );
    expect(migration).toContain(
      "no current on-call holder covers %; record a duty before raising an incident escalation",
    );
    expect(migration).toContain("approvesSubject");
    expect(migration).toContain("releasesWork");
    expect(migration).toContain("clearsAlert");
    expect(migration).toContain("authority_limits");
    expect(migration).toContain("decision_required_date");
    expect(migration).toContain("w.status = 'blocked'");
    expect(migration).toContain("organization_id = v_org");
  });

  it("exposes every door as a definer revoked from public and granted to authenticated", () => {
    for (const door of doors) {
      expect(migration).toContain(`function public.${door}(`);
      expect(migration).toContain(`revoke all on function public.${door}(`);
      if (door !== "escalation_require_actor") {
        expect(migration).toContain(
          `grant execute on function public.${door}(`,
        );
      }
    }
    expect(migration).toContain("security definer");
    expect(migration).toContain("public.app_current_org()");
    expect(migration).not.toContain(
      "escalation_require_actor(text, boolean) to authenticated",
    );
  });

  it("is reachable from the escalation page, command palette and typed service", () => {
    expect(app).toContain(
      '<Route path="/escalations" element={<EscalationPathsPage />} />',
    );
    expect(palette).toContain('path: "/escalations"');
    expect(page).toContain("getEscalationPaths");
    expect(page).toContain("raiseSubjectEscalation");
    expect(page).toContain("acknowledgeSubjectEscalation");
    expect(page).toContain("proposeEscalationRule");
    expect(page).toContain("recordOnCallDuty");
    for (const door of [
      "get_escalation_paths",
      "propose_escalation_rule",
      "adopt_escalation_rule",
      "record_on_call_duty",
      "raise_subject_escalation",
      "acknowledge_subject_escalation",
      "withdraw_subject_escalation",
    ]) {
      expect(service).toContain(`"${door}"`);
    }
    expect(page).toContain(
      "does not approve a decision, release work, or clear an alert",
    );
  });
});
