# SyncAI IP asset register

This register identifies technical assets and the evidence an investor or
acquirer will typically request. “Registered” means catalogued here, not that a
government registration or legal ownership determination has occurred.

| Asset class                                                    | Repository evidence                                | Current treatment                                             | Evidence still required from owner/counsel                                      |
| -------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Application source code                                        | Git history, pull requests, release/deploy records | Proprietary for revisions carrying the current root notice    | Entity assignment, employee/contractor invention agreements, exceptions         |
| Database schemas and migrations                                | `supabase/migrations`, generated schema types      | Proprietary application implementation                        | Confirm upstream/customer-provided portions and assignment                      |
| Product workflows, prompts, evaluations, and reliability logic | `src`, `scripts`, `docs`, edge functions           | Proprietary and confidential when not intentionally published | Confirm AI-service terms and human authorship/selection evidence                |
| Architecture and operating documentation                       | `docs` and repository history                      | Proprietary                                                   | Confirm third-party excerpts and customer-confidential material                 |
| User interface, text, icons, and bundled visual assets         | `src`, `public`, build output                      | Proprietary except identified third-party assets              | Copyright/source file register and designer assignments                         |
| SyncAI name, logos, domains, and social handles                | Product UI and deployment configuration            | Trademark use claimed; no registration conclusion here        | Clearance search, entity ownership, domain account inventory, filing strategy   |
| Customer data and operational records                          | Production systems, not this evidence pack         | Not treated as company-owned IP by this register              | Contracts, privacy terms, retention/deletion rules, data-room evidence          |
| Open-source packages                                           | `package-lock.json`, generated inventory and SBOM  | Used under their respective third-party licenses              | Counsel review of notices, distribution model, patents, and copyleft edge cases |
| Prior MIT-licensed SyncAI revisions                            | Git history through the preserved boundary         | Historical MIT rights preserved                               | Counsel advice on representations, notices, and transaction disclosure          |
| Secrets, credentials, and deployment configuration             | GitHub/Vercel/Supabase control planes              | Confidential operational assets; values excluded from Git     | Named custodians, recovery plan, rotation log, business continuity evidence     |

## Ownership evidence standard

For each person or vendor that materially contributed, retain a signed agreement
showing the contracting entity, scope, confidentiality obligation, invention
assignment, pre-existing materials, open-source obligations, and effective
date. Match the agreement to verified Git identities and invoice/employment
periods. A GitHub username or commit count is provenance evidence, not an IP
assignment.

For AI-assisted work, retain applicable service terms, account ownership,
prompt/output policies, human review evidence, and any material third-party
input provenance. Do not represent AI-generated material as patentable or
copyright-owned without jurisdiction-specific counsel advice.

## Maintenance

The company owner should review this register at each financing, material
acquisition, new contractor engagement, new external dataset, new distribution
channel, and license-model change. Each exception should have a named owner,
due date, evidence link, and counsel disposition.
