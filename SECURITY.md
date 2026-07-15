# Security Policy

## Reporting a vulnerability

We take the security of SyncAI seriously. If you discover a vulnerability,
please report it responsibly:

- **Email:** security@syncai.ca
- Do **not** open a public issue for security matters.
- Please include steps to reproduce, affected component, and impact.

We aim to acknowledge reports within **3 business days** and to provide a
remediation timeline after triage. We support coordinated disclosure and will
credit reporters who wish to be acknowledged.

## Supported versions

The production deployment (app.syncai.ca, `main` branch) is the supported
version. Fixes are rolled forward through the standard change-management
process (branch protection + required CI checks + reviewed PR).

## Our security posture

See [`docs/compliance/`](docs/compliance/) for the SOC 2 / ISO 27001 control
matrices and readiness assessment. Key controls in place:

- Org-scoped row-level security on all data; role-based access enforced in the
  database.
- Enforced review + CI gating on every change; deploy only from `main`.
- Secret scanning, dependency vulnerability management, and SAST in CI.
- Audit trails for decisions, actions, and KPI computation.
- Leaked-password protection (HIBP) enabled.
