# SyncAI Product Capability Audit

**Audit date:** 2026-08-03  
**Audited branch:** `main`  
**Reference commit:** `a07f920c1271a46154885670332da680f00c087d`

## Purpose

This audit establishes an evidence-based representation of:

1. what SyncAI currently implements;
2. what is implemented as a foundation but not yet end-to-end operational;
3. what is simulated, demo-oriented, incomplete, legacy, or externally unvalidated;
4. what remains necessary for enterprise deployment in high-risk, asset-intensive organizations.

The result is intended to govern README, sales, pilot, security, architecture, and roadmap claims.

## Method and limitations

The review covered all major repository layers discoverable through the connected GitHub index:

- application routes, pages, components, hooks, and services;
- active Supabase migrations and archived legacy migrations;
- Row Level Security, RPCs, triggers, scheduled jobs, and persistence contracts;
- Edge Functions and orchestration runtimes;
- asset twins, Engineering DNA, Shared Component DNA, physics, inspections, engineering knowledge, and RAG;
- authentication, MFA, enterprise access, tenancy, approvals, audit, and security controls;
- integrations, deployments, edge-node artifacts, billing, marketplace, tests, CI/CD, compliance, readiness, and historical reports;
- recent merged and open pull requests that materially affect the product state.

A local clone was attempted for a literal line-by-line review, but the execution environment could not resolve GitHub. This is therefore a repository-wide capability audit based on GitHub-indexed source, not a penetration test, production configuration attestation, independent verification and validation exercise, or guarantee that every static asset and prose file was manually read.

Runtime behavior, hosted environment configuration, customer deployments, external integrations, and certifications must be independently validated.

## Maturity definitions

| Classification | Meaning |
| --- | --- |
| **Operational foundation** | Working code and persistence exist in the active architecture, with meaningful tests or application use. External production assurance may still be incomplete. |
| **Pilot-capable** | Suitable for bounded, supervised use with agreed data, users, controls, and acceptance criteria. |
| **Implemented foundation** | Contracts, models, libraries, UI, or persistence exist, but the complete end-to-end workflow is not yet proven. |
| **Simulation / demo** | Demonstrates workflow or product value using seeded or simulated data; not evidence of a live industrial integration. |
| **Incomplete / unsafe to claim** | Material functional, security, schema, integration, or validation gaps prevent a production claim. |
| **Design-supported** | Architecture or code artifacts indicate intent, but a validated deployment is not present. |
| **External evidence required** | Certification, penetration testing, customer results, regulatory authorization, or other independent evidence is required. |
| **Legacy / stale** | Preserved historical implementation or documentation that is not the current source of truth. |

## Executive verdict

SyncAI is best described today as an **advanced, governed industrial engineering intelligence pilot platform**.

It has a substantial working product foundation:

- a broad authenticated application;
- organization-scoped operational data;
- a governed recommendation-to-approval operating loop;
- assets, work orders, evidence, scenarios, decisions, value, learning, onboarding, KPIs, and audit records;
- real Supabase persistence and Realtime use;
- deployed AI processing and approval orchestration paths;
- manufacturer-neutral asset templates, Engineering DNA, shared components, deterministic physics, inspections, and asset-twin persistence;
- meaningful unit, migration, smoke, and Playwright test intentions;
- strong human-authority and approved-source governance principles.

It is **not yet accurately described as a hardened enterprise platform ready for unrestricted deployment in a major energy company, aerospace program, defence environment, or other high-consequence production setting**.

The primary blockers are not a lack of screens or AI concepts. They are identity assurance, tenant-safe service boundaries, authorization depth, active-schema convergence, real industrial connectors, trustworthy measurement governance, runtime consolidation, reproducible database/E2E validation, independent security evidence, and externally verified operating results.

## Capability assessment

### 1. Application and user experience

**Classification: Operational foundation / pilot-capable**

The application exposes substantial surfaces for:

- operational overview and role command centres;
- assets, onboarding, reliability, work, scenarios, approvals, governance, evidence, artifacts, learning, and value;
- executive, OEE, benchmarking, risk, emergency, trust, integrations, deployments, and administration;
- operational briefings and shift handover.

Evidence:

- `src/App.tsx`
- `src/pages/MissionControl.tsx`
- `src/pages/OperationalBriefing.tsx`
- `src/services/operatingLoopService.ts`
- `src/services/syncaiDataService.ts`

Limitations:

- The number of routes exceeds the number of fully hardened domain services.
- Some surfaces are compatibility, registry, seeded-data, or presentation layers rather than complete enterprise workflows.
- Several visible controls have no operational handler, including parts of integration setup and alternate authentication.

### 2. Governed operating loop

**Classification: Operational foundation / pilot-capable**

The active database and application support:

- assets and telemetry concepts;
- recommendations, evidence, scenarios, approvals, work orders, decisions, value metrics, and learning events;
- human approval before bounded side effects;
- audit history and verified-value concepts;
- scheduled agent-loop and KPI processing.

Evidence:

- `supabase/migrations/00000000000001_operating_loop_baseline.sql`
- `src/services/operatingLoopService.ts`
- `supabase/functions/ai-agent-processor/index.ts`
- `supabase/functions/autonomous-orchestrator/index.ts`

Limitations:

- The default operating picture is seeded and simulated until customer systems are connected.
- The orchestrator's condition scoring contains generic fallback values and thresholds. These must not be represented as approved customer engineering limits.
- Only a small, bounded set of post-approval record changes is currently supported.

### 3. Human authority and governed execution

**Classification: Operational foundation**

Strong implemented controls include:

- mandatory approval records for governed recommendations;
- role checks in the deployed autonomous orchestrator;
- idempotent orchestration and execution records;
- direct autonomous execution disabled;
- prohibited operational actions encoded for inspection recommendations;
- human review escalation based on risk and confidence.

Evidence:

- `supabase/functions/autonomous-orchestrator/index.ts`
- `src/lib/asset-twins/inspection-recommendations.ts`
- `supabase/migrations/00000000000020_inspection_recommendation_persistence.sql`

Limitations:

- Human approval in the application does not replace an independently validated safety or control-system authorization boundary.
- Some older orchestration functions do not implement equivalent authentication and tenant validation.

### 4. Asset onboarding and RAM governance

**Classification: Operational foundation / pilot-capable**

Implemented elements include:

- structured asset onboarding;
- a broad RAM/FMEA-oriented checklist;
- confidence and evidence gaps;
- readiness gates and role approvals;
- failure-mode libraries;
- FRACAS-oriented closeout;
- triggers for re-evaluation after selected asset changes.

Evidence:

- `supabase/migrations/00000000000011_autonomous_onboarding.sql`
- `supabase/migrations/00000000000012_onboarding_governance.sql`
- `src/lib/asset-onboarding.ts`
- `docs/asset-onboarding.md`

Limitations:

- Several data-quality checks are represented as configured booleans rather than independently calculated measurement-quality evidence.
- Management-of-change behavior reruns onboarding for selected changes; it is not yet a complete technical-change, deviation, waiver, return-to-service, and effectiveness-verification lifecycle.

### 5. KPI and operating-performance layer

**Classification: Operational foundation**

Implemented elements include:

- a 29-KPI ISO 55000-aligned catalog;
- computation from current operating records where data is available;
- lineage metadata;
- explicit identification of KPIs awaiting ERP, historian, mobile, strategy, or lifecycle data;
- audience filtering at the database RPC boundary;
- threshold-driven recommendation generation.

Evidence:

- `supabase/migrations/00000000000017_kpi_service.sql`

Limitations:

- ISO alignment is not certification.
- Several KPIs remain unavailable without real source systems.
- Formula validation against each customer's approved definitions is required.

### 6. Asset twins and Digital Engineering DNA

**Classification: Implemented foundation / expanding**

Implemented elements include:

- canonical manufacturer-neutral asset templates;
- Engineering DNA profiles;
- Shared Component DNA;
- inspection contracts and findings;
- deterministic physics capabilities;
- OEM/model overlays;
- customer twin compilation;
- versioned database persistence with maturity and evidence states.

Current asset coverage includes multiple mining and process assets such as haul trucks, shovels, drills, conveyors, crushers, pumps, motors, gearboxes, mills, thickeners, loaders, and draglines.

Evidence:

- `src/lib/asset-twins/`
- `src/lib/asset-twins/index.ts`
- `src/lib/asset-twins/compiler.ts`
- `src/lib/asset-twins/physics-capability.ts`
- `supabase/migrations/00000000000019_asset_twin_library.sql`

Limitations:

- Much of the library remains draft or approval-gated pending authorized engineering evidence.
- Asset-class coverage is still narrow relative to a major multi-industry enterprise.
- Customer overrides and overlay compilation require stronger schema validation and change governance before high-consequence use.
- Live operational synchronization of twin configuration is not yet a general product capability.

### 7. Inspection intelligence

**Classification: Strong implemented foundation**

Implemented elements include:

- canonical inspection-zone contracts;
- evidence artifacts with repeatability keys and optional checksums;
- finding confidence, severity, disposition, assumptions, and verification requirements;
- linkage to canonical components and failure modes;
- recommendation, approval, and evidence package generation;
- explicit prohibition of autonomous operating-limit, safeguard, shutdown, or return-to-service changes;
- atomic, tenant-scoped, idempotent persistence.

Evidence:

- `src/lib/asset-twins/inspection-findings.ts`
- `src/lib/asset-twins/inspection-recommendations.ts`
- `supabase/migrations/00000000000020_inspection_recommendation_persistence.sql`

Limitations:

- Field capture applications, device integrations, inference models, model qualification, evidence storage controls, and complete immutable export packages are not yet proven end to end.

### 8. Engineering knowledge and retrieval

**Classification: Implemented contract foundation; end-to-end service incomplete**

Implemented on `main`:

- engineering entity and relationship types;
- authority, review, confidentiality, provenance, applicability, and supersession metadata;
- deterministic Knowledge Base Factory publication planning;
- extraction-candidate resolution against canonical registries;
- confidence gates and required human review.

Evidence:

- `src/lib/engineering-knowledge/ontology.ts`
- `src/lib/engineering-knowledge/knowledge-base-factory.ts`
- `src/lib/engineering-knowledge/engineering-extraction.ts`

Important boundaries:

- The extraction module resolves candidates supplied to it; it is not itself a document extraction service.
- The Knowledge Base Factory produces a plan; it does not persist and publish the full knowledge graph or RAG corpus.
- Asset-aware retrieval is in draft PR #115 and is not part of `main`.
- Persistent graph-query services are not implemented.

### 9. Legacy RAG stack

**Classification: Incomplete / unsafe to claim as a current clean-deployment capability**

The repository contains document-processing and semantic-search Edge Functions, but:

- they use service-role clients and accept caller-supplied tenant IDs without explicit identity-to-tenant validation;
- their required `knowledge_base_documents` and `knowledge_base_chunks` schema is found in archived legacy migrations rather than the active deterministic chain;
- they are not connected to the newer engineering authority, review, provenance, supersession, and applicability contracts;
- they use a legacy embedding model configuration;
- they are not included in the active production Edge Function deployment workflow.

Evidence:

- `supabase/functions/rag-document-processor/index.ts`
- `supabase/functions/rag-semantic-search/index.ts`
- `supabase/_legacy_migrations/20251024080921_enable_vector_and_create_rag_system.sql`
- `.github/workflows/deploy-migrations.yml`

Required action:

Replace or migrate the legacy RAG path into one authenticated, tenant-derived, active-schema engineering knowledge service before making end-to-end RAG claims.

### 10. AI agents and orchestration

**Classification: Mixed**

**Deployed governed path — operational foundation:**

- authenticated user or internal-service context;
- tenant-scoped work-order and asset loading;
- idempotent orchestration runs;
- structured tasks for failure classification and reliability assessment;
- recommendation and approval handoff;
- bounded post-approval side effects;
- trace, cost, and conversation records.

Evidence:

- `supabase/functions/ai-agent-processor/index.ts`
- `supabase/functions/autonomous-orchestrator/index.ts`
- `.github/workflows/deploy-migrations.yml`

**Legacy or parallel paths — incomplete and security-sensitive:**

- `sir-orchestrator` and `openclaw-orchestrator` are near-parallel service-role runtimes;
- `gateway` checks for an authorization header but does not derive and enforce tenant identity at its service-role boundary;
- several endpoints accept caller-supplied tenant, user, session, run, or object IDs;
- the gateway contains an explicit TODO to validate agent ownership;
- multiple orchestration generations create architecture, security, and source-of-truth ambiguity.

Evidence:

- `supabase/functions/sir-orchestrator/index.ts`
- `supabase/functions/openclaw-orchestrator/index.ts`
- `supabase/functions/gateway/index.ts`

Required action:

Designate one canonical orchestration runtime, migrate necessary records and tools, disable or remove obsolete functions, and apply a common authenticated tenant and authorization boundary.

### 11. LLM and model assurance

**Classification: Implemented foundation; enterprise assurance incomplete**

Implemented elements include:

- provider abstraction in selected paths;
- prompt purpose boundaries;
- human-review requirements;
- idempotency and run logging;
- model, token, cost, confidence, and output records;
- explicit instructions not to invent evidence or bypass approvals.

Limitations:

- Typed LLM output is JSON-parsed but not comprehensively validated against strong runtime schemas.
- Some model routing paths use service-role access and caller-supplied user/sensitivity context.
- No complete model registry, approved-evaluation suite, deployment-specific model lock, adversarial test evidence, rollback evidence, or independent validation package is proven.
- Customer data-use, provider isolation, and residency controls remain deployment-specific.

### 12. Authentication and enterprise identity

**Classification: Mixed; enterprise SSO incomplete**

Implemented:

- Supabase password authentication;
- real session and profile handling;
- TOTP enrollment and AAL2 challenge code;
- security-event recording.

Incomplete or unsafe to claim:

- organization-wide MFA enforcement is explicitly not implemented;
- local Supabase configuration disables TOTP enrollment and verification;
- the enterprise-access company-code check is labelled mock;
- the enterprise MFA field is not used;
- Google Workspace login has no handler;
- “Try Demo Mode” enters the application UI without establishing a Supabase session;
- the Azure client and Edge Function do not form a correct, validated Supabase SSO flow;
- the Azure Edge Function decodes ID tokens without validating their signature;
- the client and function paths/actions are inconsistent;
- returned Azure tokens are not converted into a Supabase session.

Evidence:

- `src/components/AuthProvider.tsx`
- `src/components/MfaManager.tsx`
- `src/pages/Login.tsx`
- `src/pages/EnterpriseAccess.tsx`
- `src/lib/azure-ad.ts`
- `supabase/functions/marketplace-resolve/index.ts`
- `supabase/config.toml`

Required action:

Disable unsupported sign-in controls and demo bypass in production, use a validated Supabase/OIDC enterprise flow, validate issuer/audience/signature/nonce/state, enforce tenant mapping, add phishing-resistant MFA options, and test organization policy enforcement.

### 13. Tenancy and authorization

**Classification: Organization isolation implemented; enterprise authorization incomplete**

Implemented:

- `app_current_org()` tenant resolution;
- RLS on core organization-scoped tables;
- child-record hardening for selected tables;
- user-scoped preferences and KPI dashboard records;
- server-side KPI audience filtering;
- explicit tenant checks in the newer deployed AI/orchestrator path.

Limitations:

- many core operational tables grant authenticated users broad read/write access within their organization;
- comprehensive role-, site-, asset-, program-, classification-, and action-level write authorization is not proven;
- some legacy service-role Edge Functions bypass RLS and trust caller-supplied scope;
- a client fallback can represent a user as admin when role data is unavailable, even though database controls remain separate.

Evidence:

- `supabase/migrations/00000000000001_operating_loop_baseline.sql`
- `supabase/migrations/00000000000005_rls_hardening.sql`
- `supabase/migrations/00000000000017_kpi_service.sql`
- `src/services/platform.ts`

Required action:

Build an authorization matrix and enforce it in database policies and authenticated service boundaries for every read, create, update, approval, execution, export, and administrative action.

### 14. Integrations

**Classification: Registry and monitoring foundation; production connectors not evidenced**

Implemented:

- integration and connector records;
- connector-run history;
- integration health and freshness views;
- UI catalogs for SAP, Maximo, PI/historian, OPC-UA, MQTT, REST, and CSV;
- operating-loop and KPI contracts that can consume external data.

Not implemented or not proven:

- the visible Add, Configure, Sync, Connect, and Sync Now controls are not wired to connector provisioning;
- no production-certified SAP, Maximo, PI, SCADA, OPC-UA, MQTT, ERP, PLM, or other major industrial connector is evidenced in the active path;
- connector security, reconciliation, replay, schema versioning, and certification are not proven.

Evidence:

- `src/pages/IntegrationsPage.tsx`
- `src/pages/IntegrationHealthPanel.tsx`
- `supabase/migrations/00000000000002_legacy_compat.sql`
- `docs/enterprise-readiness/claims-and-evidence-register.md`

### 15. Deployment and edge

**Classification: Workspace provisioning simulation implemented; infrastructure deployment design-supported only**

The `provision_deployment()` RPC creates a site, starter assets, simulated sensors, an onboarding workspace, notifications, and audit records inside the current SyncAI application.

This is a useful demo/pilot workspace factory. It is not cloud infrastructure provisioning, private-cloud deployment, on-prem installation, edge runtime installation, air-gap deployment, or production historian/CMMS integration.

Edge-node registration and heartbeat code exists, but:

- its required schema is found in archived legacy migrations;
- its service boundary only checks for the presence of an authorization header;
- it uses the service-role key and does not derive tenant identity;
- it is not in the active Edge Function deployment workflow.

Evidence:

- `supabase/migrations/00000000000015_autonomous_deployment.sql`
- `supabase/functions/edge-node-manager/index.ts`
- `supabase/_legacy_migrations/20260323065113_20260323070000_add_edge_node_manager.sql`
- `.github/workflows/deploy-migrations.yml`

### 16. Data quality and measurement trust

**Classification: Partial foundation**

Present:

- units on sensors and physics variables;
- data-quality labels on evidence;
- data completeness and update latency KPIs;
- calibration concepts in asset templates and onboarding;
- source, timestamp, confidence, and lineage fields.

Not yet proven as a complete capability:

- calibration status and expiry governance;
- measurement uncertainty propagation;
- time synchronization and sequence integrity;
- sensor drift, bias, frozen value, substitution, and historian-compression handling;
- bad-quality flag ingestion from source systems;
- derived-tag lineage and confidence;
- evidence fitness-for-purpose decisions.

This is a genuine product gap for high-consequence engineering decisions.

### 17. Technical change and configuration assurance

**Classification: Partial foundation**

Present:

- versioned asset templates and overlays;
- customer overrides and compilation logs;
- selected onboarding MOC triggers;
- approvals, audit events, work history, and learning records;
- prohibition of autonomous return-to-service and operating-limit changes.

Not yet evidenced as a complete workflow:

- requirements and interface traceability;
- formal Management of Change cases;
- temporary changes and expiry;
- deviations, waivers, concessions, and technical queries;
- design-basis and configuration-baseline approval;
- pre-startup or return-to-service review;
- affected-document, procedure, training, and spares updates;
- implementation verification and change-effectiveness review.

This remains a high-value target capability, not an absent idea.

### 18. Human-systems integration

**Classification: Partial foundation**

Present:

- role-shaped navigation and command centres;
- operational briefing and shift-handover surfaces;
- accountability and approval roles;
- explicit explanations, evidence, consequences, and verification needs.

Not yet evidenced as a complete capability:

- competency and authorization validation;
- human workload and alarm/recommendation burden management;
- workforce fatigue-sensitive workflows;
- usability validation under abnormal and emergency conditions;
- automation-bias controls and comprehension checks;
- field offline execution and accessibility assurance;
- training and simulation tied to authorization.

### 19. Scenario, research, and verification

**Classification: Scenario foundation; controlled experimentation incomplete**

Present:

- recommendation scenarios;
- research program/run/result records;
- promotion-candidate concepts;
- value verification and learning events;
- trace and orchestration records.

Not yet proven:

- historical incident replay;
- shadow-mode comparison against current practice;
- digital-twin simulation with validated models;
- synthetic failure injection;
- operator-in-the-loop exercises;
- controlled canary promotion and rollback evidence;
- statistically governed experiment acceptance.

### 20. Evidence and technical assurance packs

**Classification: Partial foundation**

Present:

- evidence items;
- inspection evidence artifacts and optional checksums;
- recommendation rationale;
- source IDs, authority, review, applicability, and provenance contracts;
- approvals, decisions, audit records, execution results, and verified value;
- cowork artifacts and exports.

Not yet proven:

- one immutable, signed evidence package that reconstructs the complete path from source data and configuration through model/calculation, conflicts, review, approval, execution, verification, residual risk, and final disposition;
- evidence retention, legal hold, export, and regulator/auditor formats;
- cryptographic signing and independent verification.

### 21. CI/CD and reproducibility

**Classification: Strong intent; database and E2E gate currently impaired**

Implemented workflow coverage includes:

- lint;
- TypeScript checking;
- production build;
- unit tests;
- migration/auth/agent-loop smoke tests;
- Playwright golden-path E2E;
- CodeQL and security scanning;
- migration and selected Edge Function deployment from `main`.

Current limitation:

- the local Supabase database container fails to start in GitHub Actions, so migration and E2E success is not currently established;
- Vercel failures have also been affected by account build-rate limits;
- only `agent-loop-enrich`, `ai-agent-processor`, `autonomous-orchestrator`, and `onboarding-enrich` are included in the active function deployment workflow.

Evidence:

- `.github/workflows/ci.yml`
- `.github/workflows/deploy-migrations.yml`
- PR #117

### 22. Security, compliance, and external assurance

**Classification: Readiness foundation; external evidence required**

Present:

- RLS and security hardening migrations;
- MFA code paths;
- security-event logging;
- CodeQL, secret scanning, dependency review, and policies;
- SOC 2 and ISO 27001 mappings, policies, gaps, and evidence indexes;
- claims-and-evidence governance.

Not established:

- SOC 2 report;
- ISO 27001 certification;
- independent penetration test;
- formal production threat-model review and residual-risk acceptance;
- defence, controlled-goods, export-control, protected-information, or classified-environment authorization;
- IEC 62443, IEC 61511, aerospace, or other sector certification;
- verified sovereign, private, on-prem, edge, or disconnected deployment.

Evidence:

- `docs/compliance/`
- `docs/enterprise-readiness/claims-and-evidence-register.md`
- `SECURITY.md`

### 23. Value and customer evidence

**Classification: Product measurement foundation; external proof pending**

Present:

- projected and verified value fields;
- recommendation acceptance and learning records;
- value metrics and portfolio views;
- pilot scorecard concepts.

Not established:

- independently verified customer savings;
- quantified reliability, availability, safety, emissions, or production outcomes at a named customer;
- externally validated ROI benchmark;
- customer reference evidence.

## Critical findings and required response

### P0 — Resolve before enterprise production positioning

1. **Enterprise SSO flow is incomplete and security-sensitive.**  
   Disable unsupported enterprise/Google controls in production or implement a validated OIDC/Supabase flow with signature, issuer, audience, nonce, state, tenant mapping, and session establishment.

2. **Legacy service-role Edge Functions trust caller-supplied scope.**  
   Disable, isolate, or rewrite `gateway`, `sir-orchestrator`, `openclaw-orchestrator`, legacy RAG, model-router, marketplace, and edge-node boundaries before treating them as enterprise services.

3. **Legacy RAG schema is absent from the active migration chain.**  
   Build one authenticated active-schema engineering knowledge ingestion and retrieval path connected to the new ontology, authority, provenance, and applicability contracts.

4. **Authorization is primarily organization-scoped, not comprehensively action- and role-scoped.**  
   Implement and test an enterprise authorization matrix across the database and service boundary.

5. **Database migration and E2E CI are not currently reproducible.**  
   Repair local Supabase startup and require the migration/auth/agent-loop and Playwright gates before merge and deployment.

### P1 — Resolve before high-consequence pilot expansion

1. Remove generic hard-coded operational thresholds from governed decision paths or explicitly confine them to simulation fixtures.
2. Consolidate SIR, OpenClaw, Javis, gateway, and autonomous orchestration into one canonical runtime and data model.
3. Separate starter-workspace provisioning from infrastructure/deployment claims.
4. Replace inert connector controls with real bounded connector workflows or label them clearly as planned.
5. Establish measurement-quality, time-quality, calibration, and uncertainty controls.
6. Complete technical change/configuration assurance and return-to-service governance.
7. Add runtime output schemas, model evaluations, adversarial tests, controlled model promotion, and rollback.
8. Archive or label stale completion and audit reports so they cannot be mistaken for current evidence.

## Truthful current-state positioning

Use:

> **SyncAI is a governed industrial engineering intelligence platform in advanced pilot development. It combines an implemented recommendation, evidence, approval, work, KPI, onboarding, inspection, and asset-intelligence foundation with expanding Engineering DNA, digital-twin, physics, and engineering-knowledge capabilities. Production integrations, enterprise identity, authorization hardening, end-to-end governed RAG, private/edge deployment, independent security assurance, and formal certifications remain deployment or roadmap work.**

Do not use as a general current-state claim:

- fully autonomous industrial operations;
- production-ready enterprise SSO;
- production SAP, Maximo, PI, SCADA, OPC-UA, or other named connector support;
- completed end-to-end governed RAG or knowledge graph;
- air-gapped, on-prem, sovereign, or edge deployment availability;
- comprehensive role-based authorization;
- SOC 2, ISO 27001, defence, aerospace, OT-security, or functional-safety certification;
- independently verified customer savings;
- autonomous control-system or command-system execution.

## Target-state priorities

The strongest target-state differentiators are:

1. one canonical secure orchestration and engineering knowledge plane;
2. authenticated tenant-derived service boundaries and fine-grained authorization;
3. trustworthy industrial data, metrology, lineage, and evidence fitness;
4. technical change and configuration assurance from requirement to verified outcome;
5. validated digital twins and deterministic engineering models;
6. real read-only industrial connectors with reconciliation and observability;
7. human-systems integration and qualified technical authority;
8. immutable technical-assurance evidence packs;
9. model assurance, controlled promotion, rollback, and independent validation;
10. deployable, supportable, independently tested enterprise architecture.

The complete design direction is maintained in [`enterprise-target-state.md`](enterprise-target-state.md).

## Recommended execution sequence

### Phase 0 — Contain and converge

- disable or restrict unsupported legacy service-role functions;
- remove production demo/auth bypasses;
- repair enterprise SSO or hide it;
- repair Supabase CI and E2E;
- designate canonical schemas and orchestration runtime;
- mark stale documents and compatibility surfaces.

### Phase 1 — Make the pilot defensible

- complete active-schema governed RAG;
- enforce fine-grained authorization;
- replace generic thresholds with approved customer configuration;
- implement one historian and one CMMS read-only connector;
- establish data-quality and evidence-fitness gates;
- add immutable recommendation evidence packages.

### Phase 2 — Make the enterprise deployment repeatable

- add reference architecture, threat model, hardening, SLO, backup, recovery, and support packages;
- add enterprise OIDC, MFA policy, privileged access, customer-managed keys, SIEM, and audit exports;
- add deployment automation for the chosen hosted/private pattern;
- execute independent penetration and resilience testing;
- implement pilot-to-production acceptance gates.

### Phase 3 — Expand high-consequence assurance

- technical-change and configuration-assurance lifecycle;
- independent model and physics validation;
- sector assurance profiles;
- controlled edge/disconnected patterns where commercially required;
- formal certification and authorization programs;
- verified customer outcome evidence.

## Documentation governance

The current source-of-truth order should be:

1. this capability audit for product maturity;
2. `docs/enterprise-readiness/claims-and-evidence-register.md` for commercial claims;
3. `docs/gtm-readiness.md` for go-to-market gating, after it is reconciled to this audit;
4. active migrations, deployed functions, tests, and production evidence for technical verification;
5. `docs/enterprise-target-state.md` for desired-state design direction.

Historical documents such as `FINAL-AUDIT-REPORT.md`, `OPERATIONAL-COMPLETION-REPORT.md`, and broad “completed” reports must be labelled historical or archived. They contain earlier counts and claims that no longer represent the current repository.

## Bottom line

SyncAI already contains a differentiated product foundation. Its strongest assets are governed human approval, a real operating-loop data model, broad asset and reliability workflows, Engineering DNA, deterministic physics, inspection governance, and an explicit refusal to invent engineering authority.

The path to organizations such as major energy operators, aerospace companies, defence departments, utilities, and other high-risk enterprises is not to add more feature labels. It is to converge the architecture, secure every service boundary, connect real industrial data, prove authorization and evidence integrity, validate outcomes, and make current-versus-target claims impossible to confuse.
