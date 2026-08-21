# RIA commercial activation — Feature contract

This slice closes the customer-reachable commercial bridge between a public Reliability Intelligence Assessment lead and an existing customer assessment workspace.

## Feature flow

`public RIA intake -> admin lead -> recorded commercial acceptance -> existing organization -> activate_ria_from_intake -> ria_assessment_id -> assessment workspace`

The Feature lane owns the browser surface and caller. It does **not** create or weaken cross-tenant permissions.

## What the browser may do

- Read admin-visible intake leads through the existing lead service.
- Record the operator's activation intent: target existing organization, bounded scope, optional target completion date, and a commercial-acceptance reference.
- Call the governed `activate_ria_from_intake` contract.
- Read the persisted conversion fields back and show the assessment identifier.
- Navigate to the assessment route; RLS continues to decide whether the current session can read it.

## What the browser may not do

- Auto-create an organization from a public lead.
- Query the ordinary `organizations` table cross-tenant.
- Write `pilot_intake_requests` conversion fields directly.
- Insert a target-tenant `ria_assessments` row directly.
- Treat a lead status as proof of payment.
- Grant itself sponsor, admin, or engineering authority.

## Invariant dependency

The Invariant lane owns the server implementation of:

```text
activate_ria_from_intake(
  p_lead_id uuid,
  p_organization_id uuid,
  p_scope_label text,
  p_target_end_on date,
  p_acceptance_reference text
) -> assessment uuid
```

and, if approved, a narrow admin organization directory:

```text
list_ria_activation_organizations() -> (id uuid, name text)
```

Until the directory exists, the UI accepts an explicit existing organization UUID and leaves validation to the activation contract. It does not relax `organizations_member_read`.

## Commercial language

The current standard RIA is described as **US$35,000 fixed fee, 6–8 weeks**. Activation requires a reference such as a signed SOW, PO, invoice, or payment reference. The feature deliberately says that this records commercial acceptance; it does not claim that SyncAI itself processed payment unless a real payment rail is later integrated.

## Definition of done

The slice is complete only when the invariant RPC is deployed and the path is proven end-to-end:

`lead surface -> activation form -> governed RPC -> persisted conversion -> customer RIA workspace`
