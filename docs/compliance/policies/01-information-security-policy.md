# Information Security Policy (Master)

**Owner:** `[SECURITY OWNER / CISO]` · **Approved by:** `[NAME, TITLE]` ·
**Effective:** `[DATE]` · **Review:** annual

## 1. Purpose

Establish `[COMPANY]`'s commitment to protecting the confidentiality, integrity,
and availability of information in the SyncAI platform and supporting systems,
and to meeting SOC 2 and ISO/IEC 27001 obligations.

## 2. Scope

Applies to all `[COMPANY]` personnel, contractors, and systems that process
customer or company data, including the SyncAI application, its Supabase
project(s), Vercel deployment, source repositories, and staff endpoints.

## 3. Principles

- **Least privilege** — access is granted only as needed for a role.
- **Defense in depth** — controls at the data (RLS), application, network, and
  process layers.
- **Human-in-the-loop** — automated agents recommend; humans approve
  consequential actions. No autonomous execution of safety- or
  production-critical changes.
- **Secure by default & fail-soft** — components degrade safely.
- **Auditability** — security-relevant actions are logged and reviewable.

## 4. Roles & responsibilities

- **Security owner** — maintains this ISMS, the risk register, and control
  operation; approves exceptions.
- **Engineering** — implements and maintains technical controls; follows the
  change-management and secure-development requirements.
- **All staff** — complete training, follow the acceptable-use policy, report
  security events promptly.

## 5. Policy statements

1. Information is classified and handled per the Data Management Policy.
2. Access is controlled per the Access Control Policy, with **enforced MFA**.
3. Changes to production follow the Change Management Policy.
4. Security events are handled per the Incident Response Policy.
5. Continuity and recovery follow the BCP/DR Policy, and recovery is tested.
6. Third parties are managed per the Vendor Management Policy.
7. Risks are assessed at least annually and tracked to treatment.
8. Compliance is monitored continuously (control self-assessment + tooling).

## 6. Exceptions

Exceptions require documented risk acceptance approved by the security owner,
time-boxed and reviewed.

## 7. Enforcement

Violations may result in disciplinary action per the HR Security Policy.

## 8. Evidence this policy is operating (for auditors)

- Org-scoped RLS on all tables; role-based access enforced in the database.
- CI/CD with branch protection and required checks gating every change.
- Audit tables: decisions, agent runs, learning events, KPI computation lineage.
- Supabase Security Advisor at by-design-only warnings; HIBP enabled.
