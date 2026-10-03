# Safety-critical regulatory obligation register

## Purpose

The Process Safety workspace connects each canonical
`safety_critical_elements` record to the canonical
`regulatory_requirements` that a named human has determined may apply. The
relationship is recorded in `safety_critical_element_obligations`; the source
equipment and requirement records remain in their existing authoritative
homes.

An empty register is an evidence gap. It is not proof that no regulatory
obligation applies.

## Governance boundary

- Only named reliability, maintenance-management, executive or administrator
  roles can record applicability.
- `applicable`, `conditional` and `superseded` determinations require
  independently verified, same-tenant canonical evidence.
- `undetermined` requires a substantive basis and at least one explicit item of
  missing evidence.
- A closed regulatory requirement cannot be represented as currently
  applicable.
- The database trigger independently enforces that the element, requirement
  and applicability edge belong to one organization.
- Direct table writes are closed; the governed RPC emits the canonical audit
  event with before and after state.

Recording applicability does not issue a permit, approve a regulatory
position, test a barrier, release work, change isolation, change a protective
setting or return equipment to service. Those authorities remain in their
existing governed workflows.

## Customer path

1. Author and govern the regulatory requirement through Sync Develop.
2. Author the safety-critical element and its performance standard in Process
   Safety.
3. Open the safety-critical regulatory obligations panel in Process Safety.
4. Select the element and requirement, record the applicability basis, and
   either cite verified evidence or name the missing evidence.
5. Review the retained applicability edge and audit history.

## Verification

`scripts/ci-safety-obligation-register-smoke.sh` proves authenticated role
gating, verified-evidence requirements, explicit unknowns, cross-tenant
refusal, direct-write refusal, canonical audit output and the unchanged
operational-authority boundary. The full migration chain must compile from a
clean database before the capability can ship.
