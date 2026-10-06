import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Structural source contracts only. These do not execute constraints, prove
// transaction rollback, qualify concurrent writers, or permit U18 release.
const raw = readFileSync(
  "supabase/migrations/20270103050000_risk_uncertainty_analysis.sql",
  "utf8",
);
const sql = raw.replace(/--[^\n]*/g, "").replace(/\s+/g, " ");
const body = (name: string) =>
  sql.match(
    new RegExp(
      `create or replace function public\\.${name}\\([^]*?as \\$\\$([^]*?)\\$\\$;`,
      "i",
    ),
  )?.[1] ?? "";
const guard = body("enforce_risk_uncertainty_analysis_write");
const bindings = body("enforce_risk_uncertainty_evidence_link");
const table =
  sql
    .split("create table if not exists public.risk_uncertainty_analyses (")[1]
    ?.split("create unique index")[0] ?? "";
const metadata = [
  ["replaces_analysis_id", "uuid"],
  ["replacement_intent_id", "uuid"],
  ["replacement_request_fingerprint", "text"],
  ["replacement_compare_and_swap", "jsonb"],
  ["replacement_reason", "text"],
  ["superseded_by_analysis_id", "uuid"],
  ["superseded_at", "timestamptz"],
  ["superseded_by_user_id", "uuid"],
] as const;
const reviewTuple = [
  "reviewer_id",
  "reviewed_at",
  "review_note",
  "approval_id",
  "derived_evidence_item_id",
] as const;
const supersessionFields = [
  "status",
  "superseded_by_analysis_id",
  "superseded_at",
  "superseded_by_user_id",
] as const;

function supersessionBranch(): string {
  const start =
    /\bif\s+new\.status\s*(?:=|is not distinct from)\s*'superseded'\s+then/i.exec(
      guard,
    );
  if (!start) return "";
  const offset = start.index + start[0].length;
  const tail = guard.slice(offset);
  let depth = 1;
  // Ignore quoted strings; count nested IFs so a check in an unrelated insert
  // or initializer branch cannot accidentally qualify the supersession path.
  for (const token of tail.matchAll(
    /'(?:''|[^'])*'|end\s+if\s*;|\bif\b|\belsif\b|\belse\b/gi,
  )) {
    const value = token[0].toLowerCase();
    if (value.startsWith("'")) continue;
    if (value === "if") depth++;
    else if (value.startsWith("end")) {
      depth--;
      if (depth === 0) return tail.slice(0, token.index);
    } else if (depth === 1) return tail.slice(0, token.index);
  }
  return "";
}
const supersession = supersessionBranch();

function projectionExceptions(source = guard): string[][] {
  return [...source.matchAll(/to_jsonb\(new\)\s*-\s*array\[([^\]]+)\]/g)].map(
    (match) => [...match[1].matchAll(/'([a-z_]+)'/g)].map((field) => field[1]),
  );
}

function uniqueDeclaration(field: string): string {
  const declarations = [
    ...sql.matchAll(/create unique index[^;]+;/gi),
    ...table.matchAll(/unique\s*\([^)]*\)/gi),
  ].map((match) => match[0]);
  return (
    declarations.find(
      (declaration) =>
        new RegExp(`\\([^)]*\\b${field}\\b[^)]*\\)`).test(declaration) &&
        !/where\s+status\s*=/.test(declaration),
    ) ?? ""
  );
}

const pairTrigger =
  sql.match(
    /create constraint trigger\s+\w+[^;]*?on public\.risk_uncertainty_analyses[^;]*?execute function public\.(\w+)\([^;]*?;/i,
  ) ?? [];
const pair = pairTrigger[1] ? body(pairTrigger[1]) : "";

describe("U18 atomic replacement canonical history source contract", () => {
  it("adds superseded as a distinct lifecycle, never an invented independent rejection", () => {
    expect(table).toMatch(/status in\s*\([^)]*'superseded'/);
    expect(table).toMatch(/status\s*=\s*'superseded'/);
    expect(table).toMatch(/status in\s*\('validated'\s*,\s*'rejected'\)/);
  });

  it.each(metadata)("stores %s on the canonical packet as %s", (name, type) => {
    expect(table).toMatch(new RegExp(`\\b${name}\\s+${type}\\b`));
  });

  it("requires complete typed intent/CAS metadata rather than nullable-CHECK success", () => {
    for (const field of [
      "replaces_analysis_id",
      "replacement_intent_id",
      "replacement_request_fingerprint",
      "replacement_compare_and_swap",
      "replacement_reason",
    ]) {
      expect(table).toContain(`${field} is null`);
      expect(table).toContain(`${field} is not null`);
    }
    expect(table).toMatch(
      /replacement_request_fingerprint\s*~\s*'\^\[0-9a-f\]\{64\}\$'/,
    );
    expect(table).toMatch(
      /jsonb_typeof\(replacement_compare_and_swap\)\s*=\s*'object'/,
    );
    expect(table).toMatch(/length\(btrim\(replacement_reason\)\)\s*>=\s*20/);
  });

  it("uses same-org/risk composite foreign keys for both directions", () => {
    expect(table).toMatch(
      /unique\s*\(organization_id\s*,\s*risk_id\s*,\s*id\)/,
    );
    for (const field of ["replaces_analysis_id", "superseded_by_analysis_id"])
      expect(table).toMatch(
        new RegExp(
          `foreign key\\s*\\(organization_id\\s*,\\s*risk_id\\s*,\\s*${field}\\)\\s*references public\\.risk_uncertainty_analyses\\s*\\(organization_id\\s*,\\s*risk_id\\s*,\\s*id\\)[^,;]*deferrable`,
        ),
      );
  });

  it("prevents intent reuse and both successor/predecessor forks across terminal history", () => {
    for (const field of ["replaces_analysis_id", "superseded_by_analysis_id"])
      expect(uniqueDeclaration(field), `${field} must be unique`).not.toBe("");
    const intent = uniqueDeclaration("replacement_intent_id");
    expect(intent).not.toBe("");
    expect(intent).toContain("organization_id");
    expect(intent).toContain("author_id");
  });

  it("allows a middle packet to have both predecessor and successor without a false exclusive-OR", () => {
    expect(table).toContain("replaces_analysis_id is not null");
    expect(table).toContain("superseded_by_analysis_id is not null");
    expect(table).not.toMatch(
      /replaces_analysis_id is null\s+or\s+superseded_by_analysis_id is null/,
    );
    expect(table).not.toMatch(
      /superseded_by_analysis_id is null\s+or\s+replaces_analysis_id is null/,
    );
    expect(table).toMatch(/replaces_analysis_id\s*(?:<>|!=)\s*id/);
    expect(table).toMatch(/superseded_by_analysis_id\s*(?:<>|!=)\s*id/);
  });

  it("validates the completed reciprocal pair at transaction end", () => {
    expect(pairTrigger[0]).toMatch(/deferrable initially deferred/);
    expect(pairTrigger[0]).toMatch(/after insert or update/);
    expect(pair).not.toBe("");
    expect(pair).toContain("public.risk_uncertainty_analyses");
    for (const field of ["organization_id", "risk_id", "author_id"])
      expect(pair).toMatch(
        new RegExp(`\\w+\\.${field}\\s+is distinct from\\s+\\w+\\.${field}`),
      );
    expect(pair).toMatch(
      /\w+\.superseded_by_analysis_id\s+is distinct from\s+\w+\.id/,
    );
    expect(pair).toMatch(
      /\w+\.replaces_analysis_id\s+is distinct from\s+\w+\.id/,
    );
    expect(pair).toMatch(/\w+\.version\s*(?:<=|>=)\s*\w+\.version/);
    expect(pair).toContain("raise exception");
    expect(sql).toContain(
      `revoke all on function public.${pairTrigger[1]}() from public,anon,authenticated,service_role`,
    );
  });

  it("makes reviewed and superseded rows immutable before any transition projection", () => {
    const terminal = guard.split("to_jsonb(new)")[0];
    expect(terminal).toMatch(/old\.status[^;]*'validated'/);
    expect(terminal).toMatch(/old\.status[^;]*'rejected'/);
    expect(terminal).toMatch(/old\.status[^;]*'superseded'/);
    expect(terminal).toContain("raise exception");
  });

  it("freezes the entire predecessor row except the four supersession transition fields", () => {
    const projections = projectionExceptions(supersession);
    expect(projections.map((fields) => [...fields].sort())).toContainEqual(
      [...supersessionFields].sort(),
    );
    const transitionExceptions = projections.find((fields) =>
      fields.includes("superseded_by_analysis_id"),
    );
    for (const field of [
      "analysis_digest",
      "digest_version",
      "input_binding_snapshot",
      "organization_id",
      "risk_id",
      "author_id",
      "version",
      "created_at",
      "replaces_analysis_id",
      "replacement_intent_id",
      "replacement_request_fingerprint",
      "replacement_compare_and_swap",
      "replacement_reason",
      ...reviewTuple,
    ])
      expect(transitionExceptions).not.toContain(field);
    expect(supersession).toMatch(/to_jsonb\(old\)\s*-\s*array\[/);
    expect(supersession).toContain("is distinct from");
  });

  it("requires a finalized pending predecessor and the exact own-author supersession metadata", () => {
    expect(guard).toMatch(
      /new\.status\s*(?:=|is not distinct from)\s*'superseded'/,
    );
    expect(supersession).not.toBe("");
    expect(supersession).toContain(
      "old.status is distinct from 'pending_review'",
    );
    expect(supersession).toMatch(
      /old\.analysis_digest\s*=\s*repeat\('0',\s*64\)/,
    );
    expect(supersession).toContain("new.superseded_by_analysis_id is null");
    expect(supersession).toContain("new.superseded_at is null");
    expect(supersession).toMatch(
      /new\.superseded_by_user_id\s+is distinct from\s+old\.author_id/,
    );
    for (const field of reviewTuple)
      expect(supersession).toContain(`new.${field} is not null`);
    // The predecessor was pending with an empty review tuple. Its whole-row
    // projection preserves that tuple; the distinct superseded CHECK requires
    // NULL again, independently of the explicit trigger refusal above.
    expect(table).toContain(
      `status='superseded' and ${reviewTuple.map((field) => `${field} is null`).join(" and ")}`,
    );
    const mutable = projectionExceptions(supersession)[0] ?? [];
    expect(mutable).not.toEqual([]);
    for (const field of reviewTuple) expect(mutable).not.toContain(field);
  });

  it("keeps initialization, human review and immutable evidence bindings as distinct channels", () => {
    const projections = projectionExceptions();
    expect(projections.map((fields) => [...fields].sort())).toContainEqual(
      ["status", "analysis_digest", ...reviewTuple].sort(),
    );
    expect(guard).toContain(
      "new.analysis_digest is distinct from public.risk_uncertainty_analysis_digest",
    );
    expect(guard).toContain("old.input_binding_snapshot");
    expect(bindings).toContain("if tg_op<>'INSERT' then");
    expect(bindings).toContain("a.status='pending_review'");
    expect(bindings).toContain("a.analysis_digest=repeat('0',64)");
    expect(bindings).toContain("e.verification_status='verified'");
  });
});
