-- ============================================================================
-- Whole-life stages and stage gates (capability register U4.01–U4.07,
-- U4.10–U4.14).
--
-- Most of what an asset will cost over its life is decided before anyone turns
-- it on. The need, the options considered, the concept chosen, the design, the
-- procurement — those set the maintainability, the spares position and the
-- failure modes, and a maintenance system almost never sees any of them. It
-- meets the asset on its first day in service and inherits every decision
-- already made.
--
-- WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT PRETEND.
--
-- Recording the stages does not recover the ones already passed. On this
-- platform's own data every asset sits in an operate-or-later stage with no
-- record of anything before it, and the coverage function says exactly that
-- rather than reporting the pre-service stages as complete. Retrospective
-- gate records would be fiction; the value starts with the next acquisition.
--
-- OPERATION, MAINTENANCE AND MODIFICATION ARE NOT SEQUENTIAL.
--
-- A strict fourteen-step ladder would be wrong: an asset in service is being
-- operated AND maintained AND occasionally modified at the same time. Stages
-- therefore carry a phase (pre_service / in_service / end_of_life) and a
-- concurrency flag, and the ordering rules only constrain movement BETWEEN
-- phases. Getting this wrong would force a plant to pretend maintenance stops
-- when a modification starts.
--
-- Canonical reuse and EXTENSION rather than duplication:
--   * assets.lifecycle_status already exists (added by the onboarding
--     governance migration, default 'active') and stays as the coarse status.
--     asset_lifecycle_state adds the precise stage beside it and a trigger
--     keeps lifecycle_status in step, so nothing that already reads that
--     column breaks or drifts.
--   * lifecycle_evaluations from the lifecycle-decisions slice already models
--     the repair / replace / redesign / defer decision with frozen inputs.
--     The life-extension and replacement gates LINK to it instead of building
--     a second evaluation record; a gate review at those stages without one
--     is refused.
-- Additive.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The stage model, as master data (U4.01–U4.14)
-- ---------------------------------------------------------------------------
create table if not exists lifecycle_stages (
  stage_key text primary key,
  stage_order int not null,
  label text not null,
  phase text not null check (phase in ('pre_service', 'in_service', 'end_of_life')),
  -- True where the stage runs alongside its phase-mates rather than after them.
  is_concurrent boolean not null default false,
  -- The decision this stage owns. A stage that owns no decision is a label.
  decision_owned text not null,
  -- What leaving it should have produced.
  key_artifacts text not null,
  register_ref text not null
);

insert into lifecycle_stages
  (stage_key, stage_order, label, phase, is_concurrent, decision_owned, key_artifacts, register_ref)
values
  ('need_identification', 10, 'Need identification', 'pre_service', false,
   'Is there a need, and is a new asset the right answer to it?',
   'Statement of need, demand or compliance driver, do-nothing case', 'U4.01'),
  ('options_analysis', 20, 'Options analysis', 'pre_service', false,
   'Which credible options meet the need, and at what whole-life cost?',
   'Option long list, whole-life cost per option, non-asset options considered', 'U4.02'),
  ('concept_selection', 30, 'Concept selection', 'pre_service', false,
   'Which option is selected, and on what basis?',
   'Selection rationale, rejected options and why, sensitivity to key assumptions', 'U4.03'),
  ('design', 40, 'Design', 'pre_service', false,
   'Does the design meet the need, and can it be maintained?',
   'Design basis, maintainability and RAM review, criticality assessment', 'U4.04'),
  ('procurement', 50, 'Procurement', 'pre_service', false,
   'What is bought, from whom, and on what terms after handover?',
   'Specification, vendor data requirements, warranty and spares terms', 'U4.05'),
  ('construction', 60, 'Construction or manufacture', 'pre_service', false,
   'Was it built to the design?',
   'As-built records, deviations and concessions, quality records', 'U4.06'),
  ('commissioning', 70, 'Commissioning', 'pre_service', false,
   'Does it work, and is it ready to be handed to operations?',
   'Test records, punch list, handover dossier, initial maintenance strategy', 'U4.07'),
  ('operation', 80, 'Operation', 'in_service', true,
   'Is it being run inside its design envelope?',
   'Operating states, production records, duty and process events', 'U4.08'),
  ('maintenance', 81, 'Maintenance', 'in_service', true,
   'Is the maintenance strategy keeping it fit for its function?',
   'Work history, PM compliance, failure coding, strategy reviews', 'U4.09'),
  ('modification', 82, 'Modification', 'in_service', true,
   'Should it be changed, and has the change been controlled?',
   'Change proposal, MOC approval, updated configuration baseline', 'U4.10'),
  ('life_extension', 90, 'Life extension', 'end_of_life', false,
   'Can it run longer, safely, and is that cheaper than replacing it?',
   'Condition assessment, remaining-life estimate, economic evaluation', 'U4.11'),
  ('replacement', 91, 'Replacement', 'end_of_life', false,
   'Is replacing it better than continuing to maintain it?',
   'Economic evaluation, replacement specification, transition plan', 'U4.12'),
  ('decommissioning', 92, 'Decommissioning', 'end_of_life', false,
   'How is it taken out of service without creating a new hazard?',
   'Isolation and make-safe plan, residual energy and inventory removal', 'U4.13'),
  ('disposal', 93, 'Disposal, recycling, site restoration', 'end_of_life', false,
   'What happens to the physical asset and the ground it stood on?',
   'Disposal route, recycling and recovery record, restoration obligation closeout', 'U4.14')
on conflict (stage_key) do update set
  stage_order = excluded.stage_order,
  label = excluded.label,
  phase = excluded.phase,
  is_concurrent = excluded.is_concurrent,
  decision_owned = excluded.decision_owned,
  key_artifacts = excluded.key_artifacts,
  register_ref = excluded.register_ref;

alter table lifecycle_stages enable row level security;
drop policy if exists lifecycle_stages_read on lifecycle_stages;
-- Reference data, identical for every tenant.
create policy lifecycle_stages_read on lifecycle_stages
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Where each asset currently is
-- ---------------------------------------------------------------------------
create table if not exists asset_lifecycle_state (
  asset_id uuid primary key references assets(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  stage_key text not null references lifecycle_stages(stage_key),
  entered_at timestamptz not null default now(),
  expected_exit date,
  -- True when the stage was set by inheriting an existing register rather than
  -- by passing a gate. The difference matters and is not cosmetic.
  inherited boolean not null default false,
  note text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_als_org on asset_lifecycle_state(organization_id, stage_key);

alter table asset_lifecycle_state enable row level security;
drop policy if exists als_read on asset_lifecycle_state;
create policy als_read on asset_lifecycle_state
  for select to authenticated using (organization_id = app_current_org());

create table if not exists asset_lifecycle_transitions (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  from_stage text references lifecycle_stages(stage_key),
  to_stage text not null references lifecycle_stages(stage_key),
  moved_at timestamptz not null default now(),
  moved_by uuid references auth.users(id) on delete set null,
  gate_review_id bigint,
  reason text
);

create index if not exists idx_alt_asset
  on asset_lifecycle_transitions(organization_id, asset_id, moved_at desc);

alter table asset_lifecycle_transitions enable row level security;
drop policy if exists alt_read on asset_lifecycle_transitions;
create policy alt_read on asset_lifecycle_transitions
  for select to authenticated using (organization_id = app_current_org());

-- Keep the pre-existing coarse column honest rather than letting two sources
-- of truth drift apart.
create or replace function sync_lifecycle_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update assets set lifecycle_status = case
    when new.stage_key in ('operation', 'maintenance', 'modification') then 'active'
    when new.stage_key in ('life_extension', 'replacement') then 'end_of_life'
    when new.stage_key = 'decommissioning' then 'decommissioned'
    when new.stage_key = 'disposal' then 'disposed'
    else 'new' end
  where id = new.asset_id;
  return new;
end;
$$;

drop trigger if exists trg_sync_lifecycle_status on asset_lifecycle_state;
create trigger trg_sync_lifecycle_status
  after insert or update of stage_key on asset_lifecycle_state
  for each row execute function sync_lifecycle_status();

-- ---------------------------------------------------------------------------
-- Stage gates: what must be established before an asset leaves a stage
-- ---------------------------------------------------------------------------
create table if not exists stage_gate_criteria (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  stage_key text not null references lifecycle_stages(stage_key),
  criterion text not null,
  -- Mandatory criteria block the gate. Advisory ones are recorded and do not.
  is_mandatory boolean not null default true,
  guidance text,
  sort_order int not null default 100,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_sgc_unique
  on stage_gate_criteria(organization_id, stage_key, criterion);

alter table stage_gate_criteria enable row level security;
drop policy if exists sgc_read on stage_gate_criteria;
create policy sgc_read on stage_gate_criteria
  for select to authenticated using (organization_id = app_current_org());

create table if not exists stage_gate_reviews (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  stage_key text not null references lifecycle_stages(stage_key),
  outcome text not null check (outcome in ('pass', 'pass_with_conditions', 'hold')),
  -- Conditions are the whole point of a conditional pass.
  conditions text,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz not null default now(),
  -- The economic gates reuse the existing evaluation record rather than
  -- inventing a second one.
  evaluation_id uuid references lifecycle_evaluations(id) on delete set null,
  note text,
  check (outcome <> 'pass_with_conditions'
         or (conditions is not null and btrim(conditions) <> ''))
);

create index if not exists idx_sgr_asset
  on stage_gate_reviews(organization_id, asset_id, stage_key, reviewed_at desc);

alter table stage_gate_reviews enable row level security;
drop policy if exists sgr_read on stage_gate_reviews;
create policy sgr_read on stage_gate_reviews
  for select to authenticated using (organization_id = app_current_org());

create table if not exists stage_gate_findings (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  review_id bigint not null references stage_gate_reviews(id) on delete cascade,
  criterion_id bigint references stage_gate_criteria(id) on delete set null,
  criterion_text text not null,
  status text not null check (status in ('met', 'not_met', 'not_assessed')),
  evidence text
);

create index if not exists idx_sgf_review on stage_gate_findings(review_id);

alter table stage_gate_findings enable row level security;
drop policy if exists sgf_read on stage_gate_findings;
create policy sgf_read on stage_gate_findings
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- U4.14 — disposal. The stage most often treated as "it left the site".
-- ---------------------------------------------------------------------------
create table if not exists disposal_records (
  asset_id uuid primary key references assets(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  disposal_route text not null check (disposal_route in
    ('resale', 'redeployment', 'scrap_recycle', 'return_to_vendor',
     'hazardous_disposal', 'abandonment_in_place')),
  disposed_at date,
  recovered_value numeric,
  disposal_cost numeric,
  -- Residual obligations outlive the asset and are the part usually lost.
  site_restoration_required boolean not null default false,
  site_restoration_complete boolean not null default false,
  restoration_obligation text,
  hazardous_materials_removed boolean,
  certificate_reference text,
  created_at timestamptz not null default now(),
  -- Claiming restoration is complete without saying what the obligation was is
  -- an assertion with nothing behind it.
  check (not site_restoration_complete
         or (restoration_obligation is not null and btrim(restoration_obligation) <> ''))
);

alter table disposal_records enable row level security;
drop policy if exists disposal_read on disposal_records;
create policy disposal_read on disposal_records
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- Coverage. The honest headline for this whole slice.
-- ---------------------------------------------------------------------------
drop function if exists get_lifecycle_coverage();
create or replace function get_lifecycle_coverage()
returns table (
  assets_total bigint,
  assets_staged bigint,
  assets_inherited bigint,
  assets_with_any_pre_service_record bigint,
  assets_in_end_of_life bigint,
  gate_reviews_total bigint,
  criteria_defined bigint,
  open_restoration_obligations bigint,
  basis text
)
language sql
stable
security invoker
set search_path = public
as $$
  with org as (select app_current_org() id),
  a as (select count(*)::bigint n from assets where organization_id = (select id from org)),
  st as (
    select count(*)::bigint n,
           count(*) filter (where inherited)::bigint inherited,
           count(*) filter (where stage_key in
             ('life_extension','replacement','decommissioning','disposal'))::bigint eol
    from asset_lifecycle_state where organization_id = (select id from org)
  ),
  pre as (
    select count(distinct asset_id)::bigint n
    from stage_gate_reviews r
    join lifecycle_stages s on s.stage_key = r.stage_key
    where r.organization_id = (select id from org) and s.phase = 'pre_service'
  ),
  gr as (select count(*)::bigint n from stage_gate_reviews
          where organization_id = (select id from org)),
  cr as (select count(*)::bigint n from stage_gate_criteria
          where organization_id = (select id from org)),
  ro as (select count(*)::bigint n from disposal_records
          where organization_id = (select id from org)
            and site_restoration_required and not site_restoration_complete)
  select a.n, st.n, st.inherited, pre.n, st.eol, gr.n, cr.n, ro.n,
    case
      when st.n = 0 then
        'No asset carries a lifecycle stage yet.'
      when pre.n = 0 then
        st.n || ' of ' || a.n || ' assets carry a lifecycle stage, and NONE has a gate record '
        || 'from any pre-service stage. That is what inheriting an asset register looks like: '
        || 'need, options, concept, design and procurement set most of the whole-life cost, they '
        || 'were decided before this platform existed, and they are not recoverable from a CMMS '
        || 'export. Back-filling them would be fiction. The value starts at the next acquisition.'
        -- The gated-vs-inherited split is stated by wholeLifeCoverage() in the
        -- UI; repeating it here only makes the paragraph longer.
      else
        st.n || ' of ' || a.n || ' assets carry a lifecycle stage; ' || pre.n
        || ' have at least one pre-service gate record across ' || gr.n || ' review(s).'
    end
    || case when ro.n > 0 then ' ' || ro.n
            || ' disposed asset(s) carry an open site-restoration obligation.' else '' end
  from a, st, pre, gr, cr, ro;
$$;

grant execute on function get_lifecycle_coverage() to authenticated;

-- Distribution across the stage model, including the stages nobody is in.
create or replace function get_lifecycle_distribution()
returns table (
  stage_key text,
  label text,
  phase text,
  stage_order int,
  decision_owned text,
  asset_count bigint,
  gated_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select s.stage_key, s.label, s.phase, s.stage_order, s.decision_owned,
         count(st.asset_id)::bigint,
         count(st.asset_id) filter (where not st.inherited)::bigint
  from lifecycle_stages s
  left join asset_lifecycle_state st
    on st.stage_key = s.stage_key and st.organization_id = app_current_org()
  group by s.stage_key, s.label, s.phase, s.stage_order, s.decision_owned
  order by s.stage_order;
$$;

grant execute on function get_lifecycle_distribution() to authenticated;

-- One asset's position, its gate history and the criteria for leaving.
create or replace function get_asset_lifecycle(p_asset_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'stageKey', st.stage_key,
    'label', s.label,
    'phase', s.phase,
    'isConcurrent', s.is_concurrent,
    'decisionOwned', s.decision_owned,
    'keyArtifacts', s.key_artifacts,
    'enteredAt', st.entered_at,
    'inherited', st.inherited,
    'criteria', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'criterion', c.criterion,
        'isMandatory', c.is_mandatory, 'guidance', c.guidance)
        order by c.sort_order, c.criterion)
      from stage_gate_criteria c
      where c.organization_id = st.organization_id and c.stage_key = st.stage_key
    ), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'stageKey', r.stage_key, 'outcome', r.outcome,
        'conditions', r.conditions, 'reviewedAt', r.reviewed_at,
        'hasEvaluation', r.evaluation_id is not null,
        'findings', coalesce((
          select jsonb_agg(jsonb_build_object(
            'criterion', f.criterion_text, 'status', f.status, 'evidence', f.evidence))
          from stage_gate_findings f where f.review_id = r.id
        ), '[]'::jsonb))
        order by r.reviewed_at desc)
      from stage_gate_reviews r
      where r.asset_id = p_asset_id and r.organization_id = st.organization_id
    ), '[]'::jsonb)
  )
  from asset_lifecycle_state st
  join lifecycle_stages s on s.stage_key = st.stage_key
  where st.asset_id = p_asset_id and st.organization_id = app_current_org();
$$;

grant execute on function get_asset_lifecycle(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Moving an asset on. This is where the gate has teeth.
--
-- Definer, because the caller holds read-only RLS on these tables by design;
-- every write is scoped to app_current_org().
-- ---------------------------------------------------------------------------
create or replace function advance_lifecycle_stage(
  p_asset_id uuid,
  p_to_stage text,
  p_reason text default null
)
returns table (outcome text, detail text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_from text;
  v_from_phase text;
  v_to_phase text;
  v_from_order int;
  v_to_order int;
  v_mandatory int;
  v_review stage_gate_reviews%rowtype;
  v_review_id bigint;
begin
  if v_org is null then
    return query select 'error'::text, 'No organization in session.'::text;
    return;
  end if;
  if not exists (select 1 from assets where id = p_asset_id and organization_id = v_org) then
    return query select 'error'::text, 'No such asset in this organization.'::text;
    return;
  end if;
  select stage_order, phase into v_to_order, v_to_phase
    from lifecycle_stages where stage_key = p_to_stage;
  if v_to_order is null then
    return query select 'error'::text, ('Unknown stage "' || p_to_stage || '".')::text;
    return;
  end if;

  select stage_key into v_from from asset_lifecycle_state
   where asset_id = p_asset_id and organization_id = v_org;

  if v_from is not null then
    select stage_order, phase into v_from_order, v_from_phase
      from lifecycle_stages where stage_key = v_from;

    -- Within the in-service phase, operation / maintenance / modification run
    -- alongside each other, so movement among them is unconstrained. Moving
    -- BETWEEN phases is what a gate governs.
    if v_from_phase is distinct from v_to_phase and v_to_order > v_from_order then
      select count(*) into v_mandatory from stage_gate_criteria
       where organization_id = v_org and stage_key = v_from and is_mandatory;

      if v_mandatory > 0 then
        -- Aliased: this function's own OUT parameter is also called `outcome`,
        -- and an unqualified reference resolves to the variable, not the column.
        select r.* into v_review from stage_gate_reviews r
         where r.organization_id = v_org and r.asset_id = p_asset_id
           and r.stage_key = v_from and r.outcome in ('pass', 'pass_with_conditions')
         order by r.reviewed_at desc limit 1;

        if not found then
          return query select 'blocked'::text,
            ('Cannot leave ' || v_from || ' for ' || p_to_stage || ': '
             || v_mandatory || ' mandatory gate criterion/criteria are defined for '
             || v_from || ' and no passing gate review exists. Record the review first — '
             || 'the gate is the point at which someone takes responsibility for the '
             || 'decision, and skipping it is how a stage becomes a label.')::text;
          return;
        end if;

        -- The economic decision must rest on a frozen evaluation, not a memory.
        -- Checked against the stage being ENTERED, because that is the decision
        -- being made: moving an asset INTO life extension or replacement is the
        -- act that needs the numbers behind it.
        if p_to_stage in ('life_extension', 'replacement')
           and v_review.evaluation_id is null then
          return query select 'blocked'::text,
            ('Moving to ' || p_to_stage || ' requires the gate review to link a recorded '
             || 'lifecycle evaluation. A life-extension or replacement decision without one '
             || 'is an opinion with a timestamp.')::text;
          return;
        end if;
        v_review_id := v_review.id;
      end if;
    end if;
  end if;

  insert into asset_lifecycle_state
    (asset_id, organization_id, stage_key, entered_at, inherited, note, updated_at)
  values (p_asset_id, v_org, p_to_stage, now(), false, p_reason, now())
  on conflict (asset_id) do update set
    stage_key = excluded.stage_key,
    entered_at = now(),
    inherited = false,
    note = excluded.note,
    updated_at = now();

  insert into asset_lifecycle_transitions
    (organization_id, asset_id, from_stage, to_stage, moved_by, gate_review_id, reason)
  values (v_org, p_asset_id, v_from, p_to_stage, auth.uid(), v_review_id, p_reason);

  return query select 'moved'::text,
    (coalesce(v_from, '(unstaged)') || ' → ' || p_to_stage
     || case when v_review_id is not null then ', against gate review #' || v_review_id
             else '' end || '.')::text;
end;
$$;

grant execute on function advance_lifecycle_stage(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- Default gate criteria for every existing organization.
--
-- Without criteria a gate blocks nothing, and a gate that blocks nothing is
-- worse than no gate: it looks like control. These are the minimum set the
-- stage model implies, seeded per organization so each can add its own; they
-- are not presented as anyone's adopted standard.
-- ---------------------------------------------------------------------------
insert into stage_gate_criteria (organization_id, stage_key, criterion, is_mandatory, guidance, sort_order)
select o.id, v.stage_key, v.criterion, v.mandatory, v.guidance, v.sort_order
from organizations o
cross join (values
  ('need_identification', 'The need is stated independently of any solution', true,
   'A need written as "we need a new pump" has already chosen the answer.', 10),
  ('need_identification', 'The do-nothing consequence is described', true,
   'If nothing is done, what actually happens and when?', 20),
  ('options_analysis', 'At least one non-asset option was considered', true,
   'Changing the operating regime, buying the service, or accepting the risk.', 10),
  ('options_analysis', 'Whole-life cost is estimated for each option, not purchase price', true,
   'Purchase price is usually a minority of the total.', 20),
  ('concept_selection', 'The rejected options and the reason for rejecting them are recorded', true,
   'A selection with no recorded rejections cannot be reviewed later.', 10),
  ('concept_selection', 'The decision is tested against its most uncertain assumption', false,
   'Which assumption, if wrong, changes the answer?', 20),
  ('design', 'Maintainability and access were reviewed by someone who will maintain it', true,
   'Access for the routine task, not just for the installation.', 10),
  ('design', 'Criticality and failure modes are assessed before procurement', true,
   'This determines the spares and the strategy, and it is cheapest to decide now.', 20),
  ('procurement', 'Vendor data requirements are specified in the purchase order', true,
   'Drawings, parts lists, maintenance manuals and firmware baselines are almost impossible to obtain after payment.', 10),
  ('procurement', 'Spares and warranty terms are agreed before award', true,
   'Including what the warranty does to the maintenance strategy.', 20),
  ('construction', 'Deviations from the design are recorded as concessions', true,
   'An undocumented deviation becomes an unexplained failure mode.', 10),
  ('commissioning', 'A handover dossier exists and has been checked against the specification', true,
   'The moment the vendor data arrives or is lost for good.', 10),
  ('commissioning', 'An initial maintenance strategy and spares holding are in place', true,
   'Day one is too late to start deciding.', 20),
  ('commissioning', 'An as-built configuration baseline is recorded', true,
   'This is the reference every later drift comparison depends on.', 30),
  ('operation', 'A recorded evaluation supports taking this asset out of normal service', true,
   'Leaving the in-service phase is the most consequential lifecycle decision there is, and it is the one most often made by drift rather than by decision.', 10),
  ('maintenance', 'A recorded evaluation supports taking this asset out of normal service', true,
   'Leaving the in-service phase is the most consequential lifecycle decision there is, and it is the one most often made by drift rather than by decision.', 10),
  ('modification', 'The change is approved under management of change and the configuration baseline is updated', true,
   'A modification that does not update the as-maintained baseline creates drift by design.', 10),
  ('life_extension', 'A condition assessment supports the remaining-life estimate', true,
   'An estimate with no condition basis is a hope.', 10),
  ('replacement', 'An economic evaluation compares continuing to maintain against replacing', true,
   'Recorded with its inputs, so it can be reconstructed.', 10),
  ('decommissioning', 'Stored energy, process inventory and hazardous materials are addressed', true,
   'Taking an asset out of service can create a hazard rather than remove one.', 10),
  ('disposal', 'The disposal route and any site-restoration obligation are recorded', true,
   'The obligation outlives the asset.', 10)
) as v(stage_key, criterion, mandatory, guidance, sort_order)
on conflict (organization_id, stage_key, criterion) do nothing;

-- ---------------------------------------------------------------------------
-- Backfill: every existing asset gets a stage, MARKED INHERITED.
--
-- The flag is the honest part. These assets did not pass a commissioning gate
-- on this platform; they arrived already running, and the coverage line says
-- so rather than presenting a fully staged register.
-- ---------------------------------------------------------------------------
insert into asset_lifecycle_state (asset_id, organization_id, stage_key, inherited, note)
select a.id, a.organization_id,
       case when coalesce(a.lifecycle_status, 'active') = 'new' then 'commissioning'
            else 'operation' end,
       true,
       'Stage inherited from the existing asset register, not established at a gate.'
from assets a
on conflict (asset_id) do nothing;

-- ---------------------------------------------------------------------------
-- New tenants get the same criteria. Extended in place rather than adding a
-- second provisioning path, so there stays one answer to "what does a new
-- organization start with?".
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_organization(p_name text, p_template_org uuid DEFAULT '11111111-1111-1111-1111-111111111111'::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
declare
  v_new uuid;
  v_counts jsonb := '{}'::jsonb;
  v_n int;
begin
  if coalesce(length(trim(p_name)), 0) < 3 then
    return jsonb_build_object('error', 'an organisation needs a name');
  end if;
  if exists (select 1 from organizations where name = trim(p_name)) then
    return jsonb_build_object('error', 'an organisation with that name already exists');
  end if;

  insert into organizations (name) values (trim(p_name)) returning id into v_new;

  -- Independent reference data first.
  insert into damage_mechanisms (organization_id, mechanism_key, name, description)
  select v_new, mechanism_key, name, description
  from damage_mechanisms where organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('damage_mechanisms', v_n);

  insert into detection_techniques (organization_id, technique_key, name, description)
  select v_new, technique_key, name, description
  from detection_techniques where organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('detection_techniques', v_n);

  -- Then the matrix, remapped through the keys rather than the ids.
  insert into mechanism_detectability (organization_id, mechanism_id, technique_id,
    detectability, typical_warning, basis)
  select v_new, nm.id, nt.id, d.detectability, d.typical_warning, d.basis
  from mechanism_detectability d
  join damage_mechanisms om on om.id = d.mechanism_id
  join detection_techniques ot on ot.id = d.technique_id
  join damage_mechanisms nm on nm.organization_id = v_new and nm.mechanism_key = om.mechanism_key
  join detection_techniques nt on nt.organization_id = v_new and nt.technique_key = ot.technique_key
  where d.organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('mechanism_detectability', v_n);

  insert into system_group_candidates (organization_id, source_label, mechanism_id, basis)
  select v_new, c.source_label, nm.id, c.basis
  from system_group_candidates c
  join damage_mechanisms om on om.id = c.mechanism_id
  join damage_mechanisms nm on nm.organization_id = v_new and nm.mechanism_key = om.mechanism_key
  where c.organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('system_group_candidates', v_n);

  -- Governance reference data, all reset to DRAFT. See the header: one
  -- tenant's adoption is not another's.
  insert into taxonomy_definitions (organization_id, def_key, title, definition, basis, register_ref, status, version)
  select v_new, def_key, title, definition, basis, register_ref, 'draft', 1
  from taxonomy_definitions where organization_id = p_template_org and status in ('draft','adopted');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('taxonomy_definitions', v_n);

  insert into authority_limits (organization_id, role_key, tier_label, max_commitment_usd,
    max_risk_level, max_production_downtime_hours, escalates_to_role, basis, status)
  select v_new, role_key, tier_label, max_commitment_usd, max_risk_level,
         max_production_downtime_hours, escalates_to_role, basis, 'draft'
  from authority_limits where organization_id = p_template_org and status in ('draft','adopted');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('authority_limits', v_n);

  insert into retention_policies (organization_id, record_class, table_name, timestamp_column,
    retain_years, basis, status)
  select v_new, record_class, table_name, timestamp_column, retain_years, basis, 'draft'
  from retention_policies where organization_id = p_template_org and status in ('draft','adopted');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('retention_policies', v_n);

  insert into governance_standards (organization_id, standard_key, title, requirement,
    mandatory, owner_role, variance_approver_role, basis, status, version)
  select v_new, standard_key, title, requirement, mandatory, owner_role,
         variance_approver_role, basis, 'draft', 1
  from governance_standards where organization_id = p_template_org and status in ('draft','adopted');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('governance_standards', v_n);

  insert into engineering_approval_rules (organization_id, change_class, title, required_role, basis, status)
  select v_new, change_class, title, required_role, basis, 'draft'
  from engineering_approval_rules where organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('engineering_approval_rules', v_n);

  insert into pf_intervals (organization_id, asset_class, failure_mode, detection_technique,
    pf_interval_days, basis, status)
  select v_new, asset_class, failure_mode, detection_technique, pf_interval_days, basis, 'draft'
  from pf_intervals where organization_id = p_template_org and status in ('draft','adopted');
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('pf_intervals', v_n);

  -- Template materials only. Another tenant's real catalogue is their data.
  insert into materials (organization_id, material_code, description, category,
    unit_of_measure, lead_time_days, repairable, criticality, is_template, basis)
  select v_new, material_code, description, category, unit_of_measure, lead_time_days,
         repairable, criticality, true, basis
  from materials where organization_id = p_template_org and is_template;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('materials_templates', v_n);

  insert into ai_agents (organization_id, key, name, category, status, autonomy_mode)
  select v_new, key, name, category, 'active', autonomy_mode
  from ai_agents where organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('ai_agents', v_n);

  -- Added by the lifecycle-stages slice. A new tenant with no gate criteria
  -- has gates that block nothing, which looks like control and is not.
  insert into stage_gate_criteria
    (organization_id, stage_key, criterion, is_mandatory, guidance, sort_order)
  select v_new, stage_key, criterion, is_mandatory, guidance, sort_order
  from stage_gate_criteria where organization_id = p_template_org;
  get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object('stage_gate_criteria', v_n);

  return jsonb_build_object('organization_id', v_new, 'name', trim(p_name),
    'cloned', v_counts,
    'note', 'All governance reference data arrives as DRAFT. Adoption is an act by an accountable person in THIS organisation; inheriting another tenant''s adoptions would manufacture governance nobody performed.');
end
$$;

notify pgrst, 'reload schema';
