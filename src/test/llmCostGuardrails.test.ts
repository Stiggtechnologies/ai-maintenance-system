/**
 * LLM cost guardrails — proven at the layers that enforce them.
 *
 * Same idiom as pilotLeadsAdminOnly.test.ts: CI's `migrations` job proves the
 * SQL applies against a live Postgres; these are the locally-runnable guards
 * that the TEXT of the money-cap machinery cannot regress silently — the
 * quota gate stays fail-closed, the telemetry stays service-role-only, the
 * public rail's spend key stays server-derived, and no seeded price ever
 * loses its vendor source.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PUBLIC_ASSESSMENT_IP_DAILY_LIMIT,
  PUBLIC_DECISION_CASE_DAILY_LIMIT,
  PUBLIC_DECISION_CASE_IP_DAILY_LIMIT,
} from "../../supabase/functions/_shared/decision-case-chat";

const guardrails = readFileSync(
  "supabase/migrations/20260916000000_llm_cost_guardrails.sql",
  "utf8",
);
const sensorsIdx = readFileSync(
  "supabase/migrations/20260916001000_sensors_operating_loop_indexes.sql",
  "utf8",
);
const processor = readFileSync(
  "supabase/functions/ai-agent-processor/index.ts",
  "utf8",
);
const publicAgent = readFileSync(
  "supabase/functions/public-reliability-agent/index.ts",
  "utf8",
);
const loopEnrich = readFileSync(
  "supabase/functions/agent-loop-enrich/index.ts",
  "utf8",
);
const onboardingEnrich = readFileSync(
  "supabase/functions/onboarding-enrich/index.ts",
  "utf8",
);

/** Executable SQL with `--` line comments stripped. */
const executable = guardrails
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

/**
 * True only when the public rail's daily spend key is derived from the
 * server-observed client IP and from NOTHING the client can rotate for free
 * (browserId, user-agent) — and actually contains the IP.
 */
function ipKeyIsServerDerived(line: string): boolean {
  return (
    line.includes("clientAddress") &&
    !line.toLowerCase().includes("browserid") &&
    !line.toLowerCase().includes("user-agent")
  );
}

describe("private.llm_usage — the counting source", () => {
  it("creates the table with the telemetry columns", () => {
    expect(executable).toContain(
      "create table if not exists private.llm_usage",
    );
    for (const col of [
      "organization_id uuid",
      "fn text not null",
      "model text not null",
      "prompt_tokens integer not null",
      "completion_tokens integer not null",
      "created_at timestamptz not null",
    ]) {
      expect(executable).toContain(col);
    }
  });

  it("indexes the exact quota-check scan (organization_id, created_at)", () => {
    expect(executable).toMatch(
      /create index if not exists idx_llm_usage_org_created\s+on private\.llm_usage \(organization_id, created_at\)/,
    );
  });

  it("is RLS-enabled and revoked from every app role", () => {
    expect(executable).toContain(
      "alter table private.llm_usage enable row level security",
    );
    expect(executable).toContain(
      "revoke all on private.llm_usage from public, anon, authenticated",
    );
  });
});

describe("private.llm_prices — no invented rates", () => {
  it("every seeded row carries a vendor source URL", () => {
    // The VALUES block of the seed insert: each row tuple must cite https://.
    const insertAt = executable.indexOf("insert into private.llm_prices");
    expect(insertAt).toBeGreaterThan(-1);
    const block = executable.slice(
      insertAt,
      executable.indexOf("on conflict (model)", insertAt),
    );
    const rows = block.match(/\('(?:gpt|grok)[\s\S]*?'\)/g) ?? [];
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const row of rows) {
      expect(row).toContain("https://");
      // and the FX source, since the column is CAD
      expect(row).toContain("Bank of Canada");
    }
  });

  it("is revoked from every app role", () => {
    expect(executable).toContain(
      "revoke all on private.llm_prices from public, anon, authenticated",
    );
  });
});

describe("check_llm_quota — the money cap", () => {
  it("exists, and only service_role can execute it", () => {
    expect(executable).toContain(
      "create or replace function public.check_llm_quota(",
    );
    expect(executable).toContain(
      "revoke execute on function public.check_llm_quota(uuid, text, text, bigint) from public, anon, authenticated",
    );
    expect(executable).toContain(
      "grant execute on function public.check_llm_quota(uuid, text, text, bigint) to service_role",
    );
  });

  it("is an atomic check-AND-RESERVE: advisory lock, then reservation insert", () => {
    // The burst hole this closes: N concurrent requests all reading the
    // same pre-insert totals and all passing. The per-org advisory xact
    // lock serializes gate evaluation, and the reservation row makes each
    // approved call visible to the next gate BEFORE any usage is recorded.
    expect(executable).toContain("pg_advisory_xact_lock");
    expect(executable).toMatch(
      /pg_advisory_xact_lock\(\s*hashtextextended\('llm_quota:' \|\| p_organization_id::text/,
    );
    // Reservation insert happens inside the gate, before it returns allowed.
    const gateBody = executable.slice(
      executable.indexOf("create or replace function public.check_llm_quota("),
      executable.indexOf("create or replace function public.record_llm_usage("),
    );
    expect(gateBody).toContain("insert into private.llm_usage");
    expect(gateBody).toContain("returning id into v_reservation_id");
    expect(gateBody).toContain("'reservation_id', v_reservation_id");
    // The estimate participates in the token check, so the cap bounds what
    // the approved call COULD spend.
    expect(gateBody).toContain("v_tokens + v_estimate > v_max_tokens");
  });

  it("release_llm_reservation deletes only OPEN reservations and is service-role-only", () => {
    expect(executable).toContain(
      "create or replace function public.release_llm_reservation(",
    );
    const releaseBody = executable.slice(
      executable.indexOf(
        "create or replace function public.release_llm_reservation(",
      ),
    );
    // Settled rows (actual spend) can never be un-counted.
    expect(releaseBody).toMatch(
      /delete from private\.llm_usage\s+where id = p_reservation_id\s+and reserved = true/,
    );
    expect(executable).toContain(
      "revoke execute on function public.release_llm_reservation(bigint) from public, anon, authenticated",
    );
    expect(executable).toContain(
      "grant execute on function public.release_llm_reservation(bigint) to service_role",
    );
  });

  it("carries the sized defaults from the documented arithmetic", () => {
    // 6 proactive passes x 288 five-minute ticks x 3 headroom = 5,184.
    expect(guardrails).toContain("5184");
    // ~7.384M legitimate tokens/day x 3 ~= 22M.
    expect(guardrails).toContain("22000000");
    // The arithmetic itself must stay in the migration, not just the numbers.
    expect(guardrails).toMatch(/6 passes x 288 ticks\/day = 1,728/);
  });

  it("counts the current UTC day and reports the reset instant", () => {
    expect(executable).toContain("date_trunc('day', now() at time zone 'utc')");
    expect(executable).toContain("'resets_at', v_resets_at");
  });

  it("refuses a null organization outright", () => {
    expect(executable).toMatch(
      /if p_organization_id is null then\s*[\s\S]{0,200}'allowed', false/,
    );
  });
});

describe("record_llm_usage — service-role-only telemetry", () => {
  it("exists and is locked to service_role", () => {
    expect(executable).toContain(
      "create or replace function public.record_llm_usage(",
    );
    expect(executable).toContain(
      "revoke execute on function public.record_llm_usage(uuid, text, text, integer, integer, bigint) from public, anon, authenticated",
    );
    expect(executable).toContain(
      "grant execute on function public.record_llm_usage(uuid, text, text, integer, integer, bigint) to service_role",
    );
    // Settling an already-settled or released reservation still counts the
    // call (falls through to a plain insert) — spend is never dropped.
    const recordBody = executable.slice(
      executable.indexOf("create or replace function public.record_llm_usage("),
      executable.indexOf(
        "create or replace function public.release_llm_reservation(",
      ),
    );
    expect(recordBody).toContain("and reserved = true");
    expect(recordBody).toContain("insert into private.llm_usage");
  });
});

describe("ai-agent-processor — gate before spend, fail closed", () => {
  it("checks the quota BEFORE the model call in the legacy handler", () => {
    const handler = processor.slice(
      processor.indexOf("async function handleLegacy"),
      processor.indexOf("function buildTypedPrompts"),
    );
    const gateAt = handler.indexOf("checkOrgQuota");
    const modelCallAt = handler.indexOf("callLLM(");
    const publicCallAt = handler.indexOf("callPublicReliabilityEngineer(");
    expect(gateAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(modelCallAt);
    expect(gateAt).toBeLessThan(publicCallAt);
  });

  it("checks the quota BEFORE the model call in the typed handler, after the idempotent replay", () => {
    const handler = processor.slice(
      processor.indexOf("async function handleTyped"),
      processor.indexOf("Deno.serve"),
    );
    const replayAt = handler.indexOf("idempotent_replay");
    const gateAt = handler.indexOf("checkOrgQuota");
    const modelCallAt = handler.indexOf("callLLM(");
    expect(replayAt).toBeGreaterThan(-1);
    expect(replayAt).toBeLessThan(gateAt);
    expect(gateAt).toBeLessThan(modelCallAt);
  });

  it("fails CLOSED with a distinct body when the quota cannot be read", () => {
    // 429 for over-budget, 503 quota_check_unavailable for infrastructure —
    // both refuse. A quota check that falls through to the model call on
    // error is the regression this guards against.
    expect(processor).toContain('"org_daily_quota_exceeded"');
    expect(processor).toContain('"quota_check_unavailable"');
    const gate = processor.slice(
      processor.indexOf("async function checkOrgQuota"),
      processor.indexOf("async function releaseQuotaReservation"),
    );
    // The catch path must return a refusal Response, never a passable
    // verdict (refusal: null = proceed).
    const catchArm = gate.slice(gate.indexOf("catch"));
    expect(catchArm).toContain("refusal: response(");
    expect(catchArm).toContain("503");
    expect(catchArm).not.toContain("refusal: null");
  });

  it("settles or releases every reservation — never drops one", () => {
    // Legacy handler: failed provider call releases before rethrowing.
    const legacy = processor.slice(
      processor.indexOf("async function handleLegacy"),
      processor.indexOf("function buildTypedPrompts"),
    );
    expect(legacy).toContain("releaseQuotaReservation");
    expect(legacy).toContain("quotaReservationId");
    // Typed handler: catch releases (no-op when already settled).
    const typed = processor.slice(
      processor.indexOf("async function handleTyped"),
      processor.indexOf("Deno.serve"),
    );
    expect(typed).toContain("releaseQuotaReservation");
    // Both record sites pass the reservation through for settlement.
    expect(
      processor.match(/recordLlmUsage\([^)]*quotaReservationId/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
  });

  it("records usage after both model paths, fail-soft", () => {
    expect(
      processor.match(/recordLlmUsage\(/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(3); // definition + legacy + typed
    const recorder = processor.slice(
      processor.indexOf("async function recordLlmUsage"),
      processor.indexOf("async function authenticate"),
    );
    expect(recorder).toContain("try {");
    expect(recorder).toContain("catch");
  });
});

describe("public rail — spend key is server-derived, browserId never sufficient", () => {
  it("derives the per-IP key without any client-supplied value", () => {
    const keyLine = publicAgent
      .split("\n")
      .find((line) => line.includes("const ipKey"));
    expect(keyLine).toBeDefined();
    expect(ipKeyIsServerDerived(keyLine ?? "")).toBe(true);
  });

  it("mutation sanity: a browserId-bearing IP key fails the same predicate", () => {
    // The exact regression that made spend unlimited: the daily key
    // incorporating a value the client can rotate for free. The predicate
    // that passes the shipped line must reject every rotatable variant.
    expect(
      ipKeyIsServerDerived(
        "const ipKey = await hmac(`ip|${mode}|${clientAddress}|${body.browserId}`);",
      ),
    ).toBe(false);
    expect(
      ipKeyIsServerDerived(
        'const ipKey = await hmac(`ip|${req.headers.get("user-agent")}`);',
      ),
    ).toBe(false);
    expect(
      ipKeyIsServerDerived("const ipKey = await hmac(`ip|${mode}`);"),
    ).toBe(false); // no IP at all is just a global counter, not an IP cap
  });

  it("consumes the per-browser allowance BEFORE the shared per-IP allowance", () => {
    // Deliberate order: a browser repeating past its own allowance must be
    // refused WITHOUT charging the shared IP counter, or one over-eager
    // visitor walks a NATed office's IP allowance to its cap (self-DoS).
    // The reverse leak costs nothing — both windows reset at the same UTC
    // midnight, and behind an exhausted IP no request can be served anyway.
    const ipAt = publicAgent.indexOf(
      '"consume_public_reliability_ip_allowance"',
    );
    const browserAt = publicAgent.indexOf(
      '"consume_public_reliability_allowance"',
    );
    expect(ipAt).toBeGreaterThan(-1);
    expect(browserAt).toBeGreaterThan(-1);
    expect(browserAt).toBeLessThan(ipAt);
  });

  it("derives the client address from a platform-set header, never the client-seedable XFF head", () => {
    // Proxies APPEND to x-forwarded-for, so entry [0] is whatever the
    // CLIENT sent: trusting it lets `curl -H "X-Forwarded-For: <random>"`
    // mint a fresh per-IP allowance per request — the exact unbounded-spend
    // hole the per-IP key exists to close. cf-connecting-ip is OVERWRITTEN
    // by the edge, and the LAST XFF hop is the one the trusted edge added.
    expect(publicAgent).not.toMatch(/x-forwarded-for"\)\?*\.split\(","\)\[0\]/);
    const derivation = publicAgent.slice(
      publicAgent.indexOf("const forwardedChain"),
      publicAgent.indexOf("const ipKey"),
    );
    const cfAt = derivation.indexOf("cf-connecting-ip");
    const xffLastAt = derivation.indexOf('.split(",").pop()');
    expect(cfAt).toBeGreaterThan(-1);
    expect(xffLastAt).toBeGreaterThan(-1);
    expect(cfAt).toBeLessThan(xffLastAt); // platform header preferred
  });

  it("fails closed (503) when either allowance RPC errors", () => {
    expect(
      publicAgent.match(/rate_limit_unavailable/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
  });

  it("per-IP caps are sized from the per-browser allowances and bounded", () => {
    // assessment: 1/browser/day x 5 NAT browsers; chat: 10/browser x 3.
    expect(PUBLIC_ASSESSMENT_IP_DAILY_LIMIT).toBe(5);
    expect(PUBLIC_DECISION_CASE_IP_DAILY_LIMIT).toBe(
      3 * PUBLIC_DECISION_CASE_DAILY_LIMIT,
    );
    expect(PUBLIC_DECISION_CASE_IP_DAILY_LIMIT).toBeLessThanOrEqual(100);
  });

  it("the IP allowance function caps p_limit at 100 and is service-role-only", () => {
    expect(executable).toContain(
      "create or replace function public.consume_public_reliability_ip_allowance",
    );
    expect(executable).toContain("p_limit < 1 or p_limit > 100");
    expect(executable).toContain(
      "revoke execute on function public.consume_public_reliability_ip_allowance(text, timestamptz, integer) from public, anon, authenticated",
    );
    expect(executable).toContain(
      "grant execute on function public.consume_public_reliability_ip_allowance(text, timestamptz, integer) to service_role",
    );
  });
});

describe("enrichment loops record usage fail-soft", () => {
  it("agent-loop-enrich inserts one llm_usage row per call inside try/catch", () => {
    expect(loopEnrich).toContain('"record_llm_usage"');
    const at = loopEnrich.indexOf('"record_llm_usage"');
    const window = loopEnrich.slice(Math.max(0, at - 400), at);
    expect(window).toContain("try {");
  });

  it("onboarding-enrich inserts one llm_usage row per chunk inside try/catch", () => {
    expect(onboardingEnrich).toContain('"record_llm_usage"');
    const at = onboardingEnrich.indexOf('"record_llm_usage"');
    const window = onboardingEnrich.slice(Math.max(0, at - 400), at);
    expect(window).toContain("try {");
  });
});

describe("sensors operating-loop indexes", () => {
  it("adds the three scanned-column indexes", () => {
    expect(sensorsIdx).toMatch(
      /create index if not exists idx_sensors_organization_id\s+on public\.sensors \(organization_id\)/,
    );
    expect(sensorsIdx).toMatch(
      /create index if not exists idx_sensors_asset_id\s+on public\.sensors \(asset_id\)/,
    );
    expect(sensorsIdx).toMatch(
      /create index if not exists idx_sensors_status\s+on public\.sensors \(status\)/,
    );
  });
});
