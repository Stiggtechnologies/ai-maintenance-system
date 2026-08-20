#!/usr/bin/env node

/**
 * Make hosted Supabase Auth configuration reproducible.
 *
 * Database migrations cannot configure hosted Auth URL settings, SMTP, or mail
 * templates. Those settings live behind the Supabase Management API, so they
 * must be deployed and verified alongside the rest of production instead of
 * depending on somebody remembering dashboard clicks.
 *
 * Required env:
 *   SUPABASE_ACCESS_TOKEN
 *   SUPABASE_PROJECT_ID
 *
 * Optional env:
 *   APP_URL         (defaults to https://app.syncai.ca)
 *   RESEND_API_KEY  (when present, configures branded SyncAI SMTP via Resend)
 */

const token = (process.env.SUPABASE_ACCESS_TOKEN ?? "").trim();
const projectRef = (process.env.SUPABASE_PROJECT_ID ?? "").trim();
const appUrl = (process.env.APP_URL ?? "https://app.syncai.ca").replace(/\/+$/, "");
const resendKey = (process.env.RESEND_API_KEY ?? "").trim();

if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is required");
if (!projectRef) throw new Error("SUPABASE_PROJECT_ID is required");
if (!/^https:\/\//.test(appUrl)) throw new Error("APP_URL must be an https URL");

const managementUrl = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;
const recoveryUrl = `${appUrl}/signin?mode=recovery`;
const azureCallbackUrl = `${appUrl}/auth/callback/azure`;

const recoveryTemplate = `<!doctype html>
<html>
  <body style="margin:0;background:#07111d;color:#edf4f8;font-family:Inter,Arial,sans-serif">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#07111d;padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#0d1b2a;border:1px solid #20384c;border-radius:16px;overflow:hidden">
          <tr><td style="padding:28px 32px;border-bottom:1px solid #20384c">
            <div style="font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:#38c8f4;font-weight:700">SyncAI Security</div>
            <h1 style="margin:12px 0 0;font-size:26px;line-height:1.2;color:#ffffff">Reset your SyncAI password</h1>
          </td></tr>
          <tr><td style="padding:30px 32px;color:#c8d7e3;font-size:15px;line-height:1.65">
            <p style="margin-top:0">A password reset was requested for your SyncAI account.</p>
            <p style="margin:26px 0">
              <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#d8b45b;color:#07111d;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:8px">Reset password</a>
            </p>
            <p>This secure link is time-limited. If you did not request this change, you can ignore this email and your current password will remain unchanged.</p>
            <p style="margin-bottom:0;color:#879bad;font-size:13px">SyncAI · Governed Industrial Intelligence<br>Security support: security@syncai.ca</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;

function parseAllowList(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function request(method, body) {
  const response = await fetch(managementUrl, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 1000);
    throw new Error(`Supabase Management API ${method} failed (${response.status}): ${detail}`);
  }
  return response.json();
}

const current = await request("GET");
const allowList = new Set(parseAllowList(current.uri_allow_list));
allowList.add(recoveryUrl);
allowList.add(azureCallbackUrl);

const patch = {
  site_url: appUrl,
  uri_allow_list: [...allowList].sort().join(","),
  mailer_subjects_recovery: "Reset your SyncAI password",
  mailer_templates_recovery_content: recoveryTemplate,
};

if (resendKey) {
  Object.assign(patch, {
    smtp_admin_email: "security@syncai.ca",
    smtp_sender_name: "SyncAI Security",
    smtp_host: "smtp.resend.com",
    smtp_port: "465",
    smtp_user: "resend",
    smtp_pass: resendKey,
  });
} else {
  console.warn(
    "::warning title=Supabase Auth is using the default mailer::RESEND_API_KEY is not set. Recovery links will be fixed and branded, but sender-domain branding cannot be guaranteed until custom SMTP is configured.",
  );
}

await request("PATCH", patch);
const verified = await request("GET");
const verifiedAllowList = new Set(parseAllowList(verified.uri_allow_list));

const failures = [];
if (verified.site_url !== appUrl) failures.push(`site_url=${verified.site_url}`);
if (!verifiedAllowList.has(recoveryUrl)) failures.push("recovery redirect missing from allow-list");
if (verified.mailer_subjects_recovery !== "Reset your SyncAI password") {
  failures.push("recovery subject not applied");
}
if (resendKey && verified.smtp_host !== "smtp.resend.com") {
  failures.push("custom SMTP not applied");
}

if (failures.length) {
  throw new Error(`Production Auth verification failed: ${failures.join("; ")}`);
}

console.log(`Production Auth verified: site_url=${appUrl}`);
console.log(`Production Auth verified: recovery_redirect=${recoveryUrl}`);
console.log(`Production Auth verified: custom_smtp=${resendKey ? "configured" : "not-configured"}`);
