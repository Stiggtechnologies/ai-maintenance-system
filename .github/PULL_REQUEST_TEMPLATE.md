## Summary

Describe the bounded problem and the smallest coherent solution.

## Canonical architecture

- [ ] Existing canonical models and services reused are listed below.
- [ ] No parallel asset, failure, evidence, recommendation, approval, audit, queue, workflow, or twin model was introduced.
- [ ] Shared-contract changes were coordinated with the architecture steward.

**Canonical models reused:**

## Governance and safety

- [ ] Human approval boundaries remain explicit.
- [ ] No unsupported OEM values, engineering thresholds, intervals, or safety claims were invented.
- [ ] Draft engineering content remains marked `draft` until authorized review.
- [ ] Autonomous operational action is prohibited unless an approved policy explicitly permits it.

## Security and tenancy

- [ ] Authentication and authorization impacts were reviewed.
- [ ] Tenant isolation and RLS were preserved.
- [ ] Persistence changes are transactional and idempotent where required.
- [ ] Audit and evidence provenance remain complete.

## Validation

- [ ] Positive-path tests added or updated.
- [ ] Invalid, unauthorized, cross-tenant, and unsafe paths tested where applicable.
- [ ] Type checks and linting passed.
- [ ] Relevant unit/integration tests passed.
- [ ] Deployment checks passed.

**Checks run:**

## Assumptions and evidence gaps

List unsupported assumptions, evidence still required, and items awaiting engineering or field validation.

## Rollback

Describe how this change can be reverted or disabled safely.

## Scope control

- [ ] Changes are limited to the assigned issue/workstream.
- [ ] Unrelated cleanup and refactors were excluded.
- [ ] This PR was opened as a draft and will not be self-merged.