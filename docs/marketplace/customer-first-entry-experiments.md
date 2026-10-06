# Customer-first entry experiments

**Controlled product and marketplace source — 2026-10-05.** This document
records research hypotheses and supported product paths. It does not claim
validated demand, conversion, customer outcomes, Marketplace publication, or
commercial success.

## Decision

SyncAI will test multiple pain-led entrances into one platform. It will not
market each entrance as a separate product or build a separate workflow,
authority model, data store, or proof standard for each message.

The initial comparison is:

1. unplanned downtime reduction;
2. downtime recovery coordination;
3. maintenance cost reduction; and
4. the remaining supported portfolio paths at lower traffic until evidence
   justifies promotion or retirement.

The complete route registry and its claims boundaries live in
`src/lib/product-entry-paths.ts`.

## Natural product integration

Each entrance supplies a different customer question and initial evidence, then
enters the same canonical Decision Case:

```text
Pain-led message
  → real customer question
  → evidence type and intake method
  → evidence-bounded recommendation
  → human disposition
  → controlled action boundary
  → named verification plan and result
  → learning candidate
```

The research-derived first-customer walkthrough is the interaction hypothesis
behind this sequence. It contributes the following product rules:

- start with the customer's real question rather than a seeded demonstration;
- ask for evidence type before intake method;
- keep missing and conflicting evidence explicit;
- cite only evidence actually attached to the case;
- offer Accept, Reject, Need more evidence, Park, and Escalate as human
  dispositions;
- require rationale, named ownership, and the condition that would change an
  accepted recommendation;
- keep workspace access separate from decision authority;
- never let the AI release work or assume plant, engineering, or risk authority;
- name the verification owner, expected result, date, actual result, and
  supporting evidence; and
- retain a learning candidate without automatically treating it as verified
  knowledge.

These rules make the entries comparable without assuming that the research or
messages work. Product capability is only the eligibility test for an
experiment; observed buyer and outcome evidence is the validation test.

## Measurement contract

Every public entrance carries `entry`, `source`, `campaign`, and `variant`
attribution into the existing public capability workspace. The implementation
records the following milestones without creating another commercial evidence
store:

1. entry viewed;
2. canonical capability opened;
3. customer question submitted; and
4. value-proof step completed.

Acquisition metrics such as click-through and question starts may select which
message receives more traffic. They do not prove operational value. Promotion
to a commercial proof requires downstream evidence: a real decision, a named
authority, an agreed baseline and counterfactual, a verification obligation,
and an observed result. Projected value remains separate from observed and
independently verified value.

## Experiment rules

- Change one major variable per comparison: pain, promise, proof, or call to
  action.
- Route variants into the same Decision Case experience wherever possible.
- State the supported product surface and claims boundary on every entrance.
- Do not promise downtime elimination, root cause, return to service, cost
  savings, or risk reduction before evidence supports the claim.
- Do not use traffic, enthusiasm, account activity, or AI output as evidence
  that a customer is ready to expand.
- Retire or revise an entrance when it attracts the wrong buyer, cannot reach a
  governed decision, or lacks a credible verification path.

## Marketplace and channel adoption

Apply the same architecture to every marketplace, directory, partner channel,
campaign, and referral surface:

```text
Canonical SyncAI SaaS offer and entitlement model
  → channel-native listing, category, campaign, content, or service package
  → one pain-led message and honest claims boundary
  → attributed SyncAI entry route
  → canonical Decision Case
  → governed commercial progression
```

The marketplace is a distribution and procurement adapter, not a fork of the
product. Marketplace plans should represent genuine entitlement, term, support,
or commercial differences—not merely different pain-point copy. Where a
channel permits multiple listing surfaces, content assets, campaigns, solution
categories, professional services, referrals, or private offers, use those
surfaces to test discovery and buying paths while keeping one platform identity
underneath.

For every channel, record:

- `source`: the marketplace, directory, partner, or owned channel;
- `campaign`: the bounded commercial or content test;
- `variant`: the pain, promise, proof, or call-to-action variant;
- `entry`: the registered SyncAI pain-led route; and
- the downstream Decision Case and value-proof milestones.

Evaluate the channel in stages:

1. **Discovery:** qualified listing views, search/category reach, and referrals.
2. **Engagement:** entry click and real customer question started.
3. **Activation:** evidence supplied and a bounded recommendation reviewed.
4. **Qualification:** named owner and human disposition recorded.
5. **Proof:** agreed baseline, counterfactual, verification obligation, and
   observed result.
6. **Commercial progression:** a named customer authority records go, change,
   hold, or stop for the next scope.

A marketplace impression, click, lead, trial, subscription, or purchase is
valuable channel evidence, but none alone proves operational value. Conversely,
a product-capability demonstration does not prove that a marketplace or message
can acquire the right customer economically.

## Commercial progression

Winning entrances do not create new subscription tiers. They use the existing
commercial progression:

```text
First Decision
  → Reliability Intelligence Assessment when the baseline is not proven
  → bounded proof
  → production fleet or site
  → multi-site or network
  → enterprise standard
```

Every scope expansion remains a named customer decision of go, change, hold, or
stop with unresolved risks and verification obligations recorded.
