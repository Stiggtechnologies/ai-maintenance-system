# SyncAI Asia Market Access — Technical and Commercial Brief

Audience: Eric Gonzalez-Payne and approved SyncAI representatives.
Status: internal; claims must be confirmed against the claims register before external use.

## 1. Capability status

### Live and demonstrable

- Organization-isolated multi-tenant platform with database-enforced row-level security.
- Role-based command centres and role-shaped navigation.
- TOTP MFA, append-only security audit logging, and server-side role-change capture.
- Autonomous operating loop that senses, detects, recommends, routes for human approval, and verifies value.
- Six proactive operating passes covering condition, schedule, materials, capacity, HSE, and production.
- Human-in-the-loop approval, challenge, closeout, and learning workflows.
- Asset onboarding with RAM checklist governance, data-quality gates, FMEA patterns, and multi-role approval.
- Reliability-agent workflows with RAG citations and structured deliverables.
- ISO 55000-aligned KPI catalogue, lineage, RACI routing, and database-level access restrictions.
- 90-day pilot scorecard and verified-savings workflow.
- Reproducible database migrations and automated CI security and quality gates.

### Beta or validation-dependent

- Live historian/CMMS/ERP connectivity: the integration framework is present, but a production connector must be validated against a customer system or authorized sandbox.
- Azure AD/enterprise SSO: wiring exists; enforcement and end-to-end validation require a customer tenant.
- Dedicated customer cloud/VPC, on-premises, edge, and air-gapped patterns: subject to solution design and deployment validation for the customer's infrastructure.
- Production data-residency commitments: subject to the selected cloud region, subprocessors, and contractual architecture.

### Customer-specific engineering

- Source-system mapping, connector authentication, data normalization, custom workflow configuration, dashboard configuration, and customer-specific network controls.
- Any write-back to CMMS/ERP or operational systems. The initial pilot should remain read-only unless separately approved.
- Air-gapped or highly restricted edge deployment packaging and lifecycle management.

## 2. Customer names and claims

Until written authorization is recorded, do not name customers or imply that SyncAI is deployed in their production operations. Describe team experience separately from SyncAI customer deployments.

Do not state quantified savings, downtime reduction, availability improvement, or ROI as achieved customer results unless a named evidence record and customer authorization exist. Website ranges may be presented only as target outcomes to validate during a pilot, not guaranteed results.

## 3. Reference calls

A reference call is available only after Orville confirms the specific reference and obtains permission for the named prospect. Do not promise a reference call in advance.

## 4. Lead problem by sector

Use one common opening:

> Can you safely and reliably deliver the production plan, and can your team explain the operational constraints early enough to act?

Then tailor the first problem:

- Mining: fleet and fixed-plant bad actors, maintenance readiness, and production-risk visibility.
- Energy: critical-equipment risk, work execution readiness, and preservation of expert operating knowledge.
- Manufacturing: chronic losses, maintenance-plan effectiveness, and constraint-driven production reliability.
- Construction: fleet availability, maintenance backlog quality, parts readiness, and project schedule risk.
- Fleet operations: preventable downtime, repeat failures, work-order quality, and maintenance prioritization.

The preferred first offer is a read-only diagnostic pilot focused on one bounded operational problem and a measurable baseline.

## 5. Deployment options

Currently supportable subject to solution validation:

- Shared SaaS for demonstrations and low-risk pilots.
- Logically isolated customer environment.
- Dedicated cloud deployment.
- Customer cloud/VPC deployment through an agreed architecture.
- Hybrid deployment using a customer-side connector or gateway.

On-premises, edge, and fully air-gapped installations must be described as solution-design options until packaging, update, monitoring, key-management, backup, and support procedures are validated for that deployment class.

## 6. Pilot data handling

The default pilot should minimize data movement and use only the information required for the agreed use case. Before any pilot, provide a customer-specific data-flow diagram covering:

- data sources and fields;
- collection method and frequency;
- read-only credentials and permissions;
- encryption in transit and at rest;
- processing services and subprocessors;
- storage region and retention;
- logs, prompts, outputs, backups, and deletion;
- support access and audit logging.

Do not promise a residency location until the selected environment and all subprocessors are confirmed.

## 7. AI model use

The current architecture supports OpenAI and Gemini through server-side edge functions. Customer information must not be represented as used for model training unless the applicable provider terms, account settings, and contract have been verified. For each opportunity, disclose the approved model provider, data path, retention settings, logging, and whether a customer-approved private or local model is required.

## 8. Read-only operation

Yes. The preferred first pilot is read-only and must not require write access to CMMS, ERP, historian, SCADA, PLC, or control systems. Any operational write-back requires a separate design, risk assessment, authorization model, testing plan, rollback plan, and customer approval.

## 9. Connection requirements

Connection requirements depend on the source. Typical patterns include:

- outbound HTTPS from a customer-managed gateway;
- read-only API/service account credentials;
- scheduled file export to an approved storage location;
- database read replica or restricted view;
- customer-approved VPN/private endpoint.

Never promise that no firewall, credential, agent, or network change is required until discovery is complete.

## 10. Integration claims

Approved wording:

> SyncAI has an integration-first architecture and can connect through secure APIs, database views, file exchange, event streams, or a customer-side gateway. Production status is connector-specific. We will identify whether the requested connector is production-validated, tested in a sandbox, configurable from an existing pattern, or requires custom engineering.

A connector catalogue with those four statuses must be maintained. Do not say “integrates with any software” without this qualification.

## 11. Security posture

Verified technical controls include org-scoped RLS, database role enforcement, MFA, append-only audit logging, CI quality gates, CodeQL, secret scanning, dependency management, reproducible migrations, and human approval for operational recommendations.

Formal SOC 2 and ISO/IEC 27001 assurance has not yet been issued. Approved wording:

> SyncAI has implemented a substantial set of technical controls aligned with SOC 2 and ISO/IEC 27001. Formal independent audit, certification, organizational evidence review, and any required observation period remain to be completed.

Security materials to finish before broad CISO outreach:

- security whitepaper;
- architecture and customer-specific data-flow diagrams;
- DPA and subprocessor register;
- penetration-test report or executive summary;
- incident-response and disaster-recovery summaries;
- backup/restore test evidence;
- vulnerability-management procedure;
- cyber-insurance evidence;
- SOC 2 and ISO 27001 audit-status letter.

## 12. Technical meeting support

Orville leads commercial and executive discussions. A named technical lead must join architecture, integration, AI-governance, and security sessions and own security questionnaires. No meeting should be scheduled as a deep technical review until that owner and backup are confirmed.

## 13. Standard pilot

Recommended baseline:

- Duration: 90 days, with a short discovery and security-approval stage before data connection.
- Scope: one site, one bounded operational problem, limited read-only data sources, and agreed user roles.
- Customer commitments: executive sponsor, operational owner, technical/security contacts, data access, weekly working session, baseline validation, and timely approvals.
- Deliverables: connected data set, configured workflows, executive scorecard, use-case findings, value-verification record, security/deployment record, and scale recommendation.
- Success criteria: agreed data completeness, workflow adoption, decision-cycle improvement, validated recommendations, and customer-approved value evidence.
- Price: opportunity-specific until a formal pricing schedule is approved. Eric must not quote pricing without authorization.

## 14. Pilot capacity

Do not publish a number until delivery staffing, technical ownership, and customer-support capacity are confirmed. Initially, accept only the number of concurrent pilots that can each receive named delivery ownership, weekly governance, security support, and executive review.

## 15. Eric's proposed role

Recommended initial mandate: Market Access Partner for a 90-day validation period.

Responsibilities:

- select approved target accounts;
- shape sector messaging;
- make approved introductions;
- join discovery and executive meetings;
- manage follow-up with SyncAI;
- help progress qualified opportunities through pilot definition and procurement.

SyncAI retains ownership of accounts, data, proposals, contracts, CRM records, intellectual property, and customer relationships. Compensation, territory, exclusivity, authority, and post-termination commissions require a signed agreement before outreach.
