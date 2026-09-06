# Repository and deployment access report

Snapshot date: 2026-08-22. Scope: the GitHub repository and directly observable
GitHub/Vercel integration metadata. This is a point-in-time control record.

## Repository state

| Control                          | Observed state                                          | Disposition                                                           |
| -------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| Repository visibility            | Private; anonymous API access returned `404`            | Retain private                                                        |
| Direct collaborators             | `Stiggtechnologies` only                                | Owner account retained                                                |
| Pending invitations              | None                                                    | No action                                                             |
| GitHub forks                     | None reported                                           | Monitor; local copies remain unknowable                               |
| Deploy keys                      | None                                                    | No action                                                             |
| Repository webhooks              | None found                                              | Recheck with an owner token if integrations change                    |
| Delete head branches after merge | Enabled                                                 | Retain                                                                |
| Web commit sign-off              | Required                                                | Retain                                                                |
| Dependabot vulnerability alerts  | Enabled                                                 | Retain                                                                |
| Dependabot security updates      | Enabled                                                 | Retain                                                                |
| Workflow token default           | Read-only; cannot approve reviews                       | Retain                                                                |
| External Action SHA pinning      | Required repository-wide                                | Retain; all current workflows use reviewed full-length SHAs           |
| Allowed Action policy            | All publishers, subject to full-length SHA enforcement  | Retain until private-plan support allows a safe third-party allowlist |
| Branch protection/rulesets       | Not available for this private repo on the current plan | Upgrade, then require reviews/status checks                           |
| GitHub code scanning/CodeQL      | Not available for this private repo on the current plan | Upgrade to an eligible organization plan with GitHub Code Security    |
| GitHub-native secret scanning    | Not available for this private repo on the current plan | Upgrade; keep Gitleaks CI active meanwhile                            |

`allow_forking` is an organization-private-repository setting and could not be
set on this personal-account repository. Private forks are therefore not being
represented as a locally configurable control.

## Automation and deployment principals

GitHub activity showed the repository owner, Dependabot, Claude, and Vercel as
principals or automation actors. The personal GitHub account's installed-app
list showed Claude, ChatGPT Codex Connector, and Copilot; deployment metadata
separately established Vercel automation. App installation access is
account-level evidence and should be reviewed in GitHub settings at least
quarterly and immediately after staff, contractor, or vendor changes.

Three Vercel projects were observed deploying this repository:

| Project                 | Production endpoint observed | Decision                                |
| ----------------------- | ---------------------------- | --------------------------------------- |
| `syncai-github`         | `app.syncai.ca`              | Presumed canonical; owner must confirm  |
| `repo`                  | `repo-lime-nu.vercel.app`    | Confirm need, then archive if redundant |
| `ai-maintenance-system` | Vercel project endpoint      | Confirm need, then archive if redundant |

There were 2,843 deployment records, all attributed to Vercel automation.
Deleting a project or disconnecting Vercel was not performed because it could
interrupt production and requires an explicit owner decision.

GitHub showed eight deployment environments: three named `Preview`, three
named `Production`, and two project-qualified environments. None had protection
rules. The current plan limitation and duplicated Vercel projects should be
resolved before treating environment names as strong production approval
gates.

Only the secret name `SUPABASE_ACCESS_TOKEN` was enumerated in repository
Actions settings; no secret value was read. Secret names alone do not establish
least privilege. Rotate or revoke credentials after a confirmed compromise,
personnel change, or unexplained deployment—not merely because the repository
was once public, because GitHub does not expose Actions secret values in source.

## Secret-scan disposition

The official Gitleaks 8.24.3 Darwin ARM64 release was downloaded from GitHub
and matched its published SHA-256 checksum before use. Scans were run with
secret values fully redacted.

- The default full-history scan reported 42 findings. After adding a narrow
  allowlist for exact documentation placeholders, deterministic test fixtures,
  and the standard public local-Supabase demo key, 28 historical findings
  remain. No path or commit is broadly excluded.
- The current working-tree scan reports zero findings after removing the
  remaining credential fragments from `FINAL-AUDIT-REPORT.md` and `SECRETS.md`.
- The residual history includes duplicated documentation/build artifacts,
  public/publishable or local-demo values, a Stripe-live-shaped documentation
  example, and records that describe an OpenAI key and Stripe live key as having
  been exposed.
- Those historical records say the values were removed and explicitly state
  that revocation was still required. GitHub, Git, and the current provider
  metadata do not independently prove that revocation occurred.

Do not print, commit, or circulate the raw scan reports. Verify provider-side
revocation/rotation using the OpenAI and Stripe account audit logs, and verify
that the historical Supabase project/key is decommissioned or protected by
current RLS. If an old credential remains active, rotate it before any external
diligence representation. Rewriting Git history is not a substitute for
rotation and would not remove copies already made while the repository was
public.

## Operating procedure

1. Review collaborators, pending invitations, installed apps, deploy keys,
   webhooks, Actions secrets, environments, and Vercel team members quarterly.
2. Record the reviewer, date, exceptions, and remediation ticket outside the
   repository if the record contains personal data.
3. Grant repository access to named people only; never add an unknown reviewer
   to unblock a pull request.
4. Remove access promptly after role changes and rotate credentials that the
   person or integration could read.
5. Keep one break-glass owner account protected by phishing-resistant MFA and
   store recovery details outside the repository.
