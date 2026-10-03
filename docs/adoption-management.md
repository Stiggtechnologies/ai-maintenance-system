# Governed adoption management

SyncAI's adoption workspace turns an approved organizational baseline into a controlled implementation program. It is available beside **Maturity assessment** at `/organizational-maturity`.

## Complete operating loop

1. Create a draft with a named sponsor, process owner, objective, scope and dates.
2. Plan all thirteen disciplines: stakeholder mapping, role design, process ownership, training, field trials, change impact, feedback, adoption metrics, procedure updates, incentives, communications, champions and benefits tracking.
3. Name a same-tenant accountable owner, due date, execution plan and success measure for every item. Category-specific controls require audiences, controlled procedure references, impact levels and anti-gaming guardrails where relevant.
4. Activate only when every discipline has an owned plan. Activation is recorded in the canonical approval and audit trails.
5. Work each item through planned, in-progress, blocked, complete or cancelled states. Completion requires same-tenant, independently verified canonical evidence.
6. Record baseline, target and actual observations for adoption and benefit measures in the canonical `value_metrics` store. Each point keeps its owner, unit, method/basis and verified evidence.
7. Submit only when every discipline is evidenced, every non-cancelled item is complete and measurement units are comparable.
8. Close independently. An administrator or executive other than the author and submitter approves or returns the program. Approval verifies observed value points and writes a canonical approval.

## Authority boundary

This workflow governs implementation evidence; it does not execute operational changes. It cannot operate plant controls, release work, revise a controlled procedure, accept safety risk, spend money or claim realized benefits without the recorded human review. Direct table mutation is denied even to ordinary authenticated roles; changes move through tenant-scoped functions with audit events.

## Acceptance evidence

- Migration: `20270101670000_adoption_management.sql`
- Runtime acceptance: `scripts/ci-adoption-management-smoke.sh`
- Contract tests: `src/test/adoptionManagementContract.test.ts`
- UI: `src/components/AdoptionManagementPanel.tsx`

The smoke proves the 13-discipline activation gate, verified-evidence completion gate, baseline/target/actual measurement gate, author-review separation, canonical approvals and audit trail, direct-write denial and the explicit no-operational-authority boundary.
