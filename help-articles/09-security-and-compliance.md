# Security & Assurance

**Last updated:** August 19, 2026

SyncAI describes security controls according to the evidence available for the current product and deployment. Historical roadmap language must not be treated as a certification or customer commitment.

## Current control principles

- Organization-scoped database access is enforced through Row Level Security and guarded server functions on tenant data surfaces.
- Consequential engineering and operating decisions remain subject to human authority and approval boundaries.
- Governed workflows retain evidence references, decision state, and approval/audit context where implemented.
- Authentication is provided through the configured identity layer. Enterprise SSO or additional identity controls are only represented as available when enabled and validated for the specific deployment.

## Certification status

Do **not** state that SyncAI is SOC 2 Type II certified, ISO 27001 certified, HIPAA compliant/ready, or otherwise certified unless a current scoped certificate/report and authorized public representation exist. Infrastructure-provider certifications are not the same thing as SyncAI certification.

## Data handling

The public Reliability Engineer is an evaluation surface. Browser-side file profiling does not mean that all AI context remains local: prompts, text and extracted/sample context used for analysis may be sent to SyncAI's configured processing services. Do not submit production credentials, controlled information or confidential maintenance records through the public experience.

Paid assessments and production workspaces use the customer-agreed data-transfer method, access model, retention terms and deployment controls.

## Responsible reporting

Security questions or suspected vulnerabilities: **security@syncai.ca**.

Customer security questionnaires and evidence requests are handled during enterprise diligence based on the current environment and available evidence.
