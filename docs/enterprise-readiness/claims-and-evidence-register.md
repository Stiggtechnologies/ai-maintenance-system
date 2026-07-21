# SyncAI Claims and Evidence Register

Purpose: prevent unsupported sales, security, deployment, integration, and customer-result claims.

## Status definitions

- **Verified live** — demonstrated in the current production or hardened cloud environment with repository evidence.
- **Implemented, external validation pending** — code or configuration exists, but customer tenant, third-party test, audit, or certification is required.
- **Design-supported** — architecture can support the capability, but the deployment pattern has not been fully packaged and validated.
- **Customer-specific** — requires scoped engineering and acceptance testing.
- **Not authorized externally** — may not be represented to a prospect.

## Product and operations

| Claim | Status | Approved external wording | Evidence / condition |
|---|---|---|---|
| Autonomous operating loop | Verified live | SyncAI continuously senses, detects, recommends, routes actions for human approval, and verifies outcomes. | README; GTM readiness; cloud demonstrations. |
| Human-in-the-loop controls | Verified live | Operational recommendations require governed human approval; SyncAI does not autonomously write to safety- or production-critical controls. | Approval and decision workflows; E2E tests. |
| Real-time data | Verified live with simulator | SyncAI supports real-time operating views; current demo telemetry is simulated until a customer historian is connected. | README and GTM readiness. |
| Reliability AI agents | Verified live | Ten chartered reliability-agent types produce RAG-cited analysis and structured work products. | README; reliability KB documentation. |
| ISO 55000 KPI layer | Verified live | SyncAI includes an ISO 55000-aligned KPI and RACI governance layer with lineage and role-based access. | README; migrations and KPI documentation. |
| 90-day pilot scorecard | Verified live | SyncAI includes pilot scorecards and verified-value workflows. | GTM readiness. |
| Quantified customer savings | Not authorized externally unless evidenced | A pilot will establish the baseline and validate value; no guaranteed savings are promised. | Named evidence and customer authorization required. |

## Security and compliance

| Claim | Status | Approved external wording | Evidence / condition |
|---|---|---|---|
| Tenant isolation | Verified live | Organization-scoped row-level security and database-enforced access controls isolate customer records. | README; migrations; RLS tests. |
| MFA | Verified live | TOTP MFA and sign-in challenge are implemented. | README; security audit work. |
| Security audit log | Verified live | Security-relevant events and role changes are captured in an append-only audit log. | README; migration and UI evidence. |
| Secure CI/CD | Verified live | Required CI checks include lint/typecheck, tests, migration/auth checks and E2E; CodeQL, secret scanning and dependency updates are enabled. | README; GitHub workflows. |
| SOC 2 compliant/certified | Not authorized externally | SyncAI has implemented technical controls aligned with SOC 2; independent examination and applicable evidence period remain. | Independent auditor report required. |
| ISO/IEC 27001 certified | Not authorized externally | SyncAI has implemented technical controls aligned with ISO/IEC 27001; accredited certification audit remains. | Certificate required. |
| Audit-ready today | Not authorized without current evidence review | SyncAI maintains a readiness pack and is preparing evidence for independent review. | Organizational evidence, pen test, risk assessment and audit readiness review required. |
| Penetration tested | External validation pending | Independent penetration testing is scheduled/pending. | Report or executive summary required before saying completed. |

## Deployment

| Claim | Status | Approved external wording | Evidence / condition |
|---|---|---|---|
| Shared SaaS | Verified live | Available for demonstrations and approved pilot use. | Current hosted environment. |
| Dedicated cloud | Design-supported | Available subject to solution design, provisioning and validation. | Deployment runbook and acceptance test required. |
| Customer VPC | Design-supported | Customer-cloud/VPC deployment can be designed to customer requirements. | IaC, networking and support model must be validated. |
| On-premises | Design-supported | On-premises deployment is subject to architecture and lifecycle validation. | Packaging, upgrades, monitoring, backup and support evidence required. |
| Edge | Design-supported | Customer-side gateway/edge patterns are supported through solution design. | Gateway package and validation required. |
| Fully air-gapped | Customer-specific | Air-gapped installation requires a dedicated architecture, model, update, key-management and support plan. | Formal engineering and acceptance required. |
| Data residency | Customer-specific | Residency is committed only after cloud region, AI providers, logging, backups and subprocessors are confirmed contractually. | Data-flow and subprocessor review required. |

## Integrations

| Claim | Status | Approved external wording | Evidence / condition |
|---|---|---|---|
| Integration-first architecture | Verified live | SyncAI connects through APIs, database views, file exchange, event streams or a customer-side gateway. | Edge functions, database and connector patterns. |
| Integrates with any software | Not authorized without qualification | Requested integrations are classified as production-validated, sandbox-tested, configurable from an existing pattern, or custom engineering. | Connector catalogue required. |
| PI/historian production connector | External validation pending | Historian integration is pilot-ready subject to access to a customer system or authorized sandbox. | Live connector validation required. |
| SAP PM/Maximo production sync | External validation pending | CMMS integration is available for scoped validation; production status depends on the connector and customer environment. | Sandbox/customer validation required. |
| Read-only pilot | Verified design and preferred offer | Initial pilots can operate read-only and avoid write access to operational systems. | Customer-specific permissions and data flow required. |
| Write-back | Customer-specific | Write-back requires separate authorization, testing, rollback and change-control approval. | Customer acceptance required. |

## AI and data use

| Claim | Status | Approved external wording | Evidence / condition |
|---|---|---|---|
| Model providers | Verified current architecture | Current server-side AI paths support OpenAI and Gemini. Other approved models may be integrated through solution design. | Edge-function configuration. |
| Customer data never trains external models | Contract/configuration dependent | Customer data is processed only under the approved provider terms and configuration; training and retention settings are confirmed per deployment. | Provider contract, account settings and DPA required. |
| Model-agnostic | Design-supported | The architecture is designed to support multiple approved model providers. | Each provider integration must be validated. |
| Fully local model | Customer-specific | Private/local models can be evaluated for dedicated or restricted deployments. | Engineering and acceptance required. |

## Customers and references

| Claim | Status | Approved external wording | Evidence / condition |
|---|---|---|---|
| Named customer deployment | Not authorized unless listed in an approved reference schedule | SyncAI works with asset-intensive organizations; customer names are shared only with permission. | Written authorization required. |
| Private reference call | Case-by-case | A private reference may be arranged for a qualified prospect subject to customer permission. | Orville approval and customer consent required. |
| Team experience equals SyncAI deployment | Not authorized | Distinguish the team's industrial experience from SyncAI customer deployments. | Clear attribution required. |

## Review and ownership

- Business owner: Orville Davis.
- Technical evidence owner: to be assigned.
- Security/compliance evidence owner: to be assigned.
- Review cadence: monthly and before any major campaign, proposal, security review, or audit.
- Any representative must use this register and obtain written approval for exceptions.
