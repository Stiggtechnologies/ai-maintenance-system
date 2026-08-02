# Reliability Engineering Copilot PRD

## Product Thesis

Reliability Engineering Copilot is the first bootstrap product for SyncAI.

It is a commercially sellable, domain-specific reliability engineering assistant
that turns asset, maintenance, inspection, condition-monitoring, and failure
history data into defensible engineering decisions.

It should be sold first as a focused product, not as the entire SyncAI platform.
The broader SyncAI platform becomes the expansion path.

## Positioning

Name:

> SyncAI Reliability Engineering Copilot

Category:

> Governed reliability engineering decision support for asset-intensive
> industries.

Core promise:

> Give reliability and maintenance teams a senior reliability engineer in the
> workflow: RAG-grounded, calculation-backed, standards-aware, and governed by
> approval controls.

Do not position it as:

- A generic maintenance chatbot.
- A CMMS replacement.
- A fully autonomous maintenance system.
- A guaranteed reliability improvement engine.

## Why This Is The Bootstrap Wedge

This is more practical than selling the whole industrial AI platform first
because:

- It can start from uploaded files, CSV/XLSX exports, and customer documents.
- It does not require deep live enterprise integrations on day one.
- It maps directly to recognized reliability workflows.
- It creates useful output quickly: RCA, FRACAS, FMEA, PM review, bad actor
  analysis, and executive reports.
- It is easier to demonstrate than a broad “15-agent platform.”
- It can become a paid expert workflow tool before the full marketplace SaaS is
  ready.

## Target Customers

Initial ICP:

- Reliability engineers.
- Maintenance engineers.
- Maintenance managers.
- Asset management teams.
- Reliability consultants.
- Industrial operators with asset-intensive environments.

Best early verticals:

- Oil sands and oil and gas.
- Mining.
- Petrochemical.
- Utilities and power.
- Heavy manufacturing.
- Pulp and paper.
- Rail / fleet / ports.

Best buyer type for bootstrapping:

- Reliability consultants who can use the product on many clients.
- Mid-market industrial operators with faster buying cycles.
- Site-level maintenance/reliability leaders with budget authority.

## Core Use Cases

The copilot must handle:

- Failure history analysis.
- Root cause analysis.
- FRACAS / DCACAS workflows.
- FMEA / FMECA facilitation.
- RCM and PM optimization.
- Asset criticality assessment.
- Bad actor analysis.
- MTBF, MTTR, availability, failure rate, and reliability calculations.
- Weibull / life data analysis.
- RAM analysis and trade-off support.
- Maintenance strategy development.
- Executive reliability reporting.

The complete capability taxonomy is maintained in
[Reliability Engineering Copilot Capability Map](reliability-engineering-copilot-capabilities.md).

## MVP Scope

### Phase 1: Copilot MVP

Required:

- Auth and tenant isolation.
- Chat interface.
- File upload.
- Document ingestion and retrieval.
- Citation-aware RAG responses.
- Reliability calculation tools.
- Conversation history.
- Markdown/PDF report export.
- Admin prompt/version controls.
- Audit log for assistant outputs.

Initial document types:

- PDF.
- DOCX.
- XLSX/CSV.
- Markdown/text.

Initial knowledge base:

- Customer-uploaded documents.
- Public reliability references where licensing permits.
- Summarized reliability methods.
- Customer standards and failure codes when provided.

### Phase 2: Reliability Data Analysis

Required:

- CSV/XLSX asset import.
- Work order import.
- Failure event normalization.
- Asset hierarchy mapping.
- Bad actor Pareto.
- MTBF / MTTR / availability dashboard.
- Natural-language analysis over imported data.

### Phase 3: FRACAS / RCA Workspace

Required:

- FRACAS case CRUD.
- Failure event intake.
- Evidence log.
- RCA assistant.
- Corrective/preventive action register.
- Owner and due date tracking.
- Verification and effectiveness review.
- Failure review board package export.

### Phase 4: Strategy Engine

Required:

- FMEA/FMECA builder.
- RCM decision logic.
- PM optimization recommendations.
- Criticality assessment.
- Maintenance strategy library.
- Life cycle cost analysis.
- Spares/supportability recommendations.

### Phase 5: Enterprise Expansion

Required:

- SAP / Maximo / CMMS integrations.
- SSO/SAML/SCIM.
- Private tenant deployment.
- Role-based approvals.
- Model governance.
- Evaluation dashboard.
- Power BI export/integration.

## OpenAI Architecture Direction

Use the OpenAI Responses API for the main agent loop because it supports
stateful, tool-using interactions and can call built-in tools or custom
functions. Use file search for hosted RAG over uploaded files where appropriate,
and custom function tools for deterministic reliability calculations and product
database operations.

Recommended components:

- **Responses API** for chat, tool calls, structured outputs, and stateful
  interaction.
- **File search / vector stores** for customer documents and reliability
  knowledge bases where hosted retrieval is appropriate.
- **Custom function tools** for deterministic calculations and application
  workflows.
- **Streaming responses** for chat UX.
- **Evaluation suite** for hallucination, citation, calculation, and unsafe
  recommendation checks.

Keep deterministic engineering calculations outside the LLM. The model may
choose and explain tools; the calculation engine performs the math.

## Agent Roles

Do not expose all roles as separate products immediately. Internally, structure
the system around specialized modes:

1. Reliability Engineering Agent
   General reliability reasoning and standards-aware recommendations.

2. Data Analyst Agent
   CMMS exports, failure histories, Pareto, MTBF, MTTR, Weibull, and dashboard
   interpretation.

3. RCA / FRACAS Agent
   Failure investigations, evidence, cause mapping, corrective action, and
   recurrence prevention.

4. FMEA / RCM Agent
   Functional failures, failure modes, effects, consequences, maintenance tasks,
   and intervals.

5. RAM Modeling Agent
   Availability, maintainability, reliability block diagrams, redundancy, and
   trade-off calculations.

6. Executive Reporting Agent
   Plant-manager, VP, and board-level reliability narratives.

7. Governance Agent
   Citation checks, assumptions, missing data, unsafe recommendations, and
   confidence statements.

## Deterministic Tooling

Initial calculation tools:

- MTBF.
- MTTR.
- Inherent availability.
- Operational availability.
- Failure rate.
- Exponential reliability.
- PM compliance.
- Schedule compliance.
- Break-in work percentage.
- Emergency work percentage.
- Planned vs unplanned work.
- Bad actor Pareto.
- Cost of unreliability.
- Weibull fitting placeholder, then full implementation.
- Crow-AMSAA placeholder, then full implementation.
- Criticality / risk scoring.

Every calculation output must include:

- Inputs used.
- Formula.
- Result.
- Units.
- Assumptions.
- Data quality warning where applicable.

## FRACAS Data Model

Minimum FRACAS fields:

- Case ID.
- Tenant ID.
- Asset ID.
- Event datetime.
- Operating context.
- Failure symptom.
- Functional failure.
- Failure mode.
- Failure mechanism.
- Immediate cause.
- Root cause.
- Contributing factors.
- Evidence summary.
- Corrective action.
- Preventive action.
- Owner.
- Due date.
- Verification method.
- Effectiveness check date.
- Status.
- Recurrence detected.

## RAG Rules

When retrieved documents are available:

- Use them.
- Cite them.
- Separate retrieved facts from generated recommendations.
- Prefer summaries over long quotes.
- Show confidence and document gaps.

When no source supports the answer:

- Say so.
- Provide bounded general engineering guidance only.
- Ask for missing evidence when needed.

Do not embed copyrighted standards verbatim unless redistribution rights are
confirmed. Use summaries or customer-provided licensed materials.

## Engineering Governance

Human approval is required for recommendations involving:

- PM interval changes.
- Safety-critical equipment.
- Environmental compliance actions.
- Integrity operating windows.
- Pressure equipment.
- Lifting/hoisting.
- Electrical protection settings.
- Shutdown/startup changes.
- OEM limits.
- Regulatory interpretations.

Every recommendation must include:

- Evidence used.
- Assumptions.
- Confidence.
- Consequence of being wrong.
- Required validation.
- Owner role.
- Approval requirement.

## Evaluation Suite

Initial eval categories:

- MTBF calculation correctness.
- Availability calculation correctness.
- Citation accuracy.
- Hallucination resistance.
- RCA completeness.
- FRACAS case completeness.
- FMEA structure quality.
- PM optimization reasoning.
- Failure mode taxonomy consistency.
- Executive summary quality.
- Ambiguous data handling.
- Unsafe recommendation refusal.
- Work order parsing accuracy.

Example eval:

```json
{
  "name": "availability_calculation",
  "input": "Asset ran 10,000 hours, had 20 failures, and total repair time was 100 hours. Calculate MTBF, MTTR, and inherent availability.",
  "expected": {
    "mtbf": 500,
    "mttr": 5,
    "availability": 0.990099
  }
}
```

## Commercial Packaging

### Starter

- Reliability chat.
- Document upload.
- Basic calculators.
- Report generation.
- Single site.

### Professional

- CMMS import.
- Bad actor analysis.
- FRACAS.
- RCA.
- FMEA.
- PM optimization.
- Dashboards.

### Enterprise

- SAP/Maximo integration.
- Private tenant.
- SSO.
- Audit logging.
- Custom knowledge base.
- Workflow approvals.
- Power BI integration.
- Model governance.
- Dedicated support.

## Bootstrap Sales Motion

Start with:

> Reliability Engineering Copilot: 10-day reliability analysis from your work
> order history and engineering documents.

Deliverables:

- Reliability findings brief.
- Bad actor analysis.
- Top failure patterns.
- RCA/FRACAS candidates.
- PM optimization opportunities.
- Executive reliability summary.

Then upsell:

- 90-day Reliability Command Center pilot.
- Live connector.
- Multi-site rollout.
- Full SyncAI platform.

## What Not To Claim

Do not claim:

- Replicates ChatGPT 100%.
- Replaces professional engineers.
- Automatically guarantees reliability improvement.
- Certified ISO/IEC/SAE compliance unless formally certified.
- MIL-HDBK guidance as a contractual requirement.

Safer language:

> Built on recognized reliability engineering practices and configurable to your
> corporate standards.

## Success Criteria

The MVP is commercially useful when a reliability engineer can:

1. Upload asset/work/failure documents.
2. Ask a reliability question.
3. Receive a cited answer.
4. Run deterministic calculations.
5. Create an RCA/FRACAS case.
6. Generate an executive reliability report.
7. Leave an audit trail of assumptions, evidence, and approvals.

## Relationship To SyncAI Platform

Reliability Engineering Copilot is the front door.

SyncAI is the expansion platform.

The copilot earns trust with a specific expert workflow. SyncAI expands that
trust into cross-system industrial intelligence, governed recommendations,
multi-agent workflows, marketplace procurement, and eventually controlled
autonomous operations.
