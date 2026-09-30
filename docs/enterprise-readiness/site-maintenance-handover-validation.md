# Site Maintenance Manager agent and shift-handover validation

This slice closes C1.02 and C5.09 with one governed product act. The existing
`maintenance_operations` identity now has a database-backed Site Maintenance
Manager charter. `run_site_maintenance_manager_agent` reads one same-tenant
site and freezes the canonical operating picture into
`shift_handover_packs`, with the exact adopted control profile, decision right,
tool, requester, site, input and result retained in `agent_runs`.

The pack contains exact source IDs and freshness/count evidence from open
high/critical work, recent high/critical process events, equipment custody,
material shortages, recovery blockers, in-progress operator rounds and the
latest site daily-coordination record. An empty section is explicitly not a
safe-state or readiness declaration.

The boundary is deliberate:

- the agent cannot assign or close work;
- it cannot release a schedule;
- it cannot change equipment custody or return equipment to service;
- it cannot accept risk or commit spend;
- direct client writes to the pack and retained run are closed;
- a different named incoming-shift human must acknowledge receipt;
- acknowledgement is immutable, changes no source state and is not action
  closeout.

The shipped `/briefing` screen owns the shift-handover ritual and now exposes
generation, the retained source summary, limitations, history and the separate
incoming-human acknowledgement. `/handover` remains the distinct equipment
release/return-to-service transaction.

Runtime proof is `scripts/ci-site-maintenance-handover-smoke.sh`. It runs in the
full clean migration-chain job and proves the role gate, tenant wall, exact
source retention, immutable pack, retained run, self-acknowledgement refusal,
different-human receipt and the complete no-execution-authority result.
