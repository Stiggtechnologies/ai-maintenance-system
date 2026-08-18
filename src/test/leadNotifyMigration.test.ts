/**
 * The lead-notify migration, asserted as text — the same idiom
 * pilotLeadsAdminOnly.test.ts uses for the RLS policies.
 *
 * WHY TEXT. CI's `migrations` job proves the chain applies end-to-end against
 * a live Postgres, but "it applied" is not the property that matters here.
 * What matters is that this migration can never cost us the lead it exists to
 * save: the dispatch must be fail-soft, the trigger must be AFTER INSERT (a
 * BEFORE trigger that raised would abort the insert), the config RPC must stay
 * service-role-only, and no key may ever be committed to the file. Those are
 * properties of the DDL, and this is the locally-runnable guard that they hold.
 *
 * Every guard below is mutation-checked: the same predicate that passes the
 * shipped migration is shown to REJECT a weakened version — a handler that
 * re-raises, a BEFORE trigger, a grant to authenticated, a committed key. If a
 * future edit introduced any of those, the guard — and this test — would fail.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH =
  "supabase/migrations/20260914090000_lead_notify_trigger.sql";
const migration = readFileSync(MIGRATION_PATH, "utf8");

// The executable DDL with `--` line comments stripped, so assertions about
// what the migration DOES are never satisfied by prose in its header — which
// deliberately discusses the very failure modes being guarded against.
const executable = migration
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

const lower = executable.toLowerCase();

/** The plpgsql body of a named function, from its `as $$` to the closing `$$`. */
function functionBody(name: string, source = executable): string {
  const anchor = `create or replace function public.${name}`;
  const start = source.toLowerCase().indexOf(anchor);
  expect(start, `${anchor} not found`).toBeGreaterThan(-1);
  const open = source.indexOf("$$", start);
  expect(open, `body opener not found for ${name}`).toBeGreaterThan(-1);
  const close = source.indexOf("$$", open + 2);
  expect(close, `body terminator not found for ${name}`).toBeGreaterThan(-1);
  return source.slice(open + 2, close);
}

/** The `create trigger <name> …;` statement text. */
function triggerStatement(name: string, source = executable): string {
  const anchor = `create trigger ${name}`;
  const start = source.toLowerCase().indexOf(anchor);
  expect(start, `${anchor} not found`).toBeGreaterThan(-1);
  const end = source.indexOf(";", start);
  expect(end, `unterminated trigger ${name}`).toBeGreaterThan(-1);
  return source.slice(start, end).toLowerCase().replace(/\s+/g, " ");
}

/**
 * True only when the body cannot abort its caller: it has a `when others`
 * handler, that handler hands control back with `return new`, and it does not
 * re-raise. `raise warning` / `raise notice` are fine — they log. A bare
 * `raise;` or a `raise exception` would propagate and roll back the INSERT.
 */
function isFailSoft(body: string): boolean {
  const text = body.toLowerCase();
  const handlerAt = text.indexOf("exception when others then");
  if (handlerAt === -1) return false;
  const handler = text.slice(handlerAt);
  if (!/\breturn new\b/.test(handler)) return false;
  if (/\braise\s+exception\b/.test(handler)) return false;
  // A bare `raise;` re-throws the caught error.
  if (/\braise\s*;/.test(handler)) return false;
  return true;
}

/** True only for an AFTER INSERT, FOR EACH ROW trigger on the leads table. */
function isAfterInsertRowTrigger(statement: string): boolean {
  const text = statement.replace(/\s+/g, " ").toLowerCase();
  if (!/after insert on public\.pilot_intake_requests/.test(text)) return false;
  if (!/for each row/.test(text)) return false;
  if (/\bbefore\b/.test(text)) return false;
  if (/for each statement/.test(text)) return false;
  if (/\b(update|delete|truncate)\b/.test(text)) return false;
  return true;
}

/** True only when every EXECUTE grant in the SQL targets service_role alone. */
function grantsAreServiceRoleOnly(source: string): boolean {
  const grants = [
    ...source
      .toLowerCase()
      .matchAll(/grant\s+execute\s+on\s+function[^;]*?\bto\s+([^;]+);/g),
  ];
  if (grants.length === 0) return false;
  return grants.every(
    (match) =>
      match[1]
        .split(",")
        .map((role) => role.trim())
        .filter(Boolean)
        .join(",") === "service_role",
  );
}

const SECRET_SHAPES: ReadonlyArray<[string, RegExp]> = [
  ["supabase JWT", /\beyJ[A-Za-z0-9_-]{10,}/],
  ["supabase api key", /\bsb_(secret|publishable)_[A-Za-z0-9_-]{8,}/],
  ["resend key", /\bre_[A-Za-z0-9]{16,}/],
  ["twilio account sid", /\bAC[0-9a-fA-F]{32}\b/],
  ["twilio api key", /\bSK[0-9a-fA-F]{32}\b/],
  ["openai-style key", /\bsk-[A-Za-z0-9]{16,}/],
  // Any long unbroken token inside a quoted literal — the generic shape of a
  // pasted credential, which the legitimate literals here (all prose or SQL)
  // never match because they contain spaces.
  ["opaque literal", /'[A-Za-z0-9+/_=-]{32,}'/],
];

/** True when no committed credential of any known shape is present. */
function hasNoSecretLiteral(source: string): boolean {
  return SECRET_SHAPES.every(([, pattern]) => !pattern.test(source));
}

// ---------------------------------------------------------------------------

describe("lead-notify migration — the dispatch cannot cost us the lead", () => {
  it("hooks the insert AFTER the row is committed, once per row", () => {
    expect(
      isAfterInsertRowTrigger(triggerStatement("trg_pilot_intake_notify")),
    ).toBe(true);
  });

  it("fires the notifier through pg_net with just the lead id", () => {
    const body = functionBody("on_pilot_intake_created");
    expect(body).toContain("net.http_post");
    expect(body.toLowerCase()).toContain(
      "jsonb_build_object('lead_id', new.id)",
    );
    // The key is read from config at call time, never embedded.
    expect(body).toContain("'Bearer ' || cfg.service_key");
  });

  it("swallows every dispatch error and lets the lead commit", () => {
    expect(isFailSoft(functionBody("on_pilot_intake_created"))).toBe(true);
  });

  it("no-ops silently until it is configured", () => {
    const body = functionBody("on_pilot_intake_created").toLowerCase();
    expect(body).toContain("private.lead_notify_config");
    expect(body).toMatch(/if cfg\.function_url is null[\s\S]*?return new;/);
  });

  it("mutation-sanity — the fail-soft guard rejects anything that can propagate", () => {
    const shipped = functionBody("on_pilot_intake_created");
    expect(isFailSoft(shipped)).toBe(true);

    // No handler at all: any pg_net error aborts the INSERT and the lead is lost.
    expect(isFailSoft("begin perform net.http_post(); return new; end")).toBe(
      false,
    );

    // A handler that re-raises is not a handler.
    expect(
      isFailSoft("begin perform 1; exception when others then raise; end"),
    ).toBe(false);
    expect(
      isFailSoft(
        "begin perform 1; exception when others then raise exception 'notify failed'; end",
      ),
    ).toBe(false);

    // A handler that logs but never hands control back.
    expect(
      isFailSoft("begin perform 1; exception when others then null; end"),
    ).toBe(false);

    // Logging and returning is exactly right.
    expect(
      isFailSoft(
        "begin perform 1; exception when others then raise warning 'x'; return new; end",
      ),
    ).toBe(true);
  });

  it("mutation-sanity — the trigger guard rejects any other timing or scope", () => {
    expect(
      isAfterInsertRowTrigger(
        "create trigger t before insert on public.pilot_intake_requests for each row execute function f()",
      ),
    ).toBe(false);
    expect(
      isAfterInsertRowTrigger(
        "create trigger t after insert on public.pilot_intake_requests for each statement execute function f()",
      ),
    ).toBe(false);
    expect(
      isAfterInsertRowTrigger(
        "create trigger t after insert or update on public.pilot_intake_requests for each row execute function f()",
      ),
    ).toBe(false);
    expect(
      isAfterInsertRowTrigger(
        "create trigger t after insert on public.some_other_table for each row execute function f()",
      ),
    ).toBe(false);
  });
});

describe("lead-notify migration — the SLA clock", () => {
  it("adds first_response_due without disturbing existing rows", () => {
    expect(lower).toContain(
      "alter table public.pilot_intake_requests\n  add column if not exists first_response_due timestamptz;",
    );
  });

  it("encodes Alberta business hours, not a naive +1 hour", () => {
    const body = functionBody("business_hours_deadline");
    expect(body).toContain("America/Edmonton");
    expect(body.toLowerCase()).toContain("interval '8 hours'");
    expect(body.toLowerCase()).toContain("interval '17 hours'");
    // isodow 6/7 are Saturday and Sunday — the weekend must supply no hours.
    expect(body.toLowerCase()).toMatch(/extract\(isodow from v_day\) >= 6/);
  });

  it("sets the clock BEFORE insert, so the row the notifier reads already has it", () => {
    const statement = triggerStatement("trg_pilot_intake_first_response_due");
    expect(statement).toMatch(
      /before insert on public\.pilot_intake_requests for each row/,
    );
  });

  it("never lets a clock failure block the lead either", () => {
    const body = functionBody(
      "set_pilot_intake_first_response_due",
    ).toLowerCase();
    expect(body).toContain("exception when others then");
    expect(body).toMatch(/return new;/);
    expect(body).toContain("interval '1 hour'");
  });

  it("backfills every pre-existing lead, idempotently", () => {
    expect(lower).toMatch(
      /update public\.pilot_intake_requests\s+set first_response_due = public\.business_hours_deadline\(created_at, interval '1 hour'\)\s+where first_response_due is null;/,
    );
  });
});

describe("lead-notify migration — nothing is exposed", () => {
  it("keeps the function URL and calling key in the private schema", () => {
    expect(lower).toContain(
      "create table if not exists private.lead_notify_config",
    );
    // Never in public, where PostgREST would serve it.
    expect(lower).not.toMatch(/create table[^;]*public\.lead_notify_config/);
  });

  it("locks every function it defines to service_role", () => {
    expect(grantsAreServiceRoleOnly(executable)).toBe(true);
    for (const fn of [
      "configure_lead_notify(text, text)",
      "business_hours_deadline(timestamptz, interval)",
      "on_pilot_intake_created()",
      "set_pilot_intake_first_response_due()",
    ]) {
      expect(lower).toContain(
        `revoke execute on function public.${fn} from public, anon, authenticated;`,
      );
      expect(lower).toContain(
        `grant execute on function public.${fn} to service_role;`,
      );
    }
  });

  it("never echoes the configured key back to the caller", () => {
    const body = functionBody("configure_lead_notify");
    expect(body).toContain("jsonb_build_object('configured', true");
    expect(body).not.toContain("'service_key', p_service_key");
  });

  it("commits no credential of any shape", () => {
    // The whole file, comments included — a key pasted into a comment is still
    // a key in the repository.
    expect(hasNoSecretLiteral(migration)).toBe(true);
  });

  it("mutation-sanity — the secret scanner catches a pasted credential", () => {
    for (const sample of [
      "select 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';",
      "select 'sb_secret_abcdefgh12345678';",
      "select 're_1234567890abcdefghij';",
      "select 'sk-abcdefghijklmnopqrstuvwx';",
      "select 'AC0123456789abcdef0123456789abcd';",
      "select 'Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFy';",
    ]) {
      expect(hasNoSecretLiteral(sample)).toBe(false);
    }
    expect(
      hasNoSecretLiteral("select 'a perfectly ordinary sentence here';"),
    ).toBe(true);
  });

  it("mutation-sanity — the grant guard rejects a widened grant", () => {
    expect(
      grantsAreServiceRoleOnly(
        "grant execute on function public.configure_lead_notify(text, text) to service_role, authenticated;",
      ),
    ).toBe(false);
    expect(
      grantsAreServiceRoleOnly(
        "grant execute on function public.configure_lead_notify(text, text) to anon;",
      ),
    ).toBe(false);
    expect(
      grantsAreServiceRoleOnly(
        "grant execute on function public.configure_lead_notify(text, text) to service_role;",
      ),
    ).toBe(true);
  });

  it("does not touch the admin-only RLS the previous migration established", () => {
    expect(lower).not.toContain("create policy");
    expect(lower).not.toContain("drop policy");
    expect(lower).not.toContain("using (true)");
    expect(lower).not.toContain("disable row level security");
  });
});

describe("lead-notify migration — realtime is added safely", () => {
  it("puts the leads table in the publication so the LIVE badge is real", () => {
    expect(lower).toContain(
      "alter publication supabase_realtime add table public.pilot_intake_requests",
    );
    expect(lower).toContain(
      "alter table public.pilot_intake_requests replica identity full",
    );
  });

  it("is safe to re-run and safe where the publication does not exist", () => {
    expect(lower).toMatch(
      /if exists \(select 1 from pg_publication where pubname = 'supabase_realtime'\)/,
    );
    expect(lower).toContain("exception when duplicate_object then");
  });
});
