import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const script = fs.readFileSync(
  path.resolve(__dirname, "../../scripts/configure-production-auth.mjs"),
  "utf8",
);
const workflow = fs.readFileSync(
  path.resolve(__dirname, "../../.github/workflows/deploy-migrations.yml"),
  "utf8",
);

describe("production Auth deployment contract", () => {
  it("pins the hosted Auth site and recovery route to app.syncai.ca", () => {
    expect(script).toContain('process.env.APP_URL ?? "https://app.syncai.ca"');
    expect(script).toContain('const recoveryUrl = `${appUrl}/signin?mode=recovery`');
    expect(script).toContain("site_url: appUrl");
    expect(script).toContain("uri_allow_list");
  });

  it("uses Supabase Management API and verifies the result after applying it", () => {
    expect(script).toContain("https://api.supabase.com/v1/projects/");
    expect(script).toContain('await request("GET")');
    expect(script).toContain('await request("PATCH", patch)');
    expect(script.match(/await request\("GET"\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(script).toContain("Production Auth verification failed");
  });

  it("brands password recovery and can wire custom SMTP without logging secrets", () => {
    expect(script).toContain('mailer_subjects_recovery: "Reset your SyncAI password"');
    expect(script).toContain('smtp_admin_email: "security@syncai.ca"');
    expect(script).toContain('smtp_sender_name: "SyncAI Security"');
    expect(script).toContain('smtp_host: "smtp.resend.com"');
    expect(script).not.toContain("console.log(resendKey");
    expect(script).not.toContain("console.warn(resendKey");
    expect(script).not.toContain("console.error(resendKey");
    expect(script).not.toContain("${resendKey}");
  });

  it("runs as a protected production-deploy gate and triggers when its own contract changes", () => {
    expect(workflow).toContain('"scripts/configure-production-auth.mjs"');
    expect(workflow).toContain('".github/workflows/deploy-migrations.yml"');
    expect(workflow).toContain("Configure and verify production Auth");
    expect(workflow).toContain("node scripts/configure-production-auth.mjs");
    expect(workflow).toContain("SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}");
    expect(workflow).toContain("RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}");
  });
});
