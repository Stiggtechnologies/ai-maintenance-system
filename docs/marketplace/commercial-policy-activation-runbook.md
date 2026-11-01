# Microsoft Marketplace commercial-policy activation

**Controlled production runbook — 2026-11-01. This document is not authority
to activate a subscription, publish an offer, or approve a commercial policy.**

This runbook closes the production gap between the buyer-visible Microsoft
plans and SyncAI's database-enforced AI, site and named-user boundaries. It uses
the canonical policy and approval functions already deployed to the buyer-facing
`SyncAI` Supabase project (`pjvoswbwomesuwhygpby`); it does not create a second
entitlement registry or seed an approval.

## Canonical production target

`app.syncai.ca`, the `syncai-github` Vercel production project, the browser
fulfillment client, the same-origin Marketplace webhook proxy, and the protected
deployment workflow all converge on Supabase project
`pjvoswbwomesuwhygpby`. The observed `stigg-os-prod` project
(`snlevbkyjipucmkpkqka`) is not the buyer-facing Marketplace target. Never
configure Marketplace secrets, policies, capacities, subscriptions or release
witnesses there. The evidence and retirement boundary are recorded in
`marketplace/production-data-plane-boundary.json`.

## Authoritative identities

| Boundary               | Microsoft technical ID          | Partner Center resource ID             |
| ---------------------- | ------------------------------- | -------------------------------------- |
| SaaS offer             | `syncai-predictive-maintenance` | `771d0f8e-11f8-4ac3-9325-7ee01ce6fe6b` |
| Site Reliability       | `starter`                       | `792e22d3-8169-4cc5-a422-575799ff78ec` |
| Reliability Network    | `professional`                  | `c5fd0cf9-b83b-4203-9b21-df1970a17c10` |
| Enterprise Reliability | `enterprise`                    | `7a494a0b-e89f-4211-8cf6-46c6d187b1ab` |

The technical IDs are the values returned by Microsoft fulfillment and are the
only values valid in `private.ai_commercial_plan_policies`. The GUIDs identify
Partner Center resources and must never be substituted into fulfillment policy.

## Do not begin until

1. All three Partner Center drafts show the controlled flat-rate prices, names,
   limits, visibility and one-year monthly-payment terms in
   `marketplace/commercial-offer-decision.json`.
2. Preserve the successful protected deployment evidence from workflow run
   `41283398055` at main commit
   `4afc6fd6bd067e462677a02ddae3a08f4bdba4b5`. That run linked the canonical
   project and deployed every function importing
   `supabase/functions/_shared/llm-commercial-usage.ts`.
3. Every proposed allowed model has a current CAD price in
   `private.llm_prices`, is available on the direct production route, and stays
   inside the standard-rate request envelope.
4. Preserve the post-merge production witness for commit
   `f709231aaa5f1a5d3f1f6c373d6269cf70feb90d`: all nine commercial-boundary
   consumers were active on the canonical project with update timestamps from
   `2026-11-01T07:47:51Z` through `2026-11-01T07:48:13Z`. The paid default is
   now `gpt-5.6-terra`; do not reintroduce deprecated `gpt-4o-mini` into the
   allowlist.
5. The operator has the immutable UUID of an existing `admin` or `ai_admin`
   user who accepts named commercial approval. A display name or email is not
   a substitute, and a synthetic identity is prohibited.
6. `AZURE_MARKETPLACE_CLIENT_SECRET` is configured in production and the payout,
   preview, cost-to-serve, legal and certification gates remain tracked even
   though they do not change policy arithmetic.

## Controlled plan inputs

| Plan           | Revenue reserve (CAD/month) | Other variable-cost reserve (CAD/month) | Decisions | Calls |     Tokens | Sites | Named users |
| -------------- | --------------------------: | --------------------------------------: | --------: | ----: | ---------: | ----: | ----------: |
| `starter`      |                       6,980 |                                   1,100 |        20 |   100 | 10,000,000 |     1 |          25 |
| `professional` |                      20,940 |                                   3,700 |        60 |   300 | 30,000,000 |     5 |         100 |
| `enterprise`   |                      41,880 |                                   7,400 |       120 |   600 | 60,000,000 |    15 |         250 |

All plans use `flat_rate`, `hard_stop`, provider cost multiplier `1.1`, and
minimum modeled gross margin `0.75`. Maximum calls and tokens equal the included
amounts, so no unpriced automatic overage exists. The candidate model set is
`gpt-5.6-terra` and `gpt-5.6-luna`; it becomes executable only after the
direct-route, nondeprecated-default and current-price preconditions above pass.

## Production sequence

Run against project `pjvoswbwomesuwhygpby` through a protected service-role or
database-operator session. Refuse to continue if the resolved target differs.
Never paste credentials into this repository or a chat. Because the remote
migration ledger is historically divergent, do not treat `supabase db push` or
the ledger alone as proof.

For each plan, call `public.configure_ai_commercial_plan_policy` with the exact
offer ID, plan inputs above, the two-model candidate set, null meter fields,
and a note identifying this controlled decision record. Immediately call
`public.configure_commercial_plan_capacity` with the matching site and named-user
limits. Both calls must return `status = draft`.

The fail-closed transaction in
`scripts/stage-marketplace-commercial-policy-drafts.sql` performs these calls,
capacity updates and evaluations. It defaults to rollback, pins the canonical
project reference, verifies that the actual `psql` host or pooler user resolves
to that project, requires explicit confirmation of the Partner Center drafts
and production client secret, and refuses to overwrite an approved/retired
policy or run while a matching Marketplace subscription is active. An
operator-supplied project label is not connection proof: the script must reject
the currently linked `stigg-os-prod` database even if the canonical project ref
is supplied as a variable.

Then call `public.evaluate_ai_commercial_plan_policy` for every exact
offer/plan pair. Stop and roll back the transaction unless every result returns
`allowed = true`, the modeled gross margin is at least `0.75`, and the allowed
model set and cost inputs match this record.

Only after those checks may the named administrative owner call:

```sql
select public.approve_ai_commercial_plan_policy(
  'azure_marketplace',
  'syncai-predictive-maintenance',
  '<starter|professional|enterprise>',
  '<existing-admin-or-ai-admin-uuid>'::uuid
);
```

Approval is a human authority act and authorizes only a controlled preview. The
function must return `approved = true`; the approval UUID and time must be
preserved in the private policy record. Do not activate any Marketplace
subscription in this transaction and do not publish the offer.

An actual bound paid runtime witness is necessarily post-approval: the shared
runtime selects its paid direct-provider path only after an approved policy is
bound to an active preview subscription and the quota reservation returns a
nonempty `commercialPlanId`. After named approval, complete a real Microsoft
preview purchase and manual tenant binding, then make one bounded paid call.
Prove that it used only `openai-direct`, `https://api.openai.com`, the exact
approved model and `default` service tier, settled terminal model and token
usage, and refused gateway and cross-model fallback. A failed witness blocks
public activation and requires policy/runtime reconciliation; it does not make
the preview approval retroactively valid for publication.

## Verification and refusal witnesses

Capture redacted evidence that proves:

1. the three approved policies match the exact technical IDs and commercial
   inputs above;
2. the site and named-user capacities are present on the same approved rows;
3. a missing, ambiguous, unapproved or mismatched policy refuses activation;
4. site 2/6/16 and named user 26/101/251 are refused for their respective plans;
5. a paid request refuses gateway, cross-model and premium-tier fallback;
6. tenant-scoped readback reports the correct plan limits without exposing the
   private policy table;
7. two real Microsoft preview purchases complete resolve, activation,
   lifecycle, entitlement and refusal checks before certification.

If any witness fails, leave the offer unpublished and the subscription
inactive. There is no public policy-retirement RPC in this release; post-approval
reversal therefore requires a separate named database change with existing
subscription impact assessed explicitly.
