# Access Control Policy

**Owner:** `[SECURITY OWNER]` · **Approved:** `[NAME, DATE]` · **Review:** annual

## 1. Purpose

Ensure access to SyncAI systems and data is granted on least-privilege,
authenticated, and periodically reviewed.

## 2. Access principles

- Access is **role-based**. SyncAI roles: `admin`, `ai_admin`, `executive`,
  `maintenance_manager`, `reliability_engineer`, `planner`, `technician`.
- Data is **tenant-isolated** by organization via row-level security
  (`app_current_org()`); no user can read another organization's data.
- Sensitive data (board-tier KPIs, financials) is **withheld server-side** by
  role via audience-filtered RPCs — it never leaves the database for
  unauthorized roles.
- Platform/administrative functions run as `service_role` only and are revoked
  from `public`, `anon`, and `authenticated`.
- Internal/admin surfaces (deployment, research, runs, setup) require the
  `admin`/`ai_admin` role.

## 3. Authentication

- All access is authenticated via `[GoTrue / SSO]`.
- **Multi-factor authentication is required** for all accounts; SSO is enforced
  for staff via `[Azure AD tenant]`.
- Passwords are bcrypt-hashed; leaked-password protection (HIBP) is enabled;
  password policy: `[MIN LENGTH, ROTATION IF ANY]`.

## 4. Access lifecycle

- **Provisioning** — access requested via `[REQUEST CHANNEL]`, approved by
  `[APPROVER ROLE]`, recorded in `[SYSTEM]`.
- **Modification** — role changes follow the same approval.
- **Deprovisioning** — access revoked within `[N hours]` of termination/role
  change (offboarding checklist).
- **Review** — access is recertified **quarterly**; records retained.

## 5. Privileged access

Admin, `service_role`, cloud console (Supabase/Vercel), and repository-admin
access are restricted to `[NAMED ROLES]`, MFA-protected, and reviewed monthly.

## 6. Evidence (for auditors)

- RLS policies in `supabase/migrations/*` (org-scoped `for all` policies).
- `get_kpi_dashboard()` audience filtering; `AdminGate` route protection.
- `revoke execute … from public, anon, authenticated` on platform functions.
- Access-review records in `[SYSTEM]` (to be maintained).
