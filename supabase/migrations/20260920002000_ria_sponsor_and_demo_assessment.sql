-- ============================================================================
-- The assessment sponsor, and a demo assessment that is honest about its gaps.
--
-- THE SPONSOR IS A CUSTOMER IDENTITY INSIDE AN OPERATIONS TENANT, AND THAT IS
-- NOT A CONTAINED POSITION. Every existing role in this system is internal to
-- the operating organization. The sponsor is the customer's accountable
-- executive for a fixed-scope engagement: they must be able to supply exports,
-- answer clarifications and read their own assessment, and they have no
-- business anywhere else in the tenant. This migration gives them the first
-- two properly and DOES NOT claim the third:
--
--   * assessment tables admit them by the same org-scoped read policy as every
--     other role, because that is the policy those tables have;
--   * roleNavigation.ts shows them a two-item menu;
--   * and menu visibility is not entitlement — roleNavigation.ts says so in
--     its own header. A sponsor account holding a session can read any
--     org-scoped table in this tenant through PostgREST, exactly as any other
--     authenticated member can.
--
-- Fine-grained per-record READ authorization is Phase 2 in the specification
-- (§6), and pretending otherwise here would be the more dangerous outcome: an
-- operator who believes the sponsor is contained will provision one against a
-- live production org. Writes are closed below and are not the open question;
-- reads are. Until the entitlement layer exists, a sponsor account belongs
-- only in an org whose whole contents are the engagement.
--
-- Role writes are service-role-only (20260910090000), so provisioning a
-- sponsor is a migration or a service act, never a client flow.
--
-- WHAT THIS MIGRATION NOW ALSO DOES, AND WHY IT HAD TO. The paragraph above
-- was written as a disclosure about READING, and it under-stated the problem
-- by a wide margin. This repository's write model is a deny-list: the org_rw
-- policies from 00000000000001 are `for all to authenticated` with an
-- organization predicate and nothing else, and the only role-aware write gate
-- (20260912123000) names 'board' and 'supervisor' explicitly. A role invented
-- after that gate is written is, by construction, permitted everything. So the
-- first version of this migration provisioned a CUSTOMER-SIDE account that
-- could UPDATE recommendations.status to 'approved', INSERT an approved
-- recommendation, and DELETE one — across assets, work_orders, approvals,
-- decisions, sensors and the rest of the org-scoped set. The approval-authority
-- trigger (00000000000022) does not catch it either: authority_limits holds no
-- row for the role and the trigger reads "no delegation recorded" as "no
-- ceiling".
--
-- An operator reading "a sponsor belongs only in an org whose whole contents
-- are the engagement" would take that as advice about confidentiality. It was
-- also, silently, the only thing standing between a customer login and the
-- approve button. The deny-list is therefore closed below for external roles
-- BEFORE the account is created, and the containment note is now about reads
-- only, which is what it was ever able to promise.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. EXTERNAL ROLES WRITE NOTHING THEY WERE NOT EXPLICITLY GIVEN.
-- ---------------------------------------------------------------------------
-- An external role is a customer identity holding a session inside an
-- operating tenant. Today there is exactly one; the predicate is a function so
-- the next one is a one-line change rather than a re-audit of every table.
create or replace function public.app_role_is_external(p_role text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(coalesce(p_role, '')) in ('assessment_sponsor');
$$;

create or replace function public.app_current_role_is_external()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.app_role_is_external(public.app_current_role());
$$;

revoke all on function public.app_role_is_external(text) from public, anon;
revoke all on function public.app_current_role_is_external() from public, anon;
grant execute on function public.app_role_is_external(text) to authenticated;
grant execute on function public.app_current_role_is_external() to authenticated;

-- THE TABLE SET IS WRITTEN OUT, NOT DISCOVERED. The first version of this
-- read pg_policy at migration time and gated whatever it found. That is worse
-- than it sounds: the set of tables a customer identity cannot write becomes
-- invisible in the diff, unreviewable, and dependent on what else happened to
-- have run — and this repository has a guard (tenancyIsolation.test.ts, "every
-- execute in every do-block was understood") whose entire purpose is to refuse
-- policy statements a reader cannot resolve statically. It refused this one,
-- correctly. So the list is literal, in the same `foreach ... in array` shape
-- 00000000000001 uses, and the block below it raises if the list has gone
-- stale — static visibility with no silent gap.
--
-- ria_data_sources is exempt on INSERT because supplying exports is the whole
-- of what the sponsor is for, and that policy already carries its own role
-- check (app_can_supply_ria_sources). Everything else the sponsor legitimately
-- does — answering a clarification, editing the alias map — goes through a
-- SECURITY DEFINER RPC with its own role gate, so none of it depends on a
-- table-level write.
--
-- The UPDATE gates put the predicate in WITH CHECK with USING left true, for
-- 20260912123000's reason: a restrictive USING denies by filtering to zero
-- rows and no error, and a client that reads "0 rows updated" as success turns
-- a refusal into a green tick. WITH CHECK raises. DELETE has no WITH CHECK in
-- Postgres, so it necessarily denies by filtering; the test for it counts rows
-- rather than expecting an exception.
do $$
declare
  t text;
  missing text[];
  write_scoped text[] := array[
    'agent_runs','ai_agents','approval_workflows','approvals','artifacts',
    'asset_failure_mode_libraries','asset_maintenance_strategy_recommendations',
    'asset_onboarding_evidence_items','asset_onboarding_exports',
    'asset_onboarding_items','asset_onboarding_runs','asset_onboarding_sessions',
    'asset_onboarding_state','asset_onboarding_steps','asset_profiles_reliability',
    'asset_twin_instances','assets','autonomous_decisions','ca_verifications',
    'components','connector_runs','cowork_messages','cowork_workspaces','decisions',
    'deployment_instances','evidence_items','integrations','learning_events',
    'notifications','raci_assignments','recommendation_approval_workflows',
    'recommendations','roles','scenarios','sensors','sites','system_alerts',
    'user_kpi_dashboard','user_preferences','user_profiles','user_role_assignments',
    'value_metrics','work_order_status_history','work_order_tasks','work_orders'
  ];
begin
  foreach t in array write_scoped loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    execute format('drop policy if exists %I on public.%I', t || '_ext_no_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_ext_no_upd', t);
    execute format('drop policy if exists %I on public.%I', t || '_ext_no_del', t);
    execute format('create policy %I on public.%I as restrictive for insert to authenticated with check (not public.app_current_role_is_external())', t || '_ext_no_ins', t);
    execute format('create policy %I on public.%I as restrictive for update to authenticated using (true) with check (not public.app_current_role_is_external())', t || '_ext_no_upd', t);
    execute format('create policy %I on public.%I as restrictive for delete to authenticated using (not public.app_current_role_is_external())', t || '_ext_no_del', t);
  end loop;

  -- Staleness alarm. If a later migration grants `authenticated` a write on a
  -- table nobody added here, this migration says so at deploy time instead of
  -- the omission being discovered by a customer identity writing to it.
  -- ria_data_sources is the one deliberate exemption.
  select array_agg(distinct c.relname order by c.relname) into missing
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and p.polpermissive
     and p.polcmd in ('*', 'a', 'w', 'd')
     and c.relname <> 'ria_data_sources'
     and not (c.relname = any(write_scoped))
     and exists (
       select 1 from unnest(p.polroles) rid
        where rid = 0 or pg_get_userbyid(rid) in ('authenticated', 'anon')
     );

  if missing is not null then
    raise exception
      'External-role write gate is stale: % grant a write to authenticated and are not in write_scoped. Add them (or exempt them deliberately) rather than leaving a customer identity able to write there.',
      missing;
  end if;
end $$;

-- ria_data_sources: INSERT is the sponsor's job, so only UPDATE and DELETE are
-- closed. Written out rather than swept, for the same visibility reason.
drop policy if exists ria_data_sources_ext_no_upd on public.ria_data_sources;
create policy ria_data_sources_ext_no_upd on public.ria_data_sources
  as restrictive for update to authenticated
  using (true) with check (not public.app_current_role_is_external());

drop policy if exists ria_data_sources_ext_no_del on public.ria_data_sources;
create policy ria_data_sources_ext_no_del on public.ria_data_sources
  as restrictive for delete to authenticated
  using (not public.app_current_role_is_external());

do $$
declare
  v_uid uuid := '00000000-0000-0000-0000-000000000009';
  v_org uuid := '11111111-1111-1111-1111-111111111111';
begin
  if not exists (select 1 from organizations where id = v_org) then
    return;
  end if;

  insert into roles (id, organization_id, key, name, description) values
    ('33333333-0000-0000-0000-000000000009', v_org,
     'assessment_sponsor', 'Assessment Sponsor',
     'Customer-side accountable executive for a fixed-scope Reliability Intelligence Assessment')
  on conflict (id) do nothing;

  update roles set code = key, level = 1
  where id = '33333333-0000-0000-0000-000000000009' and code is null;

  if exists (select 1 from auth.users where email = 'sponsor@syncai.ca') then
    return;
  end if;

  -- Demo-tier credentials, same exposure class as demo@syncai.ca. The token
  -- columns must be '' rather than NULL or GoTrue 500s on login (migrations
  -- 4/16/21 and 20260912093000 all carry this note).
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid,
    'authenticated', 'authenticated', 'sponsor@syncai.ca',
    extensions.crypt('Sponsor123!@#', extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}',
    jsonb_build_object('full_name', 'Marcus Reeve — Assessment Sponsor'),
    '', '', '', '', '', '', '', ''
  ) on conflict (id) do nothing;

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at
  ) values (
    gen_random_uuid(), v_uid, v_uid,
    jsonb_build_object('sub', v_uid::text, 'email', 'sponsor@syncai.ca'),
    'email', now(), now(), now()
  ) on conflict do nothing;

  insert into user_profiles (id, organization_id, email, full_name, role)
  values (v_uid, v_org, 'sponsor@syncai.ca',
          'Marcus Reeve — Assessment Sponsor', 'assessment_sponsor')
  on conflict (id) do update set
    organization_id = excluded.organization_id,
    role = excluded.role,
    full_name = excluded.full_name;

  insert into user_role_assignments (organization_id, user_id, role_id)
  values (v_org, v_uid, '33333333-0000-0000-0000-000000000009')
  on conflict do nothing;
end
$$;

-- ---------------------------------------------------------------------------
-- A demo assessment mid-intake.
-- ---------------------------------------------------------------------------
-- Deliberately NOT a finished engagement. Two required datasets are in and
-- rated, one is amber with its reason stated, the preferred datasets are
-- missing with the gap logged as a clarification, and the single finding is a
-- DRAFT with one evidence link — so the publication gate is demonstrably
-- unsatisfied for a high-severity finding until a decision names the authority.
-- Seeding a green, fully published assessment would make the gates look like
-- decoration.
do $$
declare
  v_org uuid := '11111111-1111-1111-1111-111111111111';
  v_assessment uuid := '44444444-0000-0000-0000-000000000001';
  v_engineer uuid := '00000000-0000-0000-0000-000000000001';
  v_sponsor uuid := '00000000-0000-0000-0000-000000000009';
  v_register uuid := '44444444-0000-0000-0000-000000000011';
  v_workorders uuid := '44444444-0000-0000-0000-000000000012';
  v_pm uuid := '44444444-0000-0000-0000-000000000013';
  v_finding uuid := '44444444-0000-0000-0000-000000000021';
begin
  if not exists (select 1 from organizations where id = v_org) then
    return;
  end if;
  if not exists (select 1 from user_profiles where id = v_engineer) then
    return;
  end if;

  insert into ria_assessments (
    id, organization_id, name, scope_label, status, commercial_model,
    sponsor_user_id, started_on, target_end_on, source_retention_until,
    primary_management_question, scope_confirmed_at, notes)
  values (
    v_assessment, v_org,
    'Reliability Intelligence Assessment',
    'Haul truck fleet, Fort McMurray — 42 units',
    'active',
    'Reliability Intelligence Assessment - Standard - US$35,000',
    (select id from user_profiles where id = v_sponsor),
    current_date - 11, current_date + 32, current_date + 400,
    'Which haul-truck failure modes are driving unplanned downtime, and which of them can be moved by a change we can make in 90 days?',
    now() - interval '11 days',
    'Seeded demo assessment. Mid-intake by design: preferred datasets outstanding, no finding published.')
  on conflict (id) do nothing;

  -- Slots exist already via the seed trigger in 20260920001000.
  insert into ria_data_sources (
    id, assessment_id, organization_id, category, file_name, object_path,
    mime_type, size_bytes, record_count, row_count, column_count, status,
    quality_grade, identifier_coverage, coverage_from, coverage_to,
    content_sha256, raw_retained, profiled_at, uploaded_by, notes)
  values
    (v_register, v_assessment, v_org, 'asset_register',
     'Northstar_AssetRegister_20260809_v01.csv',
     v_org || '/' || v_assessment || '/seed-asset-register.csv',
     'text/csv', 41231, 42, 42, 11, 'accepted', 'supported',
     1.0, null, null, 'seed-not-a-real-digest', true, now() - interval '9 days',
     v_sponsor, 'Complete register, hierarchy present.'),
    (v_workorders, v_assessment, v_org, 'work_orders',
     'Northstar_WorkOrders_20260809_v01.csv',
     v_org || '/' || v_assessment || '/seed-work-orders.csv',
     'text/csv', 8814423, 21894, 21894, 17, 'accepted', 'partial',
     0.982, current_date - 760, current_date - 6, 'seed-not-a-real-digest', true,
     now() - interval '9 days', v_sponsor,
     '25 months of history. failure_code populated on 31% of corrective orders.'),
    (v_pm, v_assessment, v_org, 'pm_plans',
     'Northstar_PMPlans_20260812_v01.csv',
     v_org || '/' || v_assessment || '/seed-pm-plans.csv',
     'text/csv', 118330, 604, 604, 9, 'profiled', 'unreviewed',
     0.874, null, null, 'seed-not-a-real-digest', true, now() - interval '6 days',
     v_sponsor, 'active_status blank on 76 plans.')
  on conflict (id) do nothing;

  update ria_data_sources d
     set dq_exceptions = jsonb_build_array(
           jsonb_build_object('rows', 15108, 'reason', 'failure_code empty on a corrective order'),
           jsonb_build_object('rows', 412, 'reason', 'complete_date earlier than created_date')),
         missing_required_fields = array['cause_code']
   where d.id = v_workorders and d.dq_exceptions = '[]'::jsonb;

  update ria_data_sources d
     set dq_exceptions = jsonb_build_array(
           jsonb_build_object('rows', 76, 'reason', 'active_status blank')),
         missing_required_fields = array['last_done']
   where d.id = v_pm and d.dq_exceptions = '[]'::jsonb;

  -- Ratings, with the reasons the constraint requires.
  update ria_dataset_slots s
     set readiness = 'green',
         readiness_note = 'Asset identifiers, class and hierarchy coherent across all 42 units.',
         rated_by = v_engineer, rated_at = now() - interval '8 days', updated_at = now()
   where s.assessment_id = v_assessment and s.dataset_key = 'asset_register'
     and s.readiness in ('missing','received','profiled');

  update ria_dataset_slots s
     set readiness = 'amber',
         readiness_note = 'Chronology and asset linkage are sound over 25 months, but failure coding is populated on 31% of corrective orders. Failure-mode conclusions will carry an explicit evidence limitation; MTBF and downtime analysis are unaffected.',
         rated_by = v_engineer, rated_at = now() - interval '8 days', updated_at = now()
   where s.assessment_id = v_assessment and s.dataset_key = 'work_orders'
     and s.readiness in ('missing','received','profiled');

  update ria_dataset_slots s
     set readiness_note = 'Not supplied. Downtime denominator will come from work-order downtime_hours, which is a weaker basis; logged as a stated limitation.',
         updated_at = now()
   where s.assessment_id = v_assessment and s.dataset_key = 'downtime_meter'
     and s.readiness = 'missing' and s.readiness_note is null;

  insert into ria_clarifications (
    id, assessment_id, organization_id, dataset_key, question, context,
    blocks_analysis, status, asked_by, asked_at)
  values
    ('44444444-0000-0000-0000-000000000031', v_assessment, v_org, 'work_orders',
     'Which failure and cause codes does the site consider unreliable, and from what date did the current coding practice start?',
     'failure_code is empty on 15,108 of 48,600 corrective orders; cause_code is absent from the export entirely.',
     true, 'open', v_engineer, now() - interval '7 days'),
    ('44444444-0000-0000-0000-000000000032', v_assessment, v_org, 'dealer_oem',
     'Are dealer and OEM repair records available for the fleet, and under what contractual restriction?',
     'External repair spend is not visible in the CMMS export; without it, total cost of ownership per unit is not supportable.',
     false, 'open', v_engineer, now() - interval '7 days'),
    ('44444444-0000-0000-0000-000000000033', v_assessment, v_org, 'operating_measure',
     'Which business measure does management already trust for haul-truck availability?',
     'Kickoff question 2. The answer determines the denominator every headline metric is expressed against.',
     true, 'open', v_engineer, now() - interval '7 days')
  on conflict (id) do nothing;

  insert into ria_asset_aliases (
    assessment_id, organization_id, source_system, source_alias,
    canonical_asset_ref, resolved, notes, created_by)
  values
    (v_assessment, v_org, 'Dealer service portal', 'NS-HT-0114',
     'HT-114', true, 'Confirmed against serial number on the register.', v_sponsor),
    (v_assessment, v_org, 'Legacy fuel system', 'TRK114',
     null, false, 'Alias appears in fuel burn extract; not yet matched to a register unit.', v_sponsor)
  on conflict (assessment_id, source_system, source_alias) do nothing;

  -- A HIGH finding, drafted, with one evidence link and NO governing decision.
  -- It therefore cannot pass the publication gate — which is the point of
  -- seeding it.
  insert into ria_findings (
    id, assessment_id, organization_id, title, statement, severity, confidence,
    evidence_grade, decision_boundary, review_state, created_at)
  values (
    v_finding, v_assessment, v_org,
    'Front strut recurrence concentrates in eight units',
    'Eight of 42 haul trucks account for 61% of front-strut corrective orders over 25 months. Whether the driver is component, duty cycle or rebuild vendor is NOT established by the supplied data, because failure coding is absent on most of the population.',
    'high', 'medium', 'partially_supported',
    'Do not re-specify struts or change a rebuild vendor on this finding alone. It supports prioritising the eight units for investigation, nothing further.',
    'draft', now() - interval '3 days')
  on conflict (id) do nothing;

  insert into ria_finding_evidence (
    organization_id, finding_id, data_source_id, record_reference, note, linked_by)
  values (
    v_org, v_finding, v_workorders,
    'Corrective orders, work_type=CM, short_text ILIKE %strut%',
    'Recurrence counted per asset_id over the full 25-month window.',
    v_engineer)
  on conflict do nothing;
end
$$;

notify pgrst, 'reload schema';
