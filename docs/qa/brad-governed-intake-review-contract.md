# Brad governed intake: review and live acceptance prerequisites

Status: **HOLD** for issue #575 customer acceptance. This packet does not grant review, migration, release, email, or customer-data authorization. The proposed comparison contract is deliberately unconnected to production intake; its tests cannot prove server authority or live acceptance.

## Who can review and how approval is recorded

The repository calls for a named human SME, with `P.Eng. / reliability SME` as an example role in [the baseline policy](../reliability-engineer-baseline.md). Existing governed-SQL approvals name **Orville Davis**, role **Founder / reliability engineering SME**:

- `benchmarks/reliability-engineer/approvals/governed-engineering-knowledge-2026-09-06.json`
- `benchmarks/reliability-engineer/approvals/kb-document-classes-intake-reference-2026-08-27.json`

This is precedent, not an exclusive identity allowlist. `.github/CODEOWNERS` names `@Stiggtechnologies` repository-wide and explicitly calls for an independently trusted reviewer before mandatory ownership approval. The scripts validate record structure and digests, not a person's credentials or authority. The parent/repository owner must establish the actual authorized human and obtain their review; an independent technical review alone is not a substitute for their SME approval.

The mechanism is a new or updated JSON sidecar under `benchmarks/reliability-engineer/approvals/` in the **same PR diff** as the protected change. Required common fields are `baselineId: "RE-2026.08"`, `kind: "governed-sql"`, `reviewer`, `reviewerRole`, ISO `reviewedAt`, and a substantive `rationale`; `databaseObjects` must match all computed protected-object digests. See `scripts/reliability-baseline-floor.mjs` (`collectApprovalShapeFailures`) and `scripts/check-reliability-baseline.mjs` (approval loading and governed SQL checks). The `decision: "qualified"` check applies to core qualification records, not this governed-SQL record type. Do not fabricate a signer/date/rationale, reuse an old digest, or treat these instructions as an approval record. No approval sidecar or protected manifest change is included here.

## Exact unapplied artifact

Review [kb-security-integration-proposal.patch](kb-security-integration-proposal.patch), committed at `0926d972487eaa8bd6a041cd8eca1acd569f9fc8`. SHA-256:

`4c9c3283d5603bfea706ffb4ed79921ed572fcfb13bc048e6249fa2c61745fa3`

It proposes narrow assurance helpers at `20270103200000` and the legitimately accessible PR #569 security SQL body at `20270103210000`. It has **not** been applied. Source PR #569 head is `e8f22ab7f543db55a47aff2185611ae9432d0934`; no denied private handoff or offline checkpoint was consulted. Candidate protected-object digests for these exact filenames/content and this main lineage are:

| Object              | Candidate SHA-256                                                |
| ------------------- | ---------------------------------------------------------------- |
| retrieve_kb_context | ba5ed0e7afb0ab72a21f6c14a28c0c822fefdd49b6c08fe41347a773c02e4578 |
| kb_document_classes | 6f7409b3e991487de4086321c1793feccd5df6414af04a01e50a933c82695816 |
| kb_claim_types      | 381db6e3bc1a58a0989882de17a1d6892523787a51062e7138961d5df19d1d5f |

Recompute after any migration, filename, or main-line change. Review must cover existing claim-type filters, tenant/session gates, quarantine visibility across all retrievers, assurance helper access, and distinct-uploader reviewer enforcement. Approval of this patch alone does not implement canonical evidence mapping or enable deployment.

## Receipt and changed-source contract

`src/lib/decision-case-intake-contract.ts` is an executable proposed boundary with synthetic unit tests. It requires a tenant/case/version match, canonical evidence UUID, document/source identity, content digest, source revision and security revision, indexed chunks, and cleared/released standing. Legacy ingest `source_id` and a self-claimed cleared response are insufficient. Canonical state must be independently resolved by an authorized server transaction over existing KB/evidence/case records, never copied from the upload response. Revision fields are proposed contract requirements, not claims that these columns already exist.

Any source/content/security revision or evidence-mapping change, deletion, quarantine, rejection, or loss of indexed chunks invalidates the current binding. Historical evidence and disposition remain available for audit. Releasing identical bytes after quarantine must advance the security revision and require fresh human review; it cannot resurrect an old disposition. A current mapping grants no engineering approval or permission to act.

Remaining implementation: authoritative server receipt, durable mapping into canonical evidence, atomic version/audit handling, and source-change invalidation in server decision commands and customer surfaces. Do not enable intake until these have native SQL, RLS, concurrency and browser acceptance coverage. In particular, remove PR #569's inferred-cleared fallback before reusing its Edge handler.

## Exact prerequisites for live customer acceptance

1. **Release authorization:** the parent obtains approval for the exact reviewed head, isolated staging migrations/Auth/Edge deployment, rollback procedure and restore owner. No merge, production migration or deploy is authorized by this packet. Coordinate shared CI/Edge files and migration reservations with the adapter owner; their proposed timestamps start after `20270103210000`.
2. **Identity and allowed data:** an owner supplies the approved test tenant, canonical sites/assets, approved synthetic or explicitly permitted customer evidence, and designated actors/recipient. Include a foreign-tenant actor for isolation checks. Do not use live resident/customer data or send email without separate authorization.
3. **Assurance and real invitations:** an authorized inviter with required MFA/AAL2, a new viewer recipient, the bound disposition approver, verification owner and independent rollout acceptor are available. A KB reviewer is same-organization admin/reliability engineer, distinct from uploader, with verified MFA and AAL2. Configured Auth redirect/provider/sender must deliver a genuine invitation whose acceptance creates the correct membership. Prove expired/reused link, wrong account, sign-in/back/cancel/retry and repeated acceptance; viewer acceptance must not grant approval authority.
4. **Governed ingest:** deploy the reviewed security contract plus completed authoritative mapping/invalidation implementation. Prove missing receipt, forged identity, stale/concurrent case version, quarantine/rejection, deleted/reuploaded source, same-byte re-release, and cross-tenant retrieval fail closed. Record sanitized canonical IDs, versions, source hashes and audit outcomes. No fixture receipt may stand in for a production dependency.
5. **Both customer paths:** separately observe presenter-led and independent first-time users defining their outcome, gathering evidence progressively, seeing a grounded recommendation with uncertainty, and recording an authorized disposition against unchanged evidence. Exercise saved-work recovery/reconciliation, account/tenant switching, back/cancel/repeated flows, verification return and reminder acknowledgement, restricted share expiry/revocation and replay. Confirm changed evidence requires new disposition. Internal reminders are not proof of external delivery.
6. **Measured rollout:** agree on actual pilot scope, baseline, target/unit, measurement window, evidence source, rollback criteria, receiving authority and independent acceptance before starting. Capture measured results, then obtain explicit site, fleet, multi-site/enterprise and handover approvals against canonical scopes. Successful demo navigation or seeded measurements do not satisfy this gate. Operational dispatch remains unavailable without its separately authorized dependency.
7. **Evidence and sign-off:** retain sanitized run evidence tied to exact app/backend heads and case versions, record customer outcomes and unresolved dependencies, and obtain architecture, security/tenancy, domain and release reviews. Actual provider/model availability and grounded source provenance must be verified under the approved environment. Keep unsupported capabilities disabled and issue #575 open until these observations pass.
