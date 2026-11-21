import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const migration = readFileSync(
  "supabase/migrations/20271110120000_verification_actioned_client_insert.sql",
  "utf8",
);

let db: PGlite;

function pgError(caught: unknown): { code?: string; message: string } {
  if (caught && typeof caught === "object") {
    const error = caught as { code?: string; message?: string };
    return { code: error.code, message: error.message ?? String(caught) };
  }
  return { message: String(caught) };
}

async function expectSqlstate(statement: string, code: string) {
  try {
    await db.exec(statement);
  } catch (caught) {
    const error = pgError(caught);
    expect(error.code ?? error.message).toContain(code);
    return;
  }
  throw new Error(`expected ${statement} to fail with ${code}`);
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create function public.app_current_org() returns uuid
    language sql stable as $$ select '${ORG}'::uuid $$;
    create function public.recommendation_verification_plan_valid(uuid, uuid)
    returns boolean language sql stable as $$ select false $$;
    create table public.recommendations (
      id uuid primary key,
      organization_id uuid not null,
      status text not null
    );
    alter table public.recommendations enable row level security;
    grant select, insert, update, delete on public.recommendations to authenticated;
    create policy recommendations_org_rw on public.recommendations
      for all to authenticated using (true) with check (true);
  `);
  await db.exec(migration);
});

afterAll(async () => {
  await db.close();
});

describe("C4.08 authenticated actioned-insert refusal", () => {
  it("lets an authenticated client insert a same-tenant pending draft", async () => {
    await db.exec(`
      set role authenticated;
      insert into public.recommendations(id, organization_id, status)
      values ('10000000-0000-4000-8000-000000000001', '${ORG}', 'pending');
      reset role;
    `);
    const rows = await db.query<{ status: string }>(
      "select status from public.recommendations where id='10000000-0000-4000-8000-000000000001'",
    );
    expect(rows.rows[0]?.status).toBe("pending");
  });

  it("refuses actioned statuses, including case and surrounding whitespace", async () => {
    const statuses = [
      "approved",
      "released",
      "scheduled",
      "completed",
      "Approved",
      "RELEASED",
      " scheduled ",
      "Completed",
    ];
    for (const [index, status] of statuses.entries()) {
      const id = `10000000-0000-4000-8000-00000000001${index}`;
      await expectSqlstate(
        `set role authenticated;
         insert into public.recommendations(id, organization_id, status)
         values ('${id}', '${ORG}', '${status}');
         reset role;`,
        "42501",
      );
      const rows = await db.query<{ n: number }>(
        `select count(*)::int as n from public.recommendations where id='${id}'`,
      );
      expect(rows.rows[0]?.n).toBe(0);
    }
  });

  it("refuses a pending draft aimed at another tenant", async () => {
    await expectSqlstate(
      `set role authenticated;
       insert into public.recommendations(id, organization_id, status)
       values ('10000000-0000-4000-8000-000000000099', '${OTHER}', 'pending');
       reset role;`,
      "42501",
    );
  });

  it("still lets the migration role insert an already actioned recommendation", async () => {
    await db.exec(`
      reset role;
      insert into public.recommendations(id, organization_id, status)
      values ('10000000-0000-4000-8000-000000000088', '${ORG}', 'Approved');
    `);
    const rows = await db.query<{ status: string }>(
      "select status from public.recommendations where id='10000000-0000-4000-8000-000000000088'",
    );
    expect(rows.rows[0]?.status).toBe("Approved");
  });

  it("requires a verification plan before a mixed-case release update", async () => {
    await db.exec(`
      reset role;
      insert into public.recommendations(id, organization_id, status)
      values ('10000000-0000-4000-8000-000000000077', '${ORG}', 'pending');
    `);
    await db.exec("grant execute on function public.enforce_recommendation_verification_plan_on_release() to authenticated");
    try {
      await db.exec(`
        set role authenticated;
        update public.recommendations
           set status='Approved'
         where id='10000000-0000-4000-8000-000000000077';
      `);
      throw new Error("mixed-case approval skipped the verification plan");
    } catch (caught) {
      const error = pgError(caught);
      expect(error.message.toLowerCase()).toContain("will not invent a +30-day");
    } finally {
      await db.exec("reset role");
    }
    const rows = await db.query<{ status: string }>(
      "select status from public.recommendations where id='10000000-0000-4000-8000-000000000077'",
    );
    expect(rows.rows[0]?.status).toBe("pending");
  });
});
