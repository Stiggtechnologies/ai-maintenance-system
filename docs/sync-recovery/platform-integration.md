# Sync Recovery — platform integration contract

Sync Recovery is not a replacement maintenance module. It is the governed restoration-event coordination layer that connects existing canonical modules around the fastest safe return to service.

## Canonical ownership

| Domain | Canonical owner | Recovery relationship |
| --- | --- | --- |
| Work | `work_orders`, job plans and work execution | Recovery references work into an event scope and coordinates sequence/concurrency; it does not create another work-order store. |
| Materials | MRO catalogue, `work_order_materials`, reservation/kitting/issue | Recovery consumes readiness and exposes consequence; Materials remains the source of truth. |
| Weekly scheduling | `schedule_options`, craft capacity and the existing feasibility/release RPCs | Recovery is a soft feasibility signal. The weekly schedule owns capacity commitments; the released Recovery event plan owns restoration sequence/concurrency. |
| Equipment custody | `equipment_releases` and release/return/accept RPCs | Recovery reads and gates against the same custody state; it cannot self-release, self-return or self-accept equipment. |
| Approval | `autonomous_decisions`, `approval_workflows`, Approval Queue | Recovery plan release continues through the canonical independent approval path. |
| Value | `value_metrics` plus Value Verification | Recovery can create a projected counterfactual; only the existing verification process can promote benefit to verified. |
| Reliability and learning | `learning_events` and Reliability/Learning surfaces | Recovery records event evidence that can support recurrence/delay learning; the context layer does not infer causality from a counterfactual. |
| Conversational intelligence | **Sync** | Sync may retrieve/explain Recovery context and propose governed actions. It does not own a separate Recovery state or bypass Recovery, approval, isolation, material or quality gates. |

## Shared read contract

`get_recovery_platform_context(surface, work_order_id, asset_id)` is the tenant-scoped read model used by adjacent product surfaces. It contains only derived/referenced facts from canonical stores:

- active Recovery events, current RTS/P80 and blocker counts;
- a work order's current Recovery event/sequence/concurrency state;
- canonical material shortages/unassessed demand affecting active event scope;
- canonical equipment release/return/Operations-acceptance state;
- active Recovery work commitments for weekly scheduling;
- recently closed events for reliability, learning and value review.

RTS impact is shown only when a Recovery blocker has an explicit `forecast_rts_impact_hours` with its existing basis. Missing impact remains **not quantified**.

`get_sync_recovery_context(asset_id, work_order_id)` is the stable read seam for the platform-wide **Sync** interaction layer. It delegates to the same platform context. Operational actions remain on the existing governed Recovery RPCs.

## Weekly scheduling boundary

The existing `evaluate_schedule_feasibility` function now includes an **Active Recovery commitments** soft check. If a weekly option omits active, included, incomplete Recovery work, the option carries a warning and requires the planner's existing explicit warning acknowledgement before the week can be frozen.

This is deliberately not a hard block: overtime, contractors and event/week boundary decisions are legitimate planning judgments. It is also deliberately not a second scheduler: the weekly option cannot change Recovery sequence or human-verified concurrency.

## Product surfaces

The shared Recovery context panel is intended for:

- Mission Control — active event RTS/P80, blocker exposure and projected recovery;
- Work Order Detail — event membership, event sequence, concurrency and execution context;
- Materials & Spares — shortages/unassessed demand tied to active Recovery scope, with consequence only when recorded;
- Weekly Schedule & Crew — active Recovery commitments plus the server-side feasibility warning;
- Release & Return to Service — active event custody/isolation/acceptance context around the canonical handover actions;
- Reliability / Learning — recently closed Recovery evidence for recurrence, delay and first-time-right analysis;
- Value Realization — projected Recovery counterfactuals awaiting canonical verification.

## Safety and governance invariants

1. No duplicate work-order, material, scheduling, approval, handover, value or learning store.
2. No browser-side scheduling authority.
3. No invented duration, RTS impact, production loss or value.
4. No Sync-only execution shortcut. Sync uses the same governed Recovery actions as any other product surface.
5. No automatic clearance of permit, isolation, material, quality or Operations-acceptance gates.
6. Read contracts are tenant-scoped SECURITY DEFINER functions with PUBLIC/anon execute revoked.
7. Failure to load Recovery context never creates a fallback write path; the underlying canonical module remains authoritative.

## Parallel Sync runtime work

PR #248 owns the active Sync Investigation Runtime v2 files. This integration deliberately avoids those files. After both branches are reconciled, the runtime should call `get_sync_recovery_context` whenever an asset/work-order investigation or Recovery/RTS/blocker question needs restoration context. That is a read integration, not a new action authority.
