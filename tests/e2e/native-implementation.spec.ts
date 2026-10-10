import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

// Existing seeded login only; no credentials, external purchases or customer data.
// This spec changes fixture membership only in the fresh loopback Supabase stack.
const org = randomUUID();
const other = randomUUID();
const user = "00000000-0000-0000-0000-000000000001";
const billing = randomUUID();
const manager = "00000000-0000-0000-0000-000000000003";
const asset = randomUUID();
const template = randomUUID();
const mapping = randomUUID();
// Credentials are supplied only by the disposable-stack runner, never embedded.
function fixture(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Disposable fixture unavailable: ${name}`);
  return value;
}
test.use({ trace: "off" }); // Do not retain authenticated requests or password inputs.
const outcome = "Synthetic browser interruption qualification";
function sql(statement: string) {
  if (
    process.env.E2E_SUPABASE_URL &&
    process.env.E2E_SUPABASE_URL !== "http://127.0.0.1:54321"
  )
    throw new Error("Refusing non-loopback fixture");
  return execFileSync(
    "psql",
    [
      "-h",
      "127.0.0.1",
      "-p",
      "54322",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      "-c",
      statement,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, PGPASSWORD: fixture("E2E_FIXTURE_DB_PASSWORD") },
    },
  ).trim();
}
test("real signed-in preparation rollback/retry, interruption and tenant isolation", async ({
  page,
}) => {
  sql(`insert into organizations(id,name) values ('${org}','Synthetic browser fixture'),('${other}','Other browser fixture') on conflict(id) do nothing;
    insert into billing_subscriptions(id,organization_id,plan,status,billing_source) values ('${billing}','${org}','synthetic_browser','active','direct') on conflict(id) do nothing;
    insert into billing_subscriptions(organization_id,plan,status,billing_source) values ('${other}','synthetic_other','active','direct');
    update user_profiles set organization_id='${org}',role='admin' where id='${user}';`);
  try {
    await page.goto("/signin");
    await page
      .getByRole("textbox", { name: /work email/i })
      .fill("demo@syncai.ca");
    await page
      .locator('input[type="password"]')
      .fill(fixture("E2E_FIXTURE_ADMIN_PASSWORD"));
    await page.getByRole("button", { name: /access syncai/i }).click();
    await expect(
      page.getByRole("heading", { name: "Mission Control" }),
    ).toBeVisible();
    await page.goto("/deployments/new/configure?implementation=1");
    await expect(page.getByLabel("Subscription")).toBeVisible();
    await page.getByLabel("Subscription").selectOption(billing);
    await page.getByLabel("Intended outcome").fill(outcome);
    // Let the actual authenticated RPC commit, then lose only its response.
    await page.route(
      "**/rest/v1/rpc/command_implementation",
      async (route) => {
        const response = await route.fetch();
        expect(response.ok()).toBeTruthy();
        await route.abort("failed");
      },
      { times: 1 },
    );
    await page
      .getByRole("button", { name: "Start or resume purchased implementation" })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry retained command" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Reload retained status" }).click();
    await expect(
      page.getByText(`${outcome} — planning`, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Retry retained command" }),
    ).toHaveCount(0);
    const id = sql(
      `select id from deployment_instances where implementation_billing_id='${billing}'`,
    );
    await page.reload();
    await expect(
      page.getByText(`${outcome} — planning`, { exact: true }),
    ).toBeVisible();
    await page.getByLabel("Subscription").selectOption(billing);
    await page.getByLabel("Intended outcome").fill(outcome);
    const duplicate = page.waitForResponse((response) =>
      response.url().endsWith("/rpc/command_implementation"),
    );
    await page
      .getByRole("button", { name: "Start or resume purchased implementation" })
      .click();
    expect((await duplicate).ok()).toBeTruthy();
    await expect(
      page.getByText(`${outcome} — planning`, { exact: true }),
    ).toBeVisible();
    expect(
      sql(
        `select count(*) from deployment_instances where implementation_billing_id='${billing}'`,
      ),
    ).toBe("1");
    expect(
      sql(`select count(*) from assets where organization_id='${org}'`),
    ).toBe("0");
    // Explicit disposable fixture input; the journey never creates customer assets.
    sql(`update user_profiles set organization_id='${org}' where id='${manager}';
      insert into assets(id,organization_id,tag,name,asset_class,area) values ('${asset}','${org}','BROWSER-FIX','Synthetic browser asset','Pump','Fixture area');
      insert into asset_twin_templates(id,template_key,version,asset_family,asset_class,title,maturity,template) values ('${template}','synthetic-browser-${template}','1','Rotating','Pump','Synthetic browser template','approved','{"synthetic":true}');
      insert into evidence_items(id,organization_id,asset_id,evidence_type,evidence_class,description) values ('${mapping}','${org}','${asset}','mapping','DOCUMENTED','Synthetic qualification mapping only');`);
    const anon = fixture("E2E_SUPABASE_ANON_KEY");
    const login = await page.request.post(
      "http://127.0.0.1:54321/auth/v1/token?grant_type=password",
      {
        headers: { apikey: anon },
        data: {
          email: "manager@syncai.ca",
          password: fixture("E2E_FIXTURE_REVIEWER_PASSWORD"),
        },
      },
    );
    expect(login.ok()).toBeTruthy();
    const session = await login.json();
    const verified = await page.request.post(
      "http://127.0.0.1:54321/rest/v1/rpc/verify_evidence_item",
      {
        headers: {
          apikey: anon,
          Authorization: `Bearer ${session.access_token}`,
        },
        data: {
          p_evidence_id: mapping,
          p_method: "Synthetic fixture review",
          p_outcome: "verified",
          p_note: "Qualification only; no customer claim",
        },
      },
    );
    expect(verified.ok()).toBeTruthy();
    expect((await verified.json()).error).toBeUndefined();
    await page.getByRole("button", { name: "Reload retained status" }).click();
    await page.getByText(`${outcome} — planning`, { exact: true }).click();
    await page
      .getByLabel("Customer asset", { exact: true })
      .selectOption(asset);
    await page
      .getByLabel("Approved twin template", { exact: true })
      .selectOption(template);
    await page
      .getByLabel("Verified mapping evidence", { exact: true })
      .selectOption(mapping);
    await page.getByRole("button", { name: "Add mapped asset" }).click();
    await page.getByRole("button", { name: "Retain reviewed scope" }).click();
    await expect(
      page.getByRole("button", { name: "Dry-run preparation", exact: true }),
    ).toBeVisible();
    const dryRun = page.waitForResponse((r) =>
      r.url().endsWith("/rpc/command_implementation"),
    );
    await page
      .getByRole("button", { name: "Dry-run preparation", exact: true })
      .click();
    expect((await dryRun).ok()).toBeTruthy();
    expect(
      sql(
        `select count(*) from asset_twin_instances where asset_id='${asset}'`,
      ),
    ).toBe("0");
    const runs = sql(
      `select count(*) from asset_onboarding_runs where asset_id='${asset}'`,
    );
    sql(`create or replace function browser_fixture_fault() returns trigger language plpgsql as $$ begin if new.asset_id='${asset}'::uuid then raise exception 'Synthetic browser write failure'; end if; return new; end $$;
      create trigger browser_fixture_fault before insert on asset_onboarding_runs for each row execute function browser_fixture_fault();`);
    await page
      .getByRole("button", { name: "Prepare drafts using existing services" })
      .click();
    await expect(
      page.getByText(`${outcome} — failed`, { exact: true }),
    ).toBeVisible();
    expect(
      sql(
        `select count(*) from asset_twin_instances where asset_id='${asset}'`,
      ),
    ).toBe("0");
    expect(
      sql(
        `select count(*) from asset_onboarding_runs where asset_id='${asset}'`,
      ),
    ).toBe(runs);
    sql(
      "drop trigger browser_fixture_fault on asset_onboarding_runs; drop function browser_fixture_fault()",
    );
    await page.reload();
    await page.getByText(`${outcome} — failed`, { exact: true }).click();
    await page.getByRole("button", { name: "Resume for fresh review" }).click();
    await expect(
      page.getByText(`${outcome} — planning`, { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Prepare drafts using existing services" })
      .click();
    await expect(
      page.getByText(`${outcome} — prepared`, { exact: true }),
    ).toBeVisible();
    expect(
      sql(
        `select count(*) from asset_twin_instances where asset_id='${asset}'`,
      ),
    ).toBe("1");
    expect(
      Number(
        sql(
          `select count(*) from asset_onboarding_runs where asset_id='${asset}'`,
        ),
      ),
    ).toBeGreaterThan(Number(runs));
    expect(
      sql(`select count(*) from assets where organization_id='${org}'`),
    ).toBe("1");
    expect(
      sql(`select count(*) from sensors where organization_id='${org}'`),
    ).toBe("0");
    await expect(
      page.getByRole("button", {
        name: "First-result approval awaits canonical evidence qualification",
      }),
    ).toBeDisabled();
    sql(
      `update user_profiles set organization_id='${other}' where id='${user}'`,
    );
    await page.getByRole("button", { name: "Reload retained status" }).click();
    await expect(
      page.getByText(`${outcome} — prepared`, { exact: true }),
    ).toHaveCount(0);
    sql(`update user_profiles set organization_id='${org}' where id='${user}'`);
    await page.getByRole("button", { name: "Reload retained status" }).click();
    await expect(
      page.getByText(`${outcome} — prepared`, { exact: true }),
    ).toBeVisible();
    expect(
      sql(
        `select id from deployment_instances where implementation_billing_id='${billing}'`,
      ),
    ).toBe(id);
    sql(`update user_profiles set role='planner' where id='${user}'`);
    await page.getByRole("button", { name: "Reload retained status" }).click();
    await expect(
      page.getByText(`${outcome} — prepared`, { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Subscription")).toHaveCount(0);
  } finally {
    sql(
      "drop trigger if exists browser_fixture_fault on asset_onboarding_runs; drop function if exists browser_fixture_fault()",
    );
    sql(
      `update user_profiles set organization_id='11111111-1111-1111-1111-111111111111' where id='${manager}'`,
    );
    sql(
      `update user_profiles set organization_id='11111111-1111-1111-1111-111111111111',role='reliability_engineer' where id='${user}'`,
    );
  }
});
