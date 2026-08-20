/**
 * The Data Room migration, asserted as text.
 *
 * The property under guard is the one the whole engagement turns on: the
 * workspace must be able to say what has NOT arrived, and it must never be able
 * to grade itself. #231's data room was a list of uploaded files — a list of
 * what arrived cannot show what did not — and its `quality_grade` column
 * defaulted to a value the upload path set without a human anywhere near it.
 *
 * So the guards here are about the boundary between a MEASUREMENT and a
 * JUDGEMENT. Row counts, coverage dates and absent required fields are
 * measured and may be written by an upload. Green/Amber/Red is a statement to
 * a paying customer about whether their question is answerable, and it may
 * only be set by a named person with a stated reason. Each guard is
 * mutation-checked against the weakened form it exists to refuse.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "./support/migrationPolicies";

const DATA_ROOM_PATH = "supabase/migrations/20260920001000_ria_data_room.sql";
const SEED_PATH =
  "supabase/migrations/20260920002000_ria_sponsor_and_demo_assessment.sql";

const executable = stripComments(readFileSync(DATA_ROOM_PATH, "utf8"));
const lower = executable.toLowerCase();
const flat = lower.replace(/\s+/g, " ");
const seed = stripComments(readFileSync(SEED_PATH, "utf8")).toLowerCase();

function functionBody(name: string, source = executable): string {
  const anchor = `create or replace function public.${name}`;
  const start = source.toLowerCase().indexOf(anchor);
  expect(start, `${anchor} not found`).toBeGreaterThan(-1);
  const open = source.indexOf("$$", start);
  const close = source.indexOf("$$", open + 2);
  return source.slice(open + 2, close).toLowerCase();
}

describe("the dataset slots are the intake pack's, and they exist from birth", () => {
  it("carries every dataset the pack asks for, and nothing invented", () => {
    // The pack's §2 minimum-viable-data table: three required, three
    // preferred, plus the workbook's alias map.
    for (const key of [
      "asset_register",
      "work_orders",
      "pm_plans",
      "downtime_meter",
      "dealer_oem",
      "operating_measure",
      "alias_map",
    ]) {
      expect(flat, `slot ${key} missing`).toContain(`'${key}'`);
    }
  });

  it("keeps the keys the shipped workspace already writes", () => {
    // A rename would orphan every ria_data_sources row #231 created, whose
    // `category` holds exactly these strings.
    const source = readFileSync(
      "src/pages/RiaAssessmentWorkspacePage.tsx",
      "utf8",
    );
    expect(source).toBeTruthy();
    expect(flat).toContain("s.dataset_key = d.category");
  });

  it("marks the three the pack calls required as required", () => {
    for (const key of ["asset_register", "work_orders", "pm_plans"]) {
      const at = flat.indexOf(`'${key}', 'required'`);
      expect(at, `${key} is not required`).toBeGreaterThan(-1);
    }
    for (const key of ["downtime_meter", "dealer_oem", "operating_measure"]) {
      expect(flat, `${key} is not preferred`).toContain(
        `'${key}', 'preferred'`,
      );
    }
  });

  it("seeds the slots by trigger, so a new assessment is never slot-less", () => {
    expect(flat).toContain("create trigger trg_ria_seed_dataset_slots");
    expect(flat).toContain("after insert on public.ria_assessments");
    // …and backfills the assessments that already exist.
    expect(flat).toContain(
      "for r in select id from public.ria_assessments loop",
    );
  });
});

describe("a colour is a judgement, and the schema treats it as one", () => {
  it("readiness cannot be a colour without a rater and a reason", () => {
    expect(flat).toContain("ria_slot_rating_is_attributed");
    expect(flat).toMatch(
      /check\s*\(\s*readiness not in \('green','amber','red'\)\s*or\s*\(rated_by is not null and rated_at is not null and btrim\(coalesce\(readiness_note, ''\)\) <> ''\)/,
    );
  });

  it("the rating RPC refuses an observation dressed as a rating", () => {
    const body = functionBody("set_ria_dataset_readiness");
    expect(body).toMatch(/p_readiness not in \('green','amber','red'\)/);
    expect(body).toMatch(/btrim\(coalesce\(p_note, ''\)\) = ''/);
    // Engineering judgement, engineering roles.
    expect(body).toContain("'reliability_engineer'");
    expect(body).toContain("'maintenance_manager'");
    expect(body).not.toContain("'technician'");
  });

  it("an upload can advance a slot but can never colour one", () => {
    const body = functionBody("advance_ria_slot_on_source");
    // The only states an observation may produce.
    expect(body).toContain("'received'");
    expect(body).toContain("'profiled'");
    for (const colour of ["'green'", "'amber'", "'red'"]) {
      expect(
        body.includes(`= ${colour}`) || body.includes(`then ${colour}`),
        `the upload trigger assigns ${colour}`,
      ).toBe(false);
    }
  });

  it("re-uploading a file does not un-rate a dataset an engineer rated", () => {
    // `else s.readiness` is the branch that preserves the colour.
    const body = functionBody("advance_ria_slot_on_source").replace(
      /\s+/g,
      " ",
    );
    expect(body).toContain("when s.readiness = 'missing' then 'received'");
    expect(body).toContain("else s.readiness");
  });

  it("mutation-sanity — the guard rejects a trigger that sets a colour", () => {
    const shipped =
      "when s.readiness = 'missing' then 'received' else s.readiness end";
    const weakened = "when d.row_count > 0 then 'green' else s.readiness end";
    const colours = (sql: string) => /then '(green|amber|red)'/.test(sql);
    expect(colours(shipped)).toBe(false);
    expect(colours(weakened)).toBe(true);
  });

  // -------------------------------------------------------------------------
  // The cross-tenant write this trigger used to perform.
  // -------------------------------------------------------------------------

  it("resolves the slot from the assessment, never from the caller's slot_id", () => {
    // THE DEFECT. This function is SECURITY DEFINER, so its UPDATE runs with
    // RLS off, and the shipped version took `new.slot_id` verbatim whenever the
    // client supplied one — resolving safely ONLY in the NULL case.
    // ria_data_sources_org_insert validates organization_id and assessment_id
    // and never looks at slot_id, and table-level grants to `authenticated`
    // accept any column over PostgREST. An authenticated member of org B could
    // therefore insert a source entirely legal for org B carrying org A's slot
    // uuid and march org A's asset_register from 'missing' to 'received' — the
    // exact surface get_ria_readiness() shows the customer at kickoff.
    const body = functionBody("advance_ria_slot_on_source").replace(
      /\s+/g,
      " ",
    );
    // The resolve is unconditional, and it is keyed on columns RLS vouched for.
    expect(body).toMatch(
      /select id into v_slot from ria_dataset_slots where assessment_id = new\.assessment_id and organization_id = new\.organization_id and dataset_key = new\.category/,
    );
    // The declaration no longer seeds v_slot from the caller.
    expect(body).not.toMatch(/v_slot uuid := new\.slot_id/);
  });

  it("a supplied slot_id that disagrees is REFUSED, not silently corrected", () => {
    // Quietly overwriting a hostile input hides the attempt and teaches the
    // caller nothing. The raise is the record that it happened.
    const body = functionBody("advance_ria_slot_on_source").replace(
      /\s+/g,
      " ",
    );
    expect(body).toMatch(
      /new\.slot_id is not null and new\.slot_id is distinct from v_slot/,
    );
    expect(body).toContain("raise exception");
    expect(body).toContain("errcode = 'check_violation'");
  });

  it("the UPDATE re-states the tenancy predicate, so the write cannot stray", () => {
    // Belt and braces: even if v_slot were somehow wrong, the UPDATE touches
    // no row belonging to another assessment or another organization.
    const body = functionBody("advance_ria_slot_on_source").replace(
      /\s+/g,
      " ",
    );
    expect(body).toMatch(
      /where s\.id = v_slot and s\.assessment_id = new\.assessment_id and s\.organization_id = new\.organization_id/,
    );
  });

  it("mutation-sanity — the guard rejects the shipped trust-the-caller form", () => {
    const shipped =
      "declare v_slot uuid := new.slot_id; begin if v_slot is null then select id into v_slot from ria_dataset_slots where assessment_id = new.assessment_id and dataset_key = new.category; end if;";
    const fixed =
      "declare v_slot uuid; begin select id into v_slot from ria_dataset_slots where assessment_id = new.assessment_id and organization_id = new.organization_id and dataset_key = new.category; if new.slot_id is not null and new.slot_id is distinct from v_slot then raise exception 'x'; end if;";
    const trustsCaller = (sql: string) =>
      /v_slot uuid := new\.slot_id/.test(sql);
    const refusesMismatch = (sql: string) =>
      /new\.slot_id is not null and new\.slot_id is distinct from v_slot/.test(
        sql,
      );
    expect(trustsCaller(shipped)).toBe(true);
    expect(refusesMismatch(shipped)).toBe(false);
    expect(trustsCaller(fixed)).toBe(false);
    expect(refusesMismatch(fixed)).toBe(true);
  });
});

describe("readiness is reported as the pack's four conditions, not a percentage", () => {
  const body = functionBody("get_ria_readiness");

  it("returns each condition of the §8 acceptance test separately", () => {
    for (const key of [
      "scope_confirmed",
      "asset_register_received",
      "work_orders_received",
      "primary_question_agreed",
      "gaps_explicitly_logged",
    ]) {
      expect(body, `${key} not reported`).toContain(`'${key}'`);
    }
  });

  it("data-ready means all four — there is no partial credit", () => {
    const normalised = body.replace(/\s+/g, " ");
    const at = normalised.indexOf("'kickoff_data_ready'");
    expect(at).toBeGreaterThan(-1);
    const clause = normalised.slice(at, at + 300);
    expect(clause).toContain("v_register_received");
    expect(clause).toContain("v_work_orders_received");
    expect(clause).toContain("v_question_agreed");
    expect(clause).toContain("v_gaps_logged");
    expect(clause).not.toContain(" or ");
  });

  it("a silent missing dataset is not a logged gap", () => {
    // "Known missing datasets are explicitly logged" (§8). A slot at 'missing'
    // with nothing said about it and no clarification raised is silence, and
    // the rollup says so.
    const normalised = body.replace(/\s+/g, " ");
    expect(normalised).toContain("btrim(coalesce(s.readiness_note, '')) = ''");
    expect(normalised).toContain("from ria_clarifications c");
    // Optional datasets are excluded: the alias map was never a dataset the
    // pack asks for, so its absence is not a gap anyone must account for.
    expect(normalised).toContain("s.requirement in ('required','preferred')");
  });

  it("resolves the organization from the session, never from an argument", () => {
    expect(body).toContain("app_current_org()");
    expect(body).toContain("and organization_id = v_org");
  });
});

describe("the clarification queue and the alias map keep their own honesty", () => {
  it("an answered clarification must actually carry an answer", () => {
    expect(flat).toContain("ria_clarification_answered_needs_answer");
    expect(flat).toMatch(
      /status <> 'answered'\s*or\s*\(btrim\(coalesce\(answer, ''\)\) <> '' and answered_by is not null and answered_at is not null\)/,
    );
  });

  it("answering is open to the sponsor, because it is the sponsor's job", () => {
    const body = functionBody("answer_ria_clarification");
    expect(body).toContain("app_can_supply_ria_sources()");
    // Answering twice is refused: the RPC only matches an OPEN row.
    expect(body).toContain("and status = 'open'");
  });

  it("a clarification that blocks analysis is a first-class flag", () => {
    expect(flat).toContain("blocks_analysis boolean not null default false");
    expect(functionBody("get_ria_readiness")).toContain(
      "open_blocking_clarifications",
    );
  });

  it("an alias claiming to be resolved must point at something", () => {
    expect(flat).toContain("ria_alias_resolved_needs_a_target");
    expect(flat).toMatch(
      /resolved = false\s*or\s*canonical_asset_id is not null\s*or\s*btrim\(coalesce\(canonical_asset_ref, ''\)\) <> ''/,
    );
  });

  it("an alias may only ever point at an asset in the caller's own org", () => {
    const body = functionBody("upsert_ria_asset_alias");
    expect(body).toMatch(
      /from assets\s+where id = p_canonical_asset_id and organization_id = v_org/,
    );
    expect(body).toContain("canonical asset not found in current organization");
  });
});

describe("profiling records measurements and nothing else", () => {
  const body = functionBody("record_ria_source_profile");

  it("writes coverage, completeness and the exceptions it found", () => {
    for (const column of [
      "row_count",
      "column_count",
      "identifier_coverage",
      "coverage_from",
      "coverage_to",
      "dq_exceptions",
      "missing_required_fields",
      "content_sha256",
    ]) {
      expect(body, `${column} not recorded`).toContain(column);
    }
  });

  it("advances status only as far as 'profiled', never to 'accepted'", () => {
    // Accepting a dataset is a human act; a parser reaching it would make the
    // acceptance step decorative.
    expect(body).toContain("when status = 'uploaded' then 'profiled'");
    expect(body).not.toContain("'accepted'");
  });

  it("cannot touch a retired source", () => {
    expect(body).toContain("and deleted_at is null");
  });

  it("coverage dates cannot be recorded backwards", () => {
    expect(flat).toContain("ria_source_coverage_is_ordered");
    expect(flat).toContain("ria_source_identifier_coverage_is_a_share");
  });
});

describe("tenancy of everything the data room adds", () => {
  it("every new table is org-scoped and every policy uses app_current_org()", () => {
    const tables = [
      "ria_dataset_slots",
      "ria_clarifications",
      "ria_asset_aliases",
    ];
    for (const table of tables) {
      expect(flat).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(flat).toMatch(
        new RegExp(
          `create policy ${table}_org_read on public\\.${table} for select to authenticated using \\(organization_id = public\\.app_current_org\\(\\)\\)`,
        ),
      );
    }
  });

  it("every new table carries a non-null organization_id FK", () => {
    const creates = [
      ...executable.matchAll(
        /create table if not exists public\.(\w+)\s*\(([\s\S]*?)\n\);/g,
      ),
    ];
    expect(creates.length).toBeGreaterThan(0);
    for (const [, table, columns] of creates) {
      expect(
        columns.toLowerCase().replace(/\s+/g, " "),
        `${table} has no non-null organization FK`,
      ).toContain(
        "organization_id uuid not null references public.organizations(id)",
      );
    }
  });

  it("no policy tolerates a null organization or uses using(true)", () => {
    const policies = [...executable.matchAll(/create policy[\s\S]*?;/gi)].map(
      (m) => m[0].toLowerCase().replace(/\s+/g, " "),
    );
    expect(policies.length).toBe(3);
    for (const policy of policies) {
      expect(policy).not.toMatch(/organization_id\s+is\s+null\s+or/);
      expect(policy).not.toMatch(/using\s*\(\s*true\s*\)/);
      // Read-only by policy; every write goes through a governed RPC.
      expect(policy).toContain("for select");
    }
  });

  it("no new function takes an organization uuid a caller could name", () => {
    const signatures = [
      ...executable.matchAll(
        /create or replace function public\.(\w+)\s*\(([^)]*)\)/gi,
      ),
    ];
    for (const [, name, args] of signatures) {
      if (!/uuid/i.test(args)) continue;
      expect(
        /(^|[^a-z])(p_)?(org|organization|tenant)/i.test(args),
        `${name} takes an organization uuid: ${args}`,
      ).toBe(false);
    }
  });

  it("every definer function pins its search_path, and anon is revoked", () => {
    const definers = [
      ...executable.matchAll(
        /create or replace function public\.\w+[\s\S]*?(?=as \$\$)/gi,
      ),
    ]
      .map((m) => m[0].toLowerCase())
      .filter((d) => d.includes("security definer"));
    expect(definers.length).toBeGreaterThan(5);
    for (const definer of definers) {
      expect(definer).toContain("set search_path = public");
    }
    for (const fn of [
      "record_ria_source_profile",
      "set_ria_dataset_readiness",
      "open_ria_clarification",
      "answer_ria_clarification",
      "upsert_ria_asset_alias",
      "get_ria_readiness",
    ]) {
      expect(lower, `${fn} is not revoked from public`).toContain(
        `revoke all on function public.${fn}`,
      );
    }
  });
});

describe("the sponsor role and the demo assessment", () => {
  it("the sponsor is a role value, provisioned server-side only", () => {
    expect(seed).toContain("'assessment_sponsor'");
    expect(seed).toContain("insert into user_profiles");
    // 20260910090000 pins role writes to the service role; there is no client
    // flow that mints one, and this migration does not add one.
    expect(seed).not.toContain("grant execute on function public.make_sponsor");
  });

  it("states the sponsor's containment limit instead of claiming containment", () => {
    const header = readFileSync(SEED_PATH, "utf8").toLowerCase();
    expect(header).toContain("menu visibility is not entitlement");
    expect(header).toContain("phase 2");
  });

  it("the demo assessment is mid-intake, with a finding the gate refuses", () => {
    // A seeded, fully published, all-green assessment would make every gate in
    // 20260920000000 look like decoration.
    expect(seed).toContain("'draft'");
    expect(seed).toContain("'high'");
    expect(seed).toContain("insert into ria_finding_evidence");
    // No decision is seeded against the high finding, so the publication gate
    // is demonstrably unsatisfied.
    expect(seed).not.toContain("insert into ria_decisions");
  });

  it("the demo ratings carry the reasons the constraint demands", () => {
    expect(seed).toContain("readiness_note =");
    expect(seed).toContain("rated_by = v_engineer");
  });

  it("is idempotent — re-running the chain does not duplicate the demo", () => {
    const conflicts = (seed.match(/on conflict/g) ?? []).length;
    expect(conflicts).toBeGreaterThan(6);
  });
});
