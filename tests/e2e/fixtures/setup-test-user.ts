/**
 * Creates a test user in the local Supabase instance for E2E tests.
 *
 * Run after `supabase start` and before Playwright:
 *   npx tsx tests/e2e/fixtures/setup-test-user.ts
 *
 * Creates:
 *   1. Auth user (test@syncai.test / Test1234!)
 *   2. user_profiles row (organization = Axium Industrial demo org)
 *   3. user_role_assignments row (maintenance_manager role)
 *
 * Idempotent — safe to run multiple times.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || "http://localhost:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const TEST_EMAIL = "test@syncai.test";
const TEST_PASSWORD = "Test1234!";
const DEMO_ORG_ID = "00000000-0000-0000-0000-000000000001";

export const TEST_USER = { email: TEST_EMAIL, password: TEST_PASSWORD };

async function main() {
  const headers = {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };

  // 1. Create auth user (skip if exists)
  console.log("[setup] Creating auth user...");
  const authRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
      email_confirm: true,
    }),
  });

  let userId: string;
  if (authRes.ok) {
    const authData = await authRes.json();
    userId = authData.id;
    console.log(`[setup] Auth user created: ${userId}`);
  } else {
    // User likely exists — look them up
    const listRes = await fetch(
      `${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=50`,
      { headers },
    );
    const listData = await listRes.json();
    const existing = listData.users?.find(
      (u: { email: string }) => u.email === TEST_EMAIL,
    );
    if (!existing) {
      console.error("[setup] Failed to create or find test user");
      process.exit(1);
    }
    userId = existing.id;
    console.log(`[setup] Auth user already exists: ${userId}`);
  }

  // 2. Upsert user_profiles row
  console.log("[setup] Upserting user_profiles...");
  const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles`, {
    method: "POST",
    headers: {
      ...headers,
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify({
      id: userId,
      organization_id: DEMO_ORG_ID,
      full_name: "E2E Test User",
      email: TEST_EMAIL,
      status: "active",
    }),
  });
  console.log(`[setup] user_profiles: ${profileRes.status}`);

  // 3. Ensure maintenance_manager role exists and assign
  console.log("[setup] Assigning maintenance_manager role...");

  // Find the role
  const roleRes = await fetch(
    `${SUPABASE_URL}/rest/v1/roles?code=eq.maintenance_manager&select=id&limit=1`,
    { headers },
  );
  const roles = await roleRes.json();

  if (roles.length > 0) {
    const roleId = roles[0].id;

    // Upsert role assignment (check for existing first)
    const existingAssignment = await fetch(
      `${SUPABASE_URL}/rest/v1/user_role_assignments?user_id=eq.${userId}&role_id=eq.${roleId}&select=id&limit=1`,
      { headers },
    );
    const existing = await existingAssignment.json();

    if (existing.length === 0) {
      await fetch(`${SUPABASE_URL}/rest/v1/user_role_assignments`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          user_id: userId,
          organization_id: DEMO_ORG_ID,
          role_id: roleId,
          is_primary: true,
        }),
      });
      console.log(`[setup] Role assigned: maintenance_manager`);
    } else {
      console.log(`[setup] Role already assigned`);
    }
  } else {
    console.warn(
      "[setup] maintenance_manager role not found — run seeds first",
    );
  }

  console.log("[setup] Test user ready.");
}

main().catch((err) => {
  console.error("[setup] Fatal:", err);
  process.exit(1);
});
