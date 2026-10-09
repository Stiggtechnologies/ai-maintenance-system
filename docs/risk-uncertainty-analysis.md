# Governed uncertainty-aware risk analysis

**2026-10-06 — PARTIAL, CURRENT-MAIN DRAFT COMPOSITION; NOT RELEASE QUALIFICATION.**

**2026-10-09 — published baseline qualified in disposable CI; local policy-availability extension pending native qualification.**
Published `dcf6b1d289685c8a6c92e83255e0705683c1ec08`, core run
`37691244193`, completed successfully on October 7. The database job
`113031674461` executed the full migration chain, rollback-only native SQL,
real GoTrue/PostgREST acceptance and multi-session concurrency qualification.
Its native baseline receipt was recorded at `21:58:41Z`, HTTP receipt at
`21:58:53Z` and concurrency receipt at `21:59:01Z`. Unit qualification passed
**8,878 tests in 549 files**; lint/typecheck/build, migration order and
golden-path browser jobs passed. These receipts supersede the older pending
and failed-run notes below **only for that exact published commit**. They do
not prove production deployment or complete U18 source-standing qualification.

The next bounded change uses the same private submission/replacement writer
and public independent-review function. Current criteria acquisition now uses
`FOR SHARE NOWAIT`: a concurrent policy writer causes a structured busy refusal
instead of allowing a policy-first/risk-first lock cycle. Only that acquisition's
`55P03` is mapped to private `U1801`; the encompassing exception block rolls
back the call's new locks and changes before returning the refusal. Prior caller
locks and context remain intact. `NOWAIT` bounds tuple contention, not conflicting
table-level locks; this is not a universal prompt-availability guarantee.
Server deadlocks, statement timeouts and other
errors remain failures, not successful acknowledgements. A caller must reload
and explicitly retry; there is no automatic write retry. Historical committed
replacement receipts are still recognized before mutable current-policy gates.
Final human membership, tenant visibility, evidence, policy snapshot, digest,
CAS and operational-authority boundaries are unchanged.

The native harness specifies busy-policy and post-commit stale refusals as
separate actual calls. A third session must prove release of the call's new
risk/packet, inverse-view and origin-scenario fences while its caller transaction
remains open, and must prove
that the caller's prior lock and context survive. The opposite-order service
writer must then commit its risk update before that caller transaction ends;
all thirteen state collections remain checked with only its named field delta.
Competition and membership-drift schedules use packet/profile barriers instead
of the removed policy wait. Ordinary submit is explicitly observed refusing
before its caller's instrumented audit-table lock, not claimed to wait inside
an audit insert. Existing policy-after and criteria-pointer schedules remain.

The source guard formerly forbidding every error return after replacement DML
now exempts **only the exact encompassing `U1801` rollback handler at the end
of the function**; all normal after-DML error returns remain prohibited.
New compensating source tests require the exact acquisition, private signal,
handler boundary, historical receipt order and unchanged final authority gates.
These are source specifications, not proof of actual RPC lock release. The
edited migration is reserved and unapplied; deployed history and shared writers
are not changed. Local uncertainty/decision-preview/client/panel and shared
tenancy/definer qualification passed **2,198 tests in 28 files**, application
TypeScript, owned zero-warning ESLint, formatting, Node syntax, diff checks and
both unchanged register ratchets. Independent migration/security review passed
**1,286 tests in six files**; independent harness/domain review and additive
inverse-view/scenario probe re-review passed **40 tests in two files**. Neither
agent review is external GitHub account approval or actual native qualification.
Fresh exact-candidate full-chain/native/HTTP qualification,
independent review, protected merge and production verification are required.
No register status is promoted. Earlier dated entries below are historical.

**2026-10-07 — actual role-fixture repair and bounded session diagnostics; new native qualification required.**
Published `4713c5b0`, core run `37688784757`, is terminal failure. Unit,
lint/typecheck/build, migration order and golden-path browser jobs passed.
The uncertainty preflight failed at `21:33:39Z` in the `ai_admin` control,
with both refusal-match and state-preservation false. Later uncertainty SQL,
HTTP and concurrency qualifications were skipped, not passed.

Independent diagnosis traced the fixture failure to the unchanged canonical
`pin_user_profile_privileges` trigger: the inherited author JWT makes even an
owner-session role UPDATE an end-user attempt. Row count is still one, but the
author remains the seeded human admin. The other-admin case also failed to
provision an actual admin and could misleadingly pass its author-only refusal.
Only disposable fixture profile provisioning now clears both JWT claim
representations and requires the original owner with NULL `auth.uid()`. Both
persisted roles and organizations are explicitly checked before the intended
authenticated actor calls the real public RPC. All thirteen exact refusals,
full two-tenant state witnesses and narrow `ZX019` rollback remain.

Both custom claim settings have defined initial baselines. An isolated
PostgreSQL 16.13 mechanism proof reproduced the previously unset setting's
NULL-to-empty rollback edge and verified exact initialized two-channel rollback.
The private server was stopped. This is not application migration-chain,
replacement-RPC or native authorization qualification. Independent bounded
fixture review passed **31 tests in three files**, with no remaining finding.

The subprocess adapter retains only a bounded, strictly framed first SQLSTATE
from controlled stdin diagnostics. It waits for stderr drain at process close,
including late stderr after stdin failure, and distinguishes server, process,
watchdog and qualification failures without emitting arbitrary error content.
No deadlock is caught as a successful refusal, retried or converted to PASS.
The original 20-second server timeout, 25-second watchdog and bounded cleanup
are unchanged. Independent adapter review passed **61 tests in four files**,
including **21 injected adapter fault cases**; these are not native schedules.

The combined local uncertainty/decision-preview cohort passes **958 tests in
26 files**, application TypeScript, owned zero-warning lint, Node syntax and
diff checks. The uncertainty migration hash remains unchanged. Source,
adapter and rollback-mechanism evidence do not qualify the application: a
fresh exact-candidate full-chain run is required. Opposite policy/risk lock
ordering, wider source-standing, protected review/merge and production
verification remain open; no register status is promoted.

**2026-10-07 — additional criteria-pointer schedules; native execution pending.**
The next local harness checkpoint specifies two isolated owner-write
persistence-fence schedules, not a customer criteria-rebind workflow. After
replacement reaches the actual audit barrier while holding its risk, a second
session attempts to repoint only that risk's criteria to either a fresh,
same-tenant adopted profile or NULL. Actual `pg_blocking_pids` witnesses are
required for both the audit wait and pointer writer's risk wait.

The replacement commit is first checked against the unchanged complete
replacement assertion while the pointer update remains uncommitted. Only
afterward is the pointer committed and checked as the sole allowed row-field
delta across all thirteen collections in both tenants. Immutable successor,
predecessor, bindings, digest, snapshot, CAS and audit history are preserved.
Fresh public workspace reads must report stale inputs with respectively
`replacement_required` or `policy_unavailable`; independent review must refuse
exactly, while an identical committed-intent replay retains its historical
receipt with no new state delta. The adopted destination is created before the
baseline; no earlier policy or history is reset to make the schedule pass.

Two source regressions failed before these schedules and pass afterward.
Root's three concurrency-source files pass **40 tests**; independent review
passes **25 tests in two files**, syntax and diff checks. The broader local
uncertainty/decision-preview cohort passes **936 tests in 25 files**. These are source
specifications, not executed native schedules. Published diagnostic head
`4713c5b0` and its exact-head CI remain unchanged while this next checkpoint is
reviewed. No product, migration, register or production claim changes; wider
opposite-order availability and source-standing qualification remain open.

**2026-10-07 — authority-refusal failure isolated to its test block; diagnosis pending.**
Core run `37686465047` on published `5c4a87c8` is terminal failure. Its
golden-path browser, unit, lint/typecheck/build and migration-order jobs passed.
The database applied the full chain and passed demo authentication/RLS and the
governed-risk preflight. Uncertainty preflight advanced through the corrected
final-audit rollback block, then failed at `21:14:18Z`, native SQL line 920:
`exact replacement authority/input refusal or full artifact preservation failed`.
Database cleanup completed at `21:14:38Z`; later uncertainty SQL, HTTP and
concurrency qualification were skipped, not passed.

The shared assertion did not retain the failing case or distinguish an exact
refusal mismatch from a full-state change. Read-only source review found no
justified expected-message change. The bounded follow-up preserves the exact
failure predicate, all thirteen cases, complete two-tenant snapshots, identity
restoration and the narrow `ZX019` rollback catch. Its exception now emits only
the controlled case name and two match/preservation booleans, never request,
actor, row or response contents. This is diagnostic instrumentation, not a
repair or qualification of the unknown mismatch. Test-first source coverage
failed before that addition and passes afterward. Product code, migration,
RLS/ACL, register claims and production remain unchanged; the next exact-head
native run is required to establish the next action. The separately scoped
clock-panel reachability follow-up is draft PR #649 and is not deployed.

The diagnostic follow-up's local cohort passes **934 tests in 25 files**
(uncertainty source/service/panel and decision-preview service/contracts),
plus application TypeScript and owned zero-warning lint. This selection is
not the earlier 810-test or 2,053-test cohort. An isolated rollback-only
PostgreSQL **16.13** mechanism proof exercised all three failing combinations
of refusal/state booleans and observed the exact diagnostic formatting. Its
private server was stopped; this does not execute the application migration
chain, the replacement RPC or the failing authority-refusal fixture.

**2026-10-07 — third native-harness failure repaired; browser failure remains open.**
Core run `37684254587` on published `a5e8c412` is terminal failure. The unit
job passed **8,852 tests in 548 files**; lint/typecheck/build and migration
ordering passed. Native preflight advanced through the committed-intent
collision block but failed at `20:54:35Z`, native SQL line 795: adjacent
`$body$` and `$ddl$` delimiters contain `$$`, prematurely ending the outer
procedural block. Database cleanup completed at `20:54:55Z`. Later full
uncertainty SQL, HTTP and concurrency qualification were skipped, not passed.

Separating those delimiters preserves the same narrowly scoped final-audit
failure injection, exact `ZX016` catch, actual replacement RPC, complete-state
rollback and absent committed-receipt checks. The new source regression failed
before the repair and passes afterward. An independent whole-owned-source
delimiter/literal scan found no additional instance and reproduced **22 tests
in two files**; this is not a full SQL/PL/pgSQL grammar check. An isolated
rollback-only PostgreSQL **16.13** mechanism proof executed the corrected
dynamic trigger, observed its exact injected SQLSTATE/message, preserved an
empty table after refusal and admitted three unrelated controls. Its private
server was stopped. This is not execution of the actual application migration
chain or replacement rollback fixture.

The repair's scoped local suite passes **810 tests in 25 files** (uncertainty
source/client/panel and finite-VOI/display contracts), plus application
TypeScript, zero-warning owned lint, formatting and both register ratchets.
This is not the same selection as the earlier 2,053-test cohort or a full
application regression.

The browser job passed 15 scenarios but failed the existing disabled-source
clock-assurance scenario: reload timed out awaiting its status RPC, and retry
encountered the exact contract persisted by the first attempt. Artifact
`11511250748`, digest
`sha256:eda7961791d0d80b59a30f06b239cdd5fa986ae700d7443e9dc13131ff6f9460`,
was retrieved; its first-attempt screenshot and error context show an
Integrations page without the Event-time assurance panel. Cause and repair
remain under review; this is not dismissed as a harmless flake or a successful
browser receipt. Production migration, application code, register claims and
release holds are unchanged; fresh exact-head qualification remains required.

**2026-10-07 — second exact-head harness failure repaired; qualification pending.**
Core run `37682076877` on published `cb85fe67` is terminal failure. Its unit,
lint/typecheck/build, migration-order and golden-path browser jobs passed. The
native preflight executed beyond the corrected retention witness, but stopped
at `2026-10-07T20:39:24Z`: the changed-request collision fixture passed an
unknown string literal to polymorphic `to_jsonb`. Later full uncertainty SQL,
HTTP and concurrency steps were skipped, not qualified. The database job's
actual cleanup completed at `20:39:44Z`.

An explicit `::text` cast preserves the same reason-only changed request,
actual public RPC, exact committed-intent collision refusal and complete
state/identity preservation. Test-first coverage failed before that repair and
passes afterward; it also rejects remaining bare string/null JSON conversions
in the whole native source. Independent bounded review reproduced 21 source
tests and found no blocker. An isolated rollback-only PostgreSQL 16.13 mechanism
proof reproduced the exact unknown-type error and executed the typed one-field
mutation; its server was stopped. This is not full-chain qualification. The
refreshed local cohort passes **2,053 tests in 25 files**. The authority batch
below remains unexecuted; production migration and register claims are unchanged.

**2026-10-07 — additional authority-race specifications; not executed.**
The next bounded qualification batch extends only the existing disposable-CI
harness: replacement versus predecessor review and ordinary submission in both
lock orders; adopted-policy/draft-policy changes; role and organization changes
before and after the final membership lock; and view/scenario writers before and
after replacement's audit barrier. Restricted-ancestor visibility cases use a
non-owner `reliability_engineer` author with exactly one named view per ancestor,
not an administrator whose access survives view deletion. Expected profile
changes allow only their independently checked canonical security event;
ordinary and earlier replacement witnesses retain zero-event defaults.

Committed-before evidence controls distinguish predecessor-only drift, which
must refuse frozen CAS, from newly selected evidence, whose current contents
can be captured in an independently reviewable pending successor. A session-local
`pg_temp` STABLE gate blocks on an unrelated canonical work table after the
outer SELECT has its snapshot, calls the unchanged actual workspace RPC, and
requires wholly old then wholly new projections around an actual replacement
commit. This is an **instrumented statement-snapshot specification**, not direct
HTTP mid-read qualification or a production helper.

The local regression cohort passes **2,052 tests in 25 files**. Independent
read-only source review reproduced 65 tests in five files and found no concrete
harness blocker. These receipts do **not** execute the new PostgreSQL schedules.
Wider criteria-pointer, new-grant/repoint/wrong-scope correction schedules,
opposite-order policy/risk availability, direct HTTP mid-read qualification,
typed-source standing, shared authentication/cockpit freshness, protected merge
and production verification remain open. No migration, product authority,
applied history, register status or production claim changes in this batch.

**2026-10-07 — bounded native-harness repair; fresh exact-head CI still required.**
Published replacement head `1e9b3c92` failed core run `37548810281` at the
isolated uncertainty preflight: PostgreSQL refused `TRUNCATE` because deferred
trigger events were pending, before the actual retention guard could run.
Later replacement SQL, HTTP and concurrency steps were skipped, not passed.
The harness now executes deferred checks before that witness and restores
deferral before `TRUNCATE`; integrity-check failures remain fatal, and the
exact retention error and full row-preservation assertions remain unchanged.
Production migrations, RPCs, RLS and ACLs are untouched.

Test-first source coverage failed before the repair and passes afterward.
The refreshed local cohort passes **2,049 tests in 25 files**, with TypeScript,
scoped lint and unchanged register ratchets passing. A rollback-only isolated
PostgreSQL **16.13** mechanism proof reproduced the original pending-event
error, executed a deferred check, observed the exact retention refusal on
both synthetic tables, and proved invalid deferred checks still fail and roll
back. Its private Unix-socket server was stopped afterward. This mechanism
model is **not** the actual SyncAI migration chain or replacement qualification.
Independent bounded source review found no blocker in the two-file harness
repair. Fresh full-chain CI and the release holds below remain required; no
register status or production claim is promoted.

**Current local closeout — atomic stale-proposal replacement; runtime pending.**
The replacement implementation extends the canonical packet and its evidence,
VOI and audit records, not a separate intent store. Only the original named
human author can replace a current stale pending packet under an available
adopted policy. Exact predecessor/version/stored-digest/live-digest/raw-policy
CAS is rechecked after canonical locks. The old proposal becomes immutable
`superseded` history; its successor remains `pending_review`, without approval,
derived evidence, work, spending or operational authorization. Deferred scoped
reciprocal checks retain middle chains and prohibit forks/cycles. The unchanged
ordinary submission door delegates to the same private validated writer.

The client prepares one deeply captured exact UTF-8 request and fingerprint,
dispatches once, and preserves its immutable intent on an unknown outcome.
Explicit read-only reconciliation recognizes only the exact current actor,
organization, risk, intent and fingerprint. Absence or mismatch never authorizes
resending or unlocking. A historical committed receipt remains recognizable
after later review or expiry; it does not assert the successor is currently
pending or usable. Observed tenant/actor/role generations suppress late UI
effects, and a known-CAS acknowledgment prevents fresh-intent resends after
A→B→A. Unobserved global membership refresh remains a separate owned hold.

Native specifications now include actual v2 and legacy-v1 replacement,
thirteen refusal cases, reciprocal three-packet history, late-audit rollback,
lost HTTP response-body reconciliation after the actual persisted due date,
and four-session competing-replacement/evidence-restoration/audit races. The
replacement-only evidence-union NOWAIT refusal avoids the inverse risk-FK
restoration deadlock and releases partial evidence locks before outer rollback.
These are **new specifications awaiting fresh exact-head CI execution**, not
native or production qualification. Independent source reviews found and
regression-tested client author/version/date/serialization defects and HTTP
proof gaps. Wider replacement-specific review/ordinary-submit and
policy/profile/view schedules, typed source approval/claim-purpose (#569),
shared cockpit/authentication freshness (#618), protected non-author merge and
production verification remain release holds. No register item is promoted.

The October 6 frozen local replacement cohort passed **2,048 tests in 25 files**, including
the unchanged shared tenancy/definer guards. Application TypeScript, scoped
lint, formatting, syntax, diff hygiene and both register ratchets pass. The
72-case synthetic HTTP containment transcript executes the real program's
assertions unchanged, including 24 adversarial cases; its clock and transport
are synthetic, not native-runtime evidence. Architecture/domain SQL and
security/tenancy client/UI/HTTP/concurrency source re-reviews found no remaining
blocker in their bounded implemented paths. Local execution uses the existing
Vitest 4.1.10 runtime. No full local build/database was claimed; disk availability
then was below 300 MiB. The bounded October 7 mechanism proof above does not
replace fresh isolated CI qualification of the actual database chain.

The published `16c82f7a` checkpoint's database job completed successfully:
full rollback SQL at `2026-10-06T23:38:08Z`, real HTTP at `23:38:10Z`, actual
PostgreSQL races at `23:38:11Z`, and database cleanup at `23:39:14Z`. Its unit
job passed 8,572 tests in 541 files. Its browser job was still live at the last
inspection. Those receipts cover that earlier standing checkpoint only, not
this new replacement implementation or production.

**Historical local checkpoint — published `16c82f7a` structural standing.** The public
workspace now returns a server-owned `reviewStanding` for each packet and a raw
canonical `policyDigest` for its current non-null criteria. Standing distinguishes
`reviewable`, `replacement_required` and `policy_unavailable`; it does not replace
stored lifecycle or digest-only `validationStatus`. In particular, a legacy v1
packet can retain an equal metadata digest while changed current thresholds
require replacement. A draft, superseded, empty or absent policy is unavailable.
The policy digest binds the existing same-org/risk UTC projection, not client
JSON-number reconstruction. These private read-only helpers convey no source
approval, reviewer eligibility or operating authority.

The SDK rejects missing or contradictory standing/CAS fields. The panel retains
human-role, pending-lifecycle and independent-author gates, hides review for
non-reviewable inputs, and no longer offers ordinary submission over a stale
stored-pending packet. It explicitly reports that governed replacement is not
yet available; this repair is **not** the replacement/reconciliation closeout.
Test-first baselines reproduced seven source failures, 26 SDK failures, a further
two superseded-policy SDK failures and four UI failures. The integrated local
cohort passes 1,773 tests in 18 files, application TypeScript, scoped lint and the
unchanged register ratchets. Added native witnesses cover private ACL execution,
timezone-stable scoped policy CAS, actual public standing for six rolled-back
policy/input changes, and legacy equal-digest policy drift; revised HTTP and
contained-transport checks cover fresh, stale and pending representations.
Those new database/HTTP witnesses remain **unexecuted at this local checkpoint**.
The separate published privacy checkpoint `86db47df` is still undergoing its own
immutable CI; its results cannot qualify these later source changes. No register
item is promoted, migration applied, production change or merge implied here.

The sections below describe the retained draft scope and intended customer
workflow, not a production-completion claim. The bounded client, backend/CI and
finite-input repairs were independently source-reviewed at local checkpoints
`a5fa94ac`, `b7c55d88` and `3a266066`. Their owned feature paths are selectively
composed on main `0e3ef27d`; unrelated stacked workstreams and historical register
claims are not imported. The composition passes 1,362 local tests in eight files,
including the current-main tenancy and definer guards, and application TypeScript
using the existing Vitest 4.1.10 runtime. Published composition `788a7082`
subsequently passed core CI run `37529983468`, including the isolated PostgreSQL
preflight, full uncertainty SQL/real HTTP smoke, browser tests and cleanup.
Those receipts qualify only that earlier head, not the subsequent local tenant
and VOI repairs, concurrent-session behavior or production deployment.

Publication remains a draft, not approval to ship the full U18 family. The old,
unapplied `20270101960000` draft is replaced in this composition by the forward
`20270103050000` migration, ordered after #561 and all published open migration
heads inspected during preparation. Migration ordering must be rechecked before
publication. The final-chain policy test first failed in three cases and now
passes: the one restrictive audit gate retains its five existing event families
and adds both uncertainty families. Current-main shared security assertions are
inherited unchanged; no historical weaker or failing guard was copied. These
source-policy checks do not establish database runtime isolation.

Independent composition review identified missing organization identity in the
panel scope. The subsequent local source repair consumes the actual canonical
profile organization ID only when profile and authenticated actor match. Its
scope generation suppresses late reads and acknowledgments, including A→B→A;
tenant-bound draft values clear while known-acknowledgment and unknown-outcome
guards remain intact. This covers **observed** context changes only. Shared page
cockpit freshness and global authentication-profile refresh/cancellation remain
separate coordinated holds; no immediate detection of unobserved server-side
membership, role or entitlement changes is claimed.

Remaining qualification includes ancestor/stakeholder privacy and actual
post-wait authority races; typed source approval, claim purpose and supersession
eligibility; stronger content/source and current-threshold digest standing;
authorized stale-pending replacement with retained history; native execution of
finite/object/date refusals; and runtime parity with the canonical unrounded
value-of-information sign.
An ordinary verified evidence item is not proof of source approval or fitness
for every claim. A child-row lock plus a fresh visibility check does not freeze
ancestor or stakeholder permissions. Neither local source tests nor the
contained baseline harness establish those broader guarantees.

The subsequent local finite/object/date phase passes 109 focused source,
client and containment tests after independent review. Its additive native
transcript specifies 84 exact refusals with full artifact preservation and
three rollback-only timezone compatibility controls. At that local checkpoint,
those PostgreSQL cases had **not** executed; neither their presence nor the
source tests clear native qualification of a later source revision or the
remaining digest, replacement, standing and VOI gaps. The original 84 refusals and three controls later executed
on published composition `788a7082` in the CI run above; no broader standing or
concurrency guarantee is inferred from them.

The local VOI/observed-context phase passes 1,561 tests in 14 files, application
TypeScript and scoped lint using the same existing runtime. Six tenant-context
failure tests preceded the repair; nine context regression cases now pass.
The VOI SDK repair had 19 failing cases before implementation, plus a separate
failing native-transcript source contract. It freezes four finite bounded input
echoes before dispatch and qualifies the receipt using the existing exact-decimal
canonical calculator. SQL classifies the unrounded numeric benefit minus cost,
then rounds displays independently; additive native parity pairs specify
comparison with the existing canonical writer and full subtransaction rollback.
Those database pairs and the revised real HTTP transcript have **not** executed.
These local results are not fresh-CI, production or full U18 completion evidence.

Independent review then reproduced cent loss and intermediate overflow in the
existing canonical TypeScript display conversion. The bounded correction retains
the exact-decimal calculation and raw-sign classification, converts the rounded
decimal string to a JavaScript number once, and normalizes rounded zero. It does
not add an arbitrary financial ceiling or claim cent-exact accounting at every
JavaScript-number magnitude. Ten new source/SDK cases failed before this repair;
the first revised 16-file cohort passed 1,609 tests plus application TypeScript
and scoped lint. Previous huge-finite refusal expectations represented the
overflow defect, not an engineering limit: compensating tests retain zero-RPC
refusal of NaN/±Infinity and qualify unchanged large/MAX finite proposals with
all authority and receipt guards intact. The native transcript now specifies
17 canonical-writer/uncertainty pairs, including maximum finite equality and the
original `1e308` fractional witness, preserving all prior refusal, privacy,
ledger and rollback assertions. Independent review corrected the latter native
fixture to retain exact NUMERIC subtraction of the information cost, even when
JavaScript-number decoding cannot distinguish net from expected at that scale.
The final 16-file source cohort passes 1,612 tests, application TypeScript and
scoped lint. Published repair `cd5b4156` subsequently passed the fresh isolated
PostgreSQL preflight in core run `37532535926` at `2026-10-06T21:23:25Z`, executing
those 17 parity pairs and the preserved refusal/date controls. That core run
subsequently completed successfully, including full uncertainty SQL and real
GoTrue/PostgREST HTTP smoke, browser acceptance and both cleanup paths. All
required automated checks and three previews passed for that immutable head;
this does not qualify the subsequent read/finite-door source changes below.

The next local phase passes 1,824 tests in 19 files, application TypeScript and
scoped lint. The uncertainty-only workspace reader now captures canonical
observed risk/organization/actor identities before dispatch, qualifies root and
nested scope echoes and stored lifecycle, and refuses malformed or rebound data
with a fixed error. Its 181 new actual-SDK cases include the hook/panel path,
empty or draft workspaces, nullable legacy evidence, stale histories, historical
criteria/currency, microsecond dates and preserved raw sensitivity strings.
The initial reader suite had 107 failures before implementation, with additional
test-first capture, Unicode/calendar and decimal-precision regressions. All
pre-existing SDK bodies except the targeted reader, including proposal-bound
mutation acknowledgment checks and #561 methods, remain unchanged.

Read qualification preserves the authoritative server snapshot; it does not
recompute raw NUMERIC arithmetic from lossy JSON-number operands. A precise
positive NUMERIC difference can legitimately produce decoded operands of 1/1,
displayed benefit/net of 1/0 and `GATHER_INFORMATION`. Finite output bounds and
known recommendations remain required: positive displayed net requires gather,
negative displayed net requires decide, while zero can retain either raw-sign
classification. This is not an independent arithmetic proof, source approval,
digest-content proof, current historical-evidence-membership proof or completed
reconciliation. No epsilon, coercion or new financial ceiling is introduced.

Independent review reproduced two additional legitimate PostgreSQL read cases:
finite timestamps beyond JavaScript Date's range, and a positive NUMERIC
confidence of `1e-999` decoded as JSON-number zero. Three regressions preceded
their correction. A private Gregorian/BigInt comparison preserves calendar,
offset and microsecond chronology through PostgreSQL's finite UTC range without
changing the shared clock engine. Read confidence admits decoded zero while
explicitly not proving exact positivity; server constraints and mutation
preflight/acknowledgment remain unchanged. A rollback-only native control and a
separate synthetic-risk real HTTP pending packet specify exact persisted
confidence/date plus a `1|1|0|0|0` pending/audit/approval/decision/work ledger.
Six adversarial contained transcript cases reject lost or rebound receipts,
incorrect representations, absent persistence and authority changes without
retry. These are source/contained qualifications, not yet execution of those
new controls through real PostgreSQL/HTTP.

The inherited canonical-writer NUMERIC-special-value concern also has a local
forward repair: the single private writer renamed by #561 is recreated in the
unapplied migration with only the shared `sync_is_finite_numeric` guard added
before calculation/DML, after preserved null/range refusals. A source contract
checks the complete original body after removing that sole guard/name change;
public governance wrapper, private ACLs, formula, evidence and audit writes are
preserved. Three source contracts failed before implementation. Twelve quoted
special-value direct-SQL cases and twelve real HTTP cases now specify the exact
finite/range refusal matrix with unchanged full canonical artifact snapshots;
an unrelated authorization refusal cannot falsely pass the harness. These new
database/API witnesses and additive workspace scope/lifecycle echoes still
require fresh runtime qualification. Applied migrations and production are
unchanged; U18.02 remains partial.

The following submitted-history phase passes 1,833 local tests in 20 files,
application TypeScript and scoped lint. Six new source failures preceded the
repair: identity, organization, author, creation time and every engineering
column are frozen from submission, not only after review. The whole-row guard
excludes exactly seven digest/review fields, then restricts them to the single
actual initial digest finalization or the retained human review transition.
Reviewed terminal rows refuse every update. Evidence bindings can only be
inserted while the initial pending packet still has its zero digest; finalized
cited history cannot be appended. Existing submit/review/digest/calculation
bodies, table schema, human gates and ACLs are unchanged.

Additive native diagnostics specify all 33 submitted immutable columns, all
40 columns of validated and rejected records, exact digest/metadata/binding and
noninitial insertion refusals, and full artifact preservation. A separate
initializer control requires wrong-digest and fabricated-review refusal before
exact canonical finalization, then rolls back all provisional data and marker
state. The rejected control uses the actual independent review RPC on version
2 and qualifies its exact packet/digest/human approval before subtransaction
rollback. Missing receipt versions cannot pass through SQL NULL comparisons.
Owner/internal-marker diagnostics are not authenticated API bypass tests; the
original API/RLS/refusal tests remain. These new history database controls have
**not executed** at this local checkpoint. Neither source tests nor old-head
CI establish native history qualification, atomic stale-pending replacement,
stronger source/content digest standing or full U18 completion.

Published read/finite-door checkpoint `49dfa77d` subsequently passed complete
core run `37535097211`, including the actual full uncertainty SQL/real HTTP
smoke at `2026-10-06T21:56:10Z`, browser acceptance and both cleanup paths.
Its native receipts did not qualify the later submitted-history checkpoint
`7b1e347f`. That published draft subsequently passed complete core run
`37537518197`: actual uncertainty preflight at `2026-10-06T22:08:51Z`, full
native SQL/real GoTrue/PostgREST smoke at `2026-10-06T22:14:07Z`, browser
acceptance and both cleanup paths. All required automated checks and three
previews passed that immutable head. Those receipts qualify the submitted-history
controls at `7b1e347f`, not the subsequent local version-two source below.

The next **local, unpublished** phase introduces explicit digest coverage:
legacy v1 retains its byte-identical original algorithm with no submission
snapshot; governed new submissions store a typed version-two binding snapshot
only after all explicit waits and the current actor check. The same private
UTC-pinned allowlisted packet projection hashes stored and current bindings.
V2 covers canonical evidence content, source reference/provenance, verification
basis, quality/applicability/revision, existing typed document and operational
anchors, and the current same-org criteria pointer, policy version, adoption
and threshold content. Missing, moved or wrong-scope dependencies produce a
deterministic **incomplete** projection and a changed hex digest, never foreign
content or a NULL/empty-array freshness success. Neither v1 history nor today's
dependencies are relabelled as historical version-two coverage.

Independent source review identified and corrected a persistence invariant:
initial digest finalization must authenticate **both** the stored snapshot and
current live bindings, even for internal-marker diagnostics. Coverage tags are
exact JSON numeric `2` and boolean `true`, with NULL-safe named CHECKs. The public
submit comparison rolls back a mismatch after insertion rather than returning
a normal error acknowledgement with partial persisted artifacts. All new
helpers revoke client execution; review/approval/audit/derived evidence and
mutable risk VOI artifacts are excluded from the payload.

The local 13-file source/SDK/tenancy cohort passes **1,634 tests**, including
22 digest contracts after 18 genuine baseline failures and two positive
controls. Independent architecture/domain source review passed the frozen SQL,
native specification and source contracts. Additive database controls specify
three timezone pairs, 11 content-only changes with unchanged revision, five
criteria changes, missing policy and rebound evidence, wrong-risk/tenant
content exclusions, exact corrupted-snapshot refusal, five named CHECK tag
refusals, original v1 dispatch and complete synthetic rollback witnesses.
Actual criteria and security-event rows are included in those witnesses.
**These added native controls remain unexecuted.** This is not cryptographic
runtime qualification, complete source approval, field deployment or release
approval. At that checkpoint digest-coverage display/SDK integration, criteria
post-wait races, ancestor/stakeholder concurrency, shared quarantine/claim-purpose
eligibility and atomic stale-pending replacement remained open. A typed document
UUID is an anchor only; no KB content is dereferenced or claim fitness inferred.

The subsequent **local, unpublished** integration closes the coverage-read and
display gap: the actual public workspace returns the stored numeric digest
version and its exact correlated coverage label. The existing SDK refuses
missing, string, mismatched or invented coverage labels; the customer panel
distinguishes legacy metadata coverage from version-two evidence content and
current criteria. Both retain the explicit boundary that content commitment is
not source approval, claim fitness or operational authority. Six adversarial
cases execute the actual HTTP smoke script against **synthetic transport**;
they do not establish live PostgreSQL/PostgREST behavior. Native v1 and v2
public-reader and real HTTP label checks are specified but remain unexecuted.

Independent security review then found eleven omitted canonical evidence
fields. One private UTC-pinned pure evidence projection, reused by the scoped
binding capture, now commits all 37 current canonical fields, including the
nine signed-edge fields, related-asset text and creation time. Twelve source
tests failed before that repair. Native diagnostics specify thirteen actual
content-only rollback mutations and nine **non-persisted** schema-typed
signed-field composite variants: they invoke the actual projection and change
the actual version-two packet payload SHA while the persisted live digest and
full artifact state remain unchanged. A schema-column/projection-key count
gate detects subsequently omitted columns; all private helper ACLs are tested
against anonymous, authenticated and service roles. No signed-edge immutability
guard is disabled, no fabricated edge row is inserted, and no device ingestion
or signature-validation qualification is inferred. Independent architecture
review reproduced a BIGINT model-register fixture incorrectly using a UUID;
the schema-grounded regression failed before correcting that fixture.

The final local 13-file cohort passes **1,672 tests**, application TypeScript,
scoped lint and HTTP script syntax checks. Independent bounded source review
does not replace native qualification. These new version-two database/API
controls have **not executed**, and neither earlier-head CI nor local tests
authorize production or mark U18.02 complete. Criteria and inherited-privacy
post-wait races, coordinated source quarantine/claim-purpose eligibility,
atomic stale-pending replacement and shared observed-authentication freshness
remain separate closeout requirements. Capability statuses are unchanged.

The next bounded **local, unpublished** checkpoint serializes independent
review against the current canonical same-organization criteria profile. The
existing risk lock stabilizes the policy pointer; an added shared criteria-row
lock is retained through approval, derived evidence and audit commit. Missing,
non-adopted, rebound or changed submitted thresholds return the exact existing
stale-analysis refusal before writes. The submit path already holds this lock;
it is not replaced. Final actor, role, visibility and digest checks remain.
Legacy v1 preserves its original metadata algorithm but cannot approve a
different current threshold policy merely because its old digest is unchanged.

The native specification adds a legacy-v1 policy-drift control inside the
existing fully rolled-back subtransaction, and an actual multi-session
PostgreSQL harness to the existing full CI smoke (not the rollback-only
preflight). Three participants and a separate observer must have four distinct
backend PIDs. Actual blocking-PID observations qualify a review held at the
approval-insert barrier and a criteria writer waiting on that reviewer; the
opposite ordering requires exact stale refusal and complete artifact
preservation. Successful review requires an exact bound ACK, one approval,
one unverified calculated evidence item and **two** canonical audit events:
the automatic approval-decision event and the explicit review event. Each is
correlated to actual packet, organization, human and digest identities. The
subsequent policy change must mark the retained validated history stale.

Only newly generated synthetic identities are committed, solely so separate
connections to the disposable CI database can see them. The reviewed seed's
exact SHA is checked before any PostgreSQL process; ambient connection overrides
are refused and a narrow environment pins the local CI target. Process errors
are sanitized, queries bounded and child termination confirmed. A source test
checks the actual existing migration job's `if: always()` Stop Supabase teardown,
which removes the disposable database, rather than claiming these fixtures
roll back. Existing canonical triggers, RLS and security guards are not bypassed.

This checkpoint passes **1,695 local tests in 14 files**, application TypeScript,
scoped lint and script syntax checks. The 23 new source/actual-script-contained
cases include 11 initial failures, six security-hardening failures, the legacy
control failure and the independently reproduced audit-count failure before
their respective repairs. These tests are not concurrent SQL execution. The
prior published coverage head `60c15953` passed its isolated native preflight
in run `37539640952` at `2026-10-06T22:28:07Z`; its full smoke was still running
when this local checkpoint was recorded. That earlier receipt cannot qualify
the new review lock, legacy refusal or multi-session harness. **All three new
native controls remain unexecuted.** Broader ancestor/stakeholder privacy,
source/quarantine/claim-purpose standing, authorized atomic replacement,
shared authentication freshness and production release remain open.

**2026-10-06 subsequent exact-head execution receipt:** the published criteria
checkpoint `604ac2dcf49ad9d9d86f2c1adf187400f424e3d0` (tree
`cc139d7fd8b7e306a6939e613baf977c246df5bf`) completed core CI run
[`37541611819`](https://github.com/Stiggtechnologies/ai-maintenance-system/actions/runs/37541611819)
successfully. Its actual isolated preflight passed at `22:43:07Z`; full native
SQL, real GoTrue/PostgREST and the actual four-session criteria harness passed
at `22:46:46Z`. The logs contain the exact concurrent-criteria PASS witness,
not a mocked SQL response. Auth-job Stop Supabase completed at `22:47:33Z`;
the sixteen browser cases and their cleanup completed at `22:45:38Z`.
All **8,494 tests in 537 files**, required checks and three Vercel previews
passed. This receipt qualifies that published criteria checkpoint only, not
the later privacy changes below, source-purpose standing or production.

The next **local, unpublished** visibility checkpoint fences dependencies of
the existing canonical `can_read_risk` rule before either mutation takes its
old target-only lock. One private, non-definer, volatile boolean helper walks
every canonical secondary origin without a hop cap or alternate permission
ladder. It locks the complete same-org risk set in UUID order with `FOR UPDATE`,
all inverse stakeholder-view references to those actual risks, and same-org
origin scenarios. Existing view rows are locked regardless of their current
user or organization: correcting those fields does not recheck an unchanged
risk FK. No dependency identity or foreign content is returned. New grants and
repointed references cannot pass their immediate risk FK while the risk fence
is held; canonical origin receipts likewise need the actual child risk lock.
The complete ordered lineage and origin tuples are recollected after locks;
drift refuses rather than silently adding an unheld dependency. Final current
profile, canonical visibility and digest checks remain unchanged.

All context locks use `NOWAIT`. This is a conservative availability tradeoff:
an otherwise authorized request can receive the existing generic unavailable
refusal under contention. It is not proof of absent risk or durable access
revocation, and it never authorizes a retry. Only `lock_not_available` is caught
before any writes; that exception unwinds the helper subtransaction's partial
locks. Normal false returns retain already acquired locks until the caller's
transaction ends. Shared canonical policies, origin guards and writers are not
modified to manufacture a passing schedule.

Eight source contracts failed before that repair. A ninth failed before the
additive native specification: exact direct-execution denial for all three
client roles, actual public/internal/confidential/restricted owner and
decision-owner branches, withdrawn-but-existing canonical stakeholder grants,
every ancestor's independent eligibility, wrong-org references, actual bound
submission/review, revoked review refusal and the foreign public-reader wall.
All diagnostic fixtures, actor state and role changes must roll back together.
The existing full-state witness now includes both newly generated synthetic
organizations in all thirteen artifact/context collections. These rollback
controls and the new multi-session privacy qualification are **unexecuted**;
source review does not establish their scheduling or runtime isolation.
The added multi-session specification uses actual public submission/review,
fresh typed three-generation ancestry, real approval/evidence barriers and
observed blocking PIDs. Writer-wins schedules require a prompt exact generic
refusal, no artifacts and a third-session partial-lock-release witness.
Helper-wins schedules require legitimate ancestor/view/scenario writers to
wait, then exact bound receipts and normalized before-to-after accounting of
all thirteen collections in both organizations, allowing only the qualified
action and the named legitimate writer mutation.
Additional schedules cover final role revalidation and overlapping sibling
ancestry. Ancestor deletion is explicitly **open**, not counted as a passing
writer: the canonical provenance guard prohibits that legitimate commit.

Two independently reproduced SDK issues also have bounded source repairs.
Submission and review use the existing strict UUID identity comparator so
PostgreSQL case normalization cannot falsely classify a successful receipt as
unknown. Review captures primitive risk/digest context before dispatch, so
later caller mutation cannot accept a rebound ACK or invalidate the original
one. Six actual service-SDK tests with mocked RPC failed before repair;
digest/action/approval/derived
evidence/VOI/authority checks and the no-retry unknown-outcome behavior remain.
The retained mount-local unknown-action lock now has a static, non-sensitive
alert across observed organization changes. An existing tenant test failed
before this warning; actions stay disabled, messages/drafts remain scope-bound,
and no old organization, actor, risk, receipt or error content is exposed in
the new scope. Qualified receipts remain privately retained by the existing
acknowledged-action guard so a scope switch cannot enable resubmission.
The warning does not unlock controls, reconcile an outcome or supply durable
idempotency. Shared authentication/cockpit ownership and the broader source,
atomic-replacement and production holds remain open.
The final local cohort passes **1,719 tests in 16 files**, including the
unchanged shared tenancy/definer guards. Four additional malformed-review
cases positively confirm the existing pre-dispatch refusal without any RPC;
they are not claimed as new red-before-repair defects. These local results do
not replace fresh exact-head native privacy qualification.

SyncAI U18.02 adds versioned uncertainty packets to the canonical Risk Operating System. It supports bounded probability estimates, confidence intervals, best/expected/worst loss cases, ranked one-at-a-time sensitivity inputs, value-of-information analysis, adopted decision-threshold snapshots and measurable reassessment triggers.

It does not add a second risk register, evidence store, approval queue or audit ledger. Each packet belongs to a canonical `risks` record, cites canonical `evidence_items`, records its human disposition in `approvals`, and writes its lifecycle events to `audit_events`.

## Control model

- Only named engineering or management roles can submit or review a packet.
- The risk must use an adopted criteria profile with non-empty decision thresholds. The exact threshold JSON is copied into the packet so later criteria changes cannot silently rewrite the historical basis.
- Every cited item must already be verified, belong to the same organization and link to the exact risk. Unverified evidence remains visible in the workspace but is ineligible for submission.
- The server validates ordering and bounds and derives both the sensitivity ranking and value-of-information result. Client calculations are previews only.
- A SHA-256 digest freezes the packet, threshold snapshot and cited-evidence metadata. Explicit v2 coverage additionally binds canonical content and current criteria; legacy v1 retains its original narrower algorithm. Full source-standing and concurrency qualification remain pending as described above.
- One pending-review packet per risk prevents competing review candidates. A new version is required after review or rejection.
- The author cannot review their own packet. Independent review validates the analysis packet; it does not verify an unverified source.
- Reviewed inputs are retained and immutable. Direct writes, deletes, truncation, anonymous access and service-role RPC bypass are refused.

## Authority boundary

Validation confirms that an independent named human reviewed the exact method, source basis, ranges, confidence interval, loss cases, sensitivity ranking, value-of-information calculation, adopted thresholds, reassessment triggers and evidence digest.

Validation does not accept risk, authorize operation, release work, approve a treatment, commit spend or certify that a source claim is true. A validated packet creates an unverified `CALCULATED` evidence item for downstream traceability; it does not promote that derived item to verified evidence. Risk decisions and risk acceptance continue through their existing governed workflows.

## Analytical scope

This slice provides transparent structured ranges and one-at-a-time sensitivity ranking. It does not claim Monte Carlo simulation, fitted probability distributions, correlated-variable modelling or a statistically derived confidence interval. Teams must name the method and basis used, cite the inputs, and state when the analysis must be reassessed. More advanced stochastic methods can later write a new version through the same controlled contract.

## Customer workflow

1. Open a risk in the Risk Operating System and inspect the adopted threshold snapshot.
2. Verify the risk-specific source evidence through the canonical evidence workflow.
3. Enter sourced probability, confidence, loss-case, sensitivity and value-of-information inputs without relying on software defaults.
4. Select eligible evidence and submit the exact packet digest for independent review.
5. A different authorized human validates or rejects the packet with a substantive basis.
6. If evidence provenance changes, the workspace reports the analysis as stale and requires a new version.

The workspace always displays `operationalAuthorization: false` to preserve the boundary between analysis quality and accountable operational authority.
