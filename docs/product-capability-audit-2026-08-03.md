# SyncAI Product Capability Audit

**Audit date:** 2026-08-03  
**Audited branch:** `main`  
**Initial reference commit:** `a07f920c1271a46154885670332da680f00c087d`  
**Post-audit correction commit:** `076b8c5656d2d336a727c879b7e6137a09e216be`

## Purpose

This audit establishes an evidence-based representation of:

1. what SyncAI currently implements;
2. what is implemented as a foundation but not yet end-to-end operational;
3. what is simulated, demo-oriented, incomplete, legacy, or externally unvalidated;
4. what remains necessary for enterprise deployment in high-risk,
   asset-intensive organizations.

It governs README, sales, pilot, security, architecture, and roadmap claims.

## Method and limitations

The review covered all major repository layers discoverable through the connected
GitHub index:

- application routes, pages, components, hooks, and services;
- the active Supabase migration chain and relevant archived migrations;
- Row Level Security, RPCs, triggers, scheduled jobs, and persistence contracts;
- Edge Functions and orchestration runtimes;
- asset twins, Engineering DNA, Shared Component DNA, physics, inspections,
  engineering knowledge, and RAG;
- authentication, MFA, enterprise access, tenancy, approvals, audit, and
  security controls;
- integrations, deployments, edge-node artifacts, billing, marketplace, tests,
  CI/CD, compliance, readiness, and historical reports;
- recent merged and open pull requests that materially affect product state.

A local clone was attempted for literal line-by-line review, but the execution
environment could not resolve GitHub. This is therefore a repository-wide
capability audit based on GitHub-indexed source, not a penetration test,
production-configuration attestation, independent verification and validation
exercise, certification, or guarantee that every static asset and historical
prose file was manually read.

Hosted configuration, customer deployments, external integrations, security
controls, resilience, model performance, and certifications require independent
runtime validation.

## Post-audit correction

During the audit, migration and Playwright CI were failing. The failure was
subsequently diagnosed and repaired in PR #117.

The confirmed cause was two active migrations sharing version
`00000000000019`. The security-log migration was moved to version 21, the
Supabase CLI setup was refreshed, and startup diagnostics were added. The
following gates then passed together:

- lint, TypeScript, and production build;
- unit tests;
- clean local Supabase startup;
- the complete ordered migration chain;
- seeded login, organization-scoped RLS read, and app-shell context RPC;
- continuous-agent-loop smoke and idempotency;
- Playwright golden path;
- CodeQL and secret scanning.

CI is therefore an **operational foundation**, not a current blocker. This
correction does not change the broader enterprise-readiness findings below.

## Maturity definitions

| Classification | Meaning |
| --- | --- |
| **Operational foundation** | Working code and active persistence exist, with meaningful application use or automated validation. External production assurance may remain incomplete. |
| **Pilot-capable** | Suitable for bounded, supervised use with agreed data, users, controls, and acceptance criteria. |
| **Implemented foundation** | Contracts, libraries, schemas, or workflows exist but require integration, field validation, or production hardening. |
| **Simulation/demo** | Uses seeded, generated, or simulated data to validate workflow behavior. |
| **Incomplete or unsafe** | A visible surface exists but security, tenancy, correctness, deployment, or operational controls are insufficient. |
| **Design evidence only** | Documentation, schema history, or inactive code shows intent but not an active supported capability. |
| **Externally unvalidated** | The repository cannot prove the hosted configuration, customer outcome, independent assurance, or certification claim. |

## Executive conclusion

SyncAI is an **advanced governed industrial-engineering pilot**. It is more than
a prototype: the repository contains a broad application, active Supabase data
plane, operating-loop records, tenant-scoped workflows, human approvals,
reliability and KPI services, asset onboarding, deterministic engineering
libraries, inspection governance, AI orchestration, automated tests, and a
reproducible migration/E2E gate.

It is not yet a generally production-ready platform for unrestricted
high-consequence use. The largest remaining gaps are enterprise identity,
fine-grained authorization, canonical-runtime consolidation, end-to-end
governed engineering knowledge, production industrial connectors, trustworthy
measurement governance, technical-change assurance, private/edge deployment,
independent security and model assurance, and verified customer outcomes.

The primary category remains:

> **Governed Industrial Engineering Intelligence for high-risk,
> asset-intensive operations.**

“Mission assurance” is a defence or aerospace outcome, not the universal product
category.

## Repository-wide capability assessment

### 1. Application and operating surfaces

**Classification: Operational foundation / pilot-capable**

The authenticated application exposes broad operational and management
surfaces, including assets, sensors, recommendations, evidence, scenarios,
approvals, work orders, operational briefing, reliability, risk, integrations,
value, research, deployments, trust, administration, and executive views.

This demonstrates substantial product breadth. Route presence alone does not
prove every surface has equivalent production maturity. Several pages read
active Supabase records, while others are compatibility, configuration, seeded,
or presentation layers.

**Representative evidence**

- `src/App.tsx`
- `src/lib/roleNavigation.ts`
- `src/services/operatingLoopService.ts`
- `src/pages/OperationalBriefing.tsx`
- `src/pages/IntegrationHealthPanel.tsx`
- `src/pages/IntegrationsPage.tsx`

### 2. Core data plane and operating loop

**Classification: Operational foundation**

The active migration chain implements organization-scoped records for assets,
sensors, agents, runs, recommendations, evidence, scenarios, work orders,
approvals, decisions, value, learning, onboarding, integrations, and related
operational records.

The system has real RLS and an app-current-organization boundary. However, many
core tables use broad same-organization read/write policies. Comprehensive
role-, site-, asset-, program-, classification-, and action-level write
authorization is not yet consistently evidenced.

**Representative evidence**

- `supabase/migrations/00000000000001_operating_loop_baseline.sql`
- `supabase/migrations/00000000000005_rls_hardening.sql`
- `supabase/migrations/00000000000006_function_grants.sql`
- `supabase/migrations/00000000000008_value_verification.sql`
- `supabase/migrations/00000000000013_realtime_operating_picture.sql`

### 3. CI, migration reproducibility, and E2E

**Classification: Operational foundation**

The repository now validates:

- lint, type-check, and production build;
- Vitest unit tests;
- clean local Supabase startup;
- every active migration from an empty database;
- seeded authentication, RLS, and app-shell RPC behavior;
- continuous-agent-loop execution and idempotency;
- the Playwright golden path;
- CodeQL and secret scanning.

Failure-only Supabase and Docker artifacts preserve startup evidence.

**Representative evidence**

- `.github/workflows/ci.yml`
- `scripts/ci-start-supabase.sh`
- `tests/e2e/golden-path.spec.ts`
- active migrations 1 through 21, with unique version numbers

### 4. Canonical AI and approval runtime

**Classification: Pilot-capable operational foundation**

The strongest active AI path is:

`ai-agent-processor` → governed intelligence decision →
`autonomous-orchestrator` → approval → bounded downstream action.

Strengths include:

- authenticated user or internal-service context;
- organization-scoped work-order and asset retrieval;
- idempotent orchestration runs;
- correlation IDs and audit records;
- confidence and human-review flags;
- mandatory approval records;
- a narrow action allow-list;
- direct autonomous execution disabled.

Remaining issues include limited strongly typed output validation, generic
condition thresholds in some monitoring logic, incomplete model-evaluation
controls, and the coexistence of other less-secure runtimes.

**Representative evidence**

- `supabase/functions/ai-agent-processor/index.ts`
- `supabase/functions/autonomous-orchestrator/index.ts`
- `supabase/migrations/00000000000009_llm_enrichment.sql`

### 5. Asset onboarding and RAM governance

**Classification: Pilot-capable foundation**

Asset onboarding persists sessions, steps, evidence, reliability profiles,
failure-mode libraries, strategy recommendations, approvals, and exports.
Readiness gates distinguish known data, assumptions, missing evidence, and
human approval requirements.

The platform should not claim that every asset is field-validated merely because
an onboarding session or starter template exists.

**Representative evidence**

- `src/lib/asset-onboarding.ts`
- `src/services/assetOnboardingPersistence.ts`
- `docs/asset-onboarding.md`
- `supabase/migrations/00000000000011_autonomous_onboarding.sql`
- `supabase/migrations/00000000000012_onboarding_governance.sql`

### 6. KPI and operating-performance intelligence

**Classification: Operational foundation with external-data dependencies**

The KPI service stores formulas, targets, RACI ownership, audience controls,
lineage, confidence, calculated values, and breach-triggered recommendations.
It honestly identifies KPIs that cannot be computed without ERP, historian,
mobile, strategy, or assessment inputs.

This is a strong governance pattern. Values based on seeded or proxy data must
not be represented as verified customer performance.

**Representative evidence**

- `supabase/migrations/00000000000017_kpi_service.sql`

### 7. Engineering DNA and digital twins

**Classification: Implemented foundation**

The repository contains manufacturer-neutral asset templates, Engineering DNA,
OEM/model overlays, customer instances, shared component definitions,
validation rules, maturity states, evidence references, compilation logs, and
approval boundaries.

The active library covers multiple mobile mining and fixed/process asset
classes. Most engineering records remain draft until customer, OEM, site, or
engineering evidence is approved.

**Representative evidence**

- `src/lib/asset-twins/index.ts`
- `src/lib/asset-twins/compiler.ts`
- `src/lib/asset-twins/engineering-dna.ts`
- `src/lib/asset-twins/shared-component-dna-library.ts`
- `supabase/migrations/00000000000019_asset_twin_library.sql`

### 8. Deterministic physics

**Classification: Implemented foundation**

The physics library separates deterministic calculations from generative AI,
requires defined units and formula references, preserves assumptions, requires
engineering approval, and prohibits autonomous operational action.

Current calculations are useful engineering building blocks, not a complete
validated multi-physics simulation environment. Site and OEM limits must come
from approved evidence.

**Representative evidence**

- `src/lib/asset-twins/physics-capability.ts`
- `src/lib/asset-twins/physics-capability-library.ts`

### 9. Inspection intelligence

**Classification: Strong implemented foundation / pilot-capable slice**

Inspection findings reference canonical components, failure modes, inspection
contracts, evidence artifacts, repeatability keys, confidence, review state,
and independent verification.

Recommendation packages preserve evidence and approval ownership, prohibit
unsafe autonomous actions, and persist recommendation, approval, and evidence
records atomically and idempotently.

This is one of the repository's strongest governed engineering slices. Field
capture applications, validated computer-vision models, and complete assurance
pack export remain separate work.

**Representative evidence**

- `src/lib/asset-twins/inspection-contracts.ts`
- `src/lib/asset-twins/inspection-findings.ts`
- `src/lib/asset-twins/inspection-recommendations.ts`
- `supabase/migrations/00000000000020_inspection_recommendation_persistence.sql`

### 10. Engineering knowledge and extraction

**Classification: Implemented deterministic foundation; not end-to-end**

The engineering ontology defines canonical entities, relationships, authority,
review state, confidentiality, provenance, applicability, and supersession.
The Knowledge Base Factory can publish, route for review, or reject proposed
knowledge mappings. Extraction resolution applies confidence and provenance
requirements and refuses unknown or ambiguous canonical mappings.

Asset-aware retrieval in draft PR #115 adds tenant, twin, asset-class,
component, failure-mode, physics, authority, freshness, provenance, and conflict
rules.

The missing layer is a single active-schema, authenticated, persisted ingestion
and retrieval service that connects document processing, approval, canonical
mapping, embeddings, revision control, retrieval, citations, and audit.

**Representative evidence**

- `src/lib/engineering-knowledge/ontology.ts`
- `src/lib/engineering-knowledge/knowledge-base-factory.ts`
- `src/lib/engineering-knowledge/engineering-extraction.ts`
- draft PR #115

### 11. Legacy RAG

**Classification: Incomplete and not part of the supported production boundary**

Legacy document-processing and semantic-search functions exist, but their
knowledge-base tables are associated with archived migrations rather than the
active deterministic chain. They also do not apply the newer authority,
review, supersession, and canonical-engineering contracts end to end.

These functions should be replaced or converged, not promoted as the final
engineering-knowledge runtime.

**Representative evidence**

- `supabase/functions/rag-document-processor/index.ts`
- `supabase/functions/rag-semantic-search/index.ts`
- relevant files under `supabase/_legacy_migrations/`

### 12. Integrations

**Classification: Registry and health foundation; production connectors not proven**

The application stores connector and integration records, sync history, health,
last-sync time, and record counts. UI options reference SAP, Maximo, PI,
Ignition, OPC-UA, MQTT, REST, and CSV.

These surfaces do not prove that production-grade connectors, authentication,
schema mapping, replay, reconciliation, retry, dead-letter handling, support,
or customer validation exist for those systems.

**Representative evidence**

- `src/pages/IntegrationsPage.tsx`
- `src/pages/IntegrationHealthPanel.tsx`
- integration tables in the active compatibility migration

### 13. Deployment and edge

**Classification: Workspace provisioning is simulated/pilot; edge is design evidence**

`provision_deployment()` creates a site, starter assets, sensors, onboarding,
workspace, notification, and audit records inside SyncAI. It is a useful pilot
factory, not customer infrastructure deployment.

Edge-node functions and schemas show design intent, but the required schema is
associated with archived migrations and the reviewed function does not provide
an adequate enterprise node-authentication boundary.

Do not claim supported private-cloud, on-premises, sovereign, edge, or
air-gapped deployment until repeatable deployment packages, identity,
certificate lifecycle, update, rollback, observability, recovery, and support
are validated.

**Representative evidence**

- `supabase/migrations/00000000000015_autonomous_deployment.sql`
- `src/pages/DeploymentConfiguratorPage.tsx`
- `supabase/functions/edge-node-manager/index.ts`

### 14. Authentication and enterprise access

**Classification: Mixed; enterprise SSO incomplete and security-sensitive**

Supabase password login and per-user TOTP paths are real application code.
Enterprise and alternative-login surfaces are incomplete:

- company-code validation is marked mock;
- the Azure exchange path does not establish a proper Supabase session;
- a decoded identity token is not equivalent to verified issuer, signature,
  audience, nonce, and tenant validation;
- organization-wide MFA enforcement is not complete;
- demo mode and inactive provider buttons must not be confused with
  authenticated enterprise access.

Enterprise SSO must be rebuilt around supported OIDC/SAML and Supabase session
semantics with testable tenant and role provisioning.

### 15. Legacy orchestration runtimes

**Classification: Duplicate and security-sensitive**

SIR, OpenClaw, gateway, model-router, marketplace, and other historical
functions coexist with the canonical runtime. Some use service-role clients and
accept caller-supplied tenant, user, session, or sensitivity values without a
sufficient identity-to-tenant boundary.

They are not deployed by the active production workflow and should not be used
as production-readiness evidence. Useful capabilities should be migrated into
one canonical runtime; the remaining functions should be disabled, archived,
or removed after dependency review.

**Representative evidence**

- `supabase/functions/sir-orchestrator/index.ts`
- `supabase/functions/openclaw-orchestrator/index.ts`
- `supabase/functions/gateway/index.ts`
- `supabase/functions/model-router/index.ts`

### 16. Active deployment boundary

**Classification: Defined but narrow**

The active deployment workflow pushes the ordered migration chain and deploys:

- `agent-loop-enrich`;
- `ai-agent-processor`;
- `autonomous-orchestrator`;
- `onboarding-enrich`.

Other Edge Functions in the repository are not automatically part of the active
supported boundary.

**Representative evidence**

- `.github/workflows/deploy-migrations.yml`

### 17. Security and compliance

**Classification: Readiness foundation; externally unvalidated**

The repository includes RLS, grants, security-event records, audit trails,
CodeQL, secret scanning, dependency review, policies, mappings, evidence
indexes, and compliance documentation.

Repository evidence does not prove hosted hardening, key management, customer
isolation, incident response performance, disaster recovery, penetration-test
results, SOC 2, ISO 27001, defence authorization, OT-security certification, or
functional-safety certification.

The correct claim is **readiness and audit preparation**, not certification.

## Confirmed gaps by priority

### P0 — required before high-consequence enterprise production

1. **Enterprise identity and access**
   - supported OIDC/SAML session establishment;
   - issuer, signature, audience, nonce, tenant, and domain validation;
   - phishing-resistant MFA and organization enforcement;
   - lifecycle provisioning and deprovisioning;
   - role-, site-, asset-, action-, and classification-aware authorization.

2. **Canonical runtime consolidation**
   - inventory every Edge Function and caller;
   - migrate useful capabilities to the canonical runtime;
   - eliminate caller-controlled tenant identities;
   - require authenticated internal-service credentials;
   - disable or remove duplicate service-role runtimes.

3. **Governed engineering knowledge runtime**
   - active migrations for documents, revisions, chunks, embeddings, mappings,
     approvals, supersession, and retrieval logs;
   - authenticated tenant and asset scope;
   - canonical authority and applicability rules;
   - conflict surfacing, citations, abstention, and audit.

4. **Fine-grained authorization**
   - database and service enforcement beyond same-organization membership;
   - separation of read, propose, approve, execute, administer, and audit powers;
   - negative cross-tenant and cross-role tests.

5. **Production data trust**
   - calibration status, units, uncertainty, drift, freshness, latency, quality,
     substitution, time synchronization, and derived-tag lineage;
   - evidence-fitness gates before high-consequence recommendations.

6. **Technical change and configuration assurance**
   - requirement and design-basis linkage;
   - management of change, deviation, waiver, and temporary-change control;
   - configuration baselines, implementation evidence, return-to-service review,
     verification, rollback, and supersession.

### P1 — required for repeatable pilots and enterprise procurement

1. One production historian or telemetry connector.
2. One production CMMS/EAM connector with bounded write-back.
3. Typed model inputs and outputs with schema rejection.
4. Model registry, evaluation, red-team, rollback, and incident controls.
5. Immutable technical-assurance evidence packs.
6. Historical replay, shadow mode, scenario testing, and acceptance gates.
7. Human-systems integration: workload, handover, competency, explanation,
   automation-bias, mobile, offline, and accessibility controls.
8. Service levels, observability, backup, recovery, patch, support, and exit
   procedures.
9. Independent penetration testing and remediation evidence.
10. A measured pilot with verified operational and economic outcomes.

### P2 — strategic expansion

- persistent engineering knowledge graph and graph services;
- broad OEM and asset-class coverage;
- private-cloud, on-premises, sovereign, edge, and disconnected packages;
- sector assurance profiles for energy, mining, utilities, aerospace, defence,
  transportation, and manufacturing;
- portfolio optimization and enterprise scenario planning;
- completed SOC 2, ISO 27001, and applicable sector authorization.

## Claims that are supportable now

SyncAI may be described as:

- a governed Industrial Engineering Intelligence platform in advanced pilot
  development;
- a multi-tenant Supabase application with organization-scoped operating data;
- a human-approved operating-loop and AI decision-support foundation;
- a platform with governed asset onboarding, KPI, asset-DNA, twin, physics,
  inspection, evidence, approval, work, value, and learning capabilities;
- a repository with reproducible build, unit, clean-migration, smoke, E2E,
  CodeQL, and secret-scan gates;
- a platform whose active autonomous boundary is advisory and approval-gated;
- a product with SOC 2 and ISO 27001 readiness material, not completed
  certification.

## Claims that are not supportable without additional evidence

Do not state that SyncAI currently has:

- general production readiness for unrestricted high-consequence use;
- complete enterprise SSO or comprehensive least-privilege authorization;
- certified SAP, Maximo, PI, SCADA, OPC-UA, MQTT, ERP, PLM, or other industrial
  integrations;
- complete governed RAG or a production persistent knowledge graph;
- supported private-cloud, on-premises, edge, sovereign, or air-gapped
  deployment;
- autonomous authority over process control, protection settings, shutdown,
  return-to-service, safety-critical work, or command systems;
- independently validated model performance, resilience, cybersecurity, or
  customer value;
- SOC 2, ISO 27001, defence, aerospace, OT-security, or functional-safety
  certification unless formal evidence is obtained.

## Recommended execution order

1. Merge and enforce the repaired CI baseline.
2. Merge the audited documentation and claims boundary.
3. Complete asset-aware retrieval and connect it to the active governed
   knowledge runtime.
4. Repair enterprise identity and fine-grained authorization.
5. Consolidate orchestration and disable unsafe legacy functions.
6. Build active-schema governed document ingestion and retrieval.
7. Implement data-trust and technical-change assurance.
8. Deliver one historian and one CMMS/EAM connector for a bounded pilot.
9. Run shadow-mode and controlled pilot validation with defined acceptance
   criteria.
10. Complete independent security, resilience, model, compliance, and customer
    outcome evidence.

## Audit governance

- The README summarizes this audit; it must not exceed this evidence boundary.
- The Enterprise Target State describes desired completion, not delivered state.
- The Claims and Evidence Register controls commercial wording.
- Historical completion reports are not current evidence unless reconciled to
  this audit.
- Every material new capability should update its maturity, evidence path,
  deployment status, test status, and permitted claim.
- Simulated, pilot, implemented, production-validated, independently assured,
  and certified states must remain visibly distinct.
