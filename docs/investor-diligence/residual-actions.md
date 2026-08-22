# Residual owner and counsel actions

Engineering controls can close the repository-side loop, but the following
items need authority or evidence outside the codebase.

## Before representing a clean IP position to investors

- Have qualified counsel review the proprietary notice, the prior MIT grant,
  fundraising representations, and any response to suspected copying.
- Identify the fundraising entity and execute/collect founder, employee, and
  contractor invention assignments covering the actual contribution dates.
- Reconcile every material Git identity and external design/data/vendor source
  to those agreements; document exceptions.
- Complete trademark clearance and confirm entity ownership of SyncAI names,
  logos, domains, app-store/vendor accounts, and social handles.
- Confirm privacy, customer-data, model-provider, dataset, and vendor contract
  rights in the diligence data room.

## Repository and production decisions

- Keep the repository private. Do not make it public merely to obtain free
  security controls.
- Upgrade/move the repository to an eligible GitHub organization plan, then
  enable branch protection or rulesets, required status checks, one trusted
  non-author approval, code-owner review, CodeQL/code scanning, and GitHub
  secret scanning.
- Designate at least one known, verified reviewer. Until then, do not invite an
  unknown account to satisfy a merge gate.
- Confirm `syncai-github` is the canonical Vercel project and decide whether
  `repo` and `ai-maintenance-system` are intentional. Archive redundant
  projects only after DNS, environment variables, domains, and rollback needs
  are verified.
- Review installed GitHub apps and Vercel team access. Retain only the scopes
  required by Claude/Codex/Copilot/Vercel and remove stale installations.
- Decide whether to archive or delete stale remote branches after preserving
  provenance and confirming no release, deployment, or open pull request
  depends on them.

## Recurring evidence

- Quarterly: access/integration review, dependency inventory, SBOM, secret
  rotation posture, backup/restore test, and IP register review.
- At each financing: refresh the capitalization/entity chain, invention
  assignments, material contracts, security exceptions, litigation/threat
  disclosures, and the prior-MIT incident record.
- At each material release: retain the commit, build provenance, dependency
  inventory/SBOM, deployment approval, and customer-facing notices.
