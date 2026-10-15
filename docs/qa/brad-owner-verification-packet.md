# Owner verification and release HOLD

No merge, hosted SQL, access change or production deployment is authorized by this packet. Issue #575 remains open. Synthetic database and browser checks do not establish customer acceptance.

## Verified control evidence supplied by the integration parent

Authorized Mac UI inspection on 2026-10-12 established main protection rule **82131283**: pull request required; seven required checks; branch must be up to date; conversations must be resolved; bypass, force-push and deletion disabled. Approval count, CodeOwner approval and latest-push approval requirements are disabled. No rulesets were reported. This supersedes the earlier uncertainty caused by the connector's HTTP 403; it does not authorize bypassing any control.

Required checks: Lint + Typecheck; Unit tests; Migration order vs deployed head; Migration chain + seeded auth smoke; Golden-path E2E; Licensing and dependency policy; gitleaks.

PR #662's independently reviewed head remains `27b485df2cd8a55c6672c70b514d17e20e3748a5`, draft/unmerged. Parent observed 13 successful checks, one skipped check and no conflicts. Verify again immediately before any authorized integration; do not substitute an earlier head's checks.

## Remaining Vercel owner verification — authorized UI only

The current owner login reached authenticator MFA. The user must complete that step directly; do not request codes, credentials, expanded access or a different route around it.

After login, record sanitized screenshots or text from these existing settings and deployments:

1. Open the `stiggtechnologies-projects` team and **syncai-github** project. In Settings → Git, verify the linked repository is `Stiggtechnologies/ai-maintenance-system` and record the configured **Production Branch**. Do not infer it from a preview or project name.
2. In Settings → Domains, identify the project serving **app.syncai.ca** and whether that domain is assigned to production or a branch. If another project owns it, inspect that actual project rather than guessing.
3. Open the current Production deployment. Record environment, Ready/failed status, deployment ID/URL, commit SHA and branch, creation time, domain assignment and any promotion/rollback state. Open the actual domain and verify the deployed version through its established release evidence. A successful GitHub build alone does not establish this mapping.
4. Inspect whether merges to main automatically build/promote production, and any deployment protection, manual promotion or owner gate. Record what PR #662's merge would trigger before taking that action. Its six additive synthetic-module files do not trigger repository DB/Auth/Edge path filters, but Vercel may rebuild.
5. For #661 head `dec2145a2873c86d7b1a27582187a97d7ce737aa`, open failed deployments **syncai-github / 7wkHTMrvVmu7kVsZBrg7hc3vUAYd** and **repo / GRAXzyPKNRZY5Fdxqu1MeLvvnsTc**. Provide the first actionable sanitized build/platform error and deployment source SHA. The `ai-maintenance-system` preview passed. Do not infer the failed previews' cause from that success.

The prior request for these logs was a question in the delegated task's user-input UI to the task requester. No email, Slack message, Vercel support request or other external outreach occurred.

## Verified production backend facts and remaining prerequisites

The parent's 12:00 UTC authorized dashboard inspection identifies SyncAI main **PRODUCTION**, healthy, **ca-central-1 / Canada Central**, MICRO/t4g.micro. Canadian-region hosting therefore exists. Full-stack data residency, self-hosting and offline operation remain unqualified.

No SyncAI staging project or preview branch was identified among the inspected projects. The dashboard reports no repository connection. It shows 425 migrations, highest filename `20270103040000_risk_decision_preview_context`, and 34 deployed Edge functions. Future-looking migration filenames are ordering identifiers, not deployment timestamps.

#661 migrations `20270103180000` and `20270103190000` and `decision-case-invite` are absent from that observed production state. The older deployed KB intake function is not evidence of the new governed contract. #663's five `20270104090000–20270104090400` migrations and four native adapter functions are absent. The new mapping migration reservation is `20270104090500` after a repository-wide open-PR collision check.

Before release: establish an approved staging/qualification environment, exact backend/app heads, authorized synthetic identities/data, rollback/restore custodian and evidence retention, protected SQL review and genuine named-human sign-off. Then prove real invitation acceptance and both customer paths. No existing production deployment is evidence for those unshipped paths.

## Source-only assessment: process-safety compatibility view

`supabase/migrations/20261219090001_process_safety_integrity_activation.sql` defines `process_safety_control_events` without `security_invoker`, projecting `audit_events` without a tenant predicate. Its INSTEAD OF INSERT trigger uses `write_process_safety_audit`, a security-definer function that copies supplied organization/actor fields. Function EXECUTE revocation does not remove an already permitted view INSERT path.

The source establishes a conditional risk: if client roles have view SELECT, owner-rights evaluation can bypass underlying audit RLS; if they have view INSERT, the trigger can bypass underlying audit write checks. Actual exposure depends on live grants/ownership/options. No live rows were read and no live fix was attempted.

An authorized owner may inspect **catalog metadata only** in the existing SQL UI, without changing grants or reading tenant records:

```sql
select c.relname, pg_get_userbyid(c.relowner) as owner, c.reloptions, c.relacl
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('process_safety_control_events','audit_events');
select grantee,privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name='process_safety_control_events';
select policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename='audit_events';
```

Reviewable containment is provided separately as `process-safety-view-containment.proposed.sql`: invoker-rights reads and explicit revocation of direct client writes, while retaining the canonical RPC/trigger audit path. It is **unapplied**, has no deployment timestamp, and requires permission/tenancy review and native compatibility qualification before a serialized migration is proposed. This does not constitute a live incident-impact finding or a production remediation claim.
