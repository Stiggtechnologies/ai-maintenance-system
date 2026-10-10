import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";

// Existing seeded login only; no credentials, external purchases or customer data.
// This spec changes fixture membership only in the fresh loopback Supabase stack.
const org = "82222222-2222-4222-8222-222222222222";
const other = "83333333-3333-4333-8333-333333333333";
const user = "00000000-0000-0000-0000-000000000001";
const billing = "81000000-0000-4000-8000-000000000001";
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
      env: { ...process.env, PGPASSWORD: "postgres" },
    },
  ).trim();
}
test("real signed-in interruption, duplicate start, tenant switch and non-admin denial", async ({
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
    await page.locator('input[type="password"]').fill("Demo123!@#");
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
    sql(
      `update user_profiles set organization_id='${other}' where id='${user}'`,
    );
    await page.getByRole("button", { name: "Reload retained status" }).click();
    await expect(
      page.getByText(`${outcome} — planning`, { exact: true }),
    ).toHaveCount(0);
    sql(`update user_profiles set organization_id='${org}' where id='${user}'`);
    await page.getByRole("button", { name: "Reload retained status" }).click();
    await expect(
      page.getByText(`${outcome} — planning`, { exact: true }),
    ).toBeVisible();
    expect(
      sql(
        `select id from deployment_instances where implementation_billing_id='${billing}'`,
      ),
    ).toBe(id);
    sql(`update user_profiles set role='planner' where id='${user}'`);
    await page.getByRole("button", { name: "Reload retained status" }).click();
    await expect(
      page.getByText(`${outcome} — planning`, { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Subscription")).toHaveCount(0);
  } finally {
    sql(
      `update user_profiles set organization_id='11111111-1111-1111-1111-111111111111',role='reliability_engineer' where id='${user}'`,
    );
  }
});
