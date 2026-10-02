-- C5.21 — return to service is a named-human operations act backed by an
-- independently released, evidence-verified acceptance test.
--
-- Canonical reuse only:
--   * equipment_releases remains the operations/maintenance custody record;
--   * acceptance_tests remains the quality verification aggregate;
--   * evidence_items remains the evidence model;
--   * approvals and audit_events remain the decision/audit trails.
-- No second return-to-service queue, checklist store or approval model is
-- introduced. Historical accepted releases are labelled legacy_unverified;
-- they are not rewritten into evidence they never possessed.

alter table public.equipment_releases
  add column if not exists acceptance_test_id bigint
    references public.acceptance_tests(id) on delete restrict,
  add column if not exists rts_verification_status text not null default 'pending',
  add column if not exists verified_by uuid references auth.users(id) on delete set null,
  add column if not exists verified_at timestamptz,
  add column if not exists verification_sha256 text;

update public.equipment_releases
set rts_verification_status = case
  when status = 'accepted' then 'legacy_unverified'
  else 'pending'
end
where rts_verification_status = 'pending';

alter table public.equipment_releases
  drop constraint if exists equipment_releases_rts_verification_status_check;
alter table public.equipment_releases
  add constraint equipment_releases_rts_verification_status_check
  check (rts_verification_status in ('pending','verified','legacy_unverified'));

alter table public.equipment_releases
  drop constraint if exists equipment_releases_rts_verification_coherent;
alter table public.equipment_releases
  add constraint equipment_releases_rts_verification_coherent check (
    rts_verification_status <> 'verified'
    or (
      status = 'accepted'
      and acceptance_test_id is not null
      and verified_by is not null
      and verified_at is not null
      and verification_sha256 ~ '^[0-9a-f]{64}$'
    )
  );

alter table public.equipment_releases
  drop constraint if exists equipment_releases_rts_status_coherent;
alter table public.equipment_releases
  add constraint equipment_releases_rts_status_coherent check (
    (status = 'accepted' and rts_verification_status in ('verified','legacy_unverified'))
    or (status <> 'accepted' and rts_verification_status = 'pending')
  );

create unique index if not exists idx_equipment_release_one_use_rts_test
  on public.equipment_releases(acceptance_test_id)
  where acceptance_test_id is not null;

create or replace function public.enforce_equipment_release_rts_provenance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'accepted'
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and coalesce(current_setting('app.return_to_service_write', true), '') <> 'allowed' then
    raise exception 'return-to-service acceptance must use verify_and_accept_equipment'
      using errcode = '42501';
  end if;

  if new.status = 'accepted'
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and (
       new.rts_verification_status <> 'verified'
       or new.acceptance_test_id is null
       or new.verified_by is null
       or new.verified_at is null
       or new.verification_sha256 is null
     ) then
    raise exception 'authorized return-to-service verification is incomplete'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and old.status = 'accepted' and (
       new.status is distinct from old.status
       or new.acceptance_test_id is distinct from old.acceptance_test_id
       or new.accepted_by is distinct from old.accepted_by
       or new.accepted_at is distinct from old.accepted_at
       or new.acceptance_note is distinct from old.acceptance_note
       or new.rts_verification_status is distinct from old.rts_verification_status
       or new.verified_by is distinct from old.verified_by
       or new.verified_at is distinct from old.verified_at
       or new.verification_sha256 is distinct from old.verification_sha256
     ) then
    raise exception 'accepted return-to-service provenance is immutable'
      using errcode = '23514';
  end if;

  return new;
end
$$;

drop trigger if exists trg_equipment_release_rts_provenance
  on public.equipment_releases;
create trigger trg_equipment_release_rts_provenance
before insert or update
on public.equipment_releases
for each row execute function public.enforce_equipment_release_rts_provenance();

revoke all on function public.enforce_equipment_release_rts_provenance()
  from public, anon, authenticated;

-- The original compatibility RPC accepted a free-text sentence. Leaving it
-- executable would preserve the exact bypass this migration closes, so it is
-- retained only as an explicit refusal for server-side legacy callers and is
-- no longer executable through the API.
create or replace function public.accept_equipment(
  p_asset_id uuid,
  p_note text
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'error',
    'free-text acceptance is retired; use verify_and_accept_equipment with a released return-to-service acceptance test'
  );
$$;

revoke all on function public.accept_equipment(uuid, text)
  from public, anon, authenticated;

-- Operations release is the opening half of the same custody transaction.
-- Harden the existing canonical act in place: a current-tenant asset and, when
-- supplied, its same-asset work order are mandatory; machine authority is not.
create or replace function public.release_equipment(
  p_asset_id uuid,
  p_work_order_id uuid,
  p_isolation_confirmed boolean,
  p_isolation_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid := auth.uid();
  v_role text;
  v_permits integer := 0;
  v_release_id uuid;
begin
  select role into v_role
  from public.user_profiles
  where id = v_actor and organization_id = v_org;

  if v_org is null or v_actor is null or v_role is null then
    return jsonb_build_object('error','forbidden');
  end if;
  if coalesce(v_role,'') = 'ai_admin' then
    return jsonb_build_object('error','the AI-operator identity cannot release equipment custody');
  end if;
  if v_role not in ('operator','executive','admin') then
    return jsonb_build_object('error','releasing equipment is a named-human operations act');
  end if;
  -- Locking the canonical asset serializes the check-and-insert sequence, so
  -- two simultaneous operations calls cannot mint competing open releases.
  perform 1 from public.assets
  where id=p_asset_id and organization_id=v_org
  for update;
  if not found then
    return jsonb_build_object('error','same-tenant asset not found');
  end if;
  if p_work_order_id is not null and not exists(
    select 1 from public.work_orders
    where id=p_work_order_id and organization_id=v_org and asset_id=p_asset_id
  ) then
    return jsonb_build_object('error','the work order must belong to this tenant and asset');
  end if;
  if exists(
    select 1 from public.equipment_releases
    where organization_id=v_org and asset_id=p_asset_id
      and status in ('released','returned')
  ) then
    return jsonb_build_object('error','this asset is already released and not yet accepted back');
  end if;

  if p_work_order_id is not null then
    select count(*) into v_permits
    from public.work_orders w
    join public.job_plan_permits p on p.job_plan_id=w.job_plan_id
    where w.id=p_work_order_id and w.organization_id=v_org;
  end if;
  if v_permits>0 and not coalesce(p_isolation_confirmed,false) then
    return jsonb_build_object('error',format(
      'the job plan requires %s permit/isolation record(s); release requires confirmed isolation',v_permits));
  end if;
  if coalesce(p_isolation_confirmed,false)
     and coalesce(length(btrim(p_isolation_note)),0)<20 then
    return jsonb_build_object('error','a substantive isolation confirmation note is required');
  end if;

  insert into public.equipment_releases(
    organization_id,asset_id,work_order_id,released_by,isolation_confirmed,isolation_note)
  values(v_org,p_asset_id,p_work_order_id,v_actor,
    coalesce(p_isolation_confirmed,false),nullif(btrim(p_isolation_note),''))
  returning id into v_release_id;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'equipment_release',v_role,jsonb_build_object(
    'release_id',v_release_id,
    'asset_id',p_asset_id,
    'work_order_id',p_work_order_id,
    'action','released_to_maintenance',
    'released_by',v_actor,
    'isolation_confirmed',coalesce(p_isolation_confirmed,false),
    'permits_required',v_permits));

  return jsonb_build_object(
    'released',p_asset_id,
    'releaseId',v_release_id,
    'permitsRequired',v_permits,
    'returnToServiceAuthorized',false);
end
$$;

revoke all on function public.release_equipment(uuid, uuid, boolean, text)
  from public, anon;
grant execute on function public.release_equipment(uuid, uuid, boolean, text)
  to authenticated;

-- Maintenance may offer equipment back to operations, but an AI identity or
-- an operations-only identity may not impersonate the maintenance handback.
create or replace function public.return_equipment(
  p_asset_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid := auth.uid();
  v_role text;
  r public.equipment_releases%rowtype;
begin
  select role into v_role
  from public.user_profiles
  where id = v_actor and organization_id = v_org;

  if v_org is null or v_actor is null or v_role is null then
    return jsonb_build_object('error','forbidden');
  end if;
  if coalesce(v_role,'') = 'ai_admin' then
    return jsonb_build_object('error','the AI-operator identity cannot attest a maintenance handback');
  end if;
  if v_role not in ('technician','supervisor','maintenance_manager','reliability_engineer','admin') then
    return jsonb_build_object('error','maintenance handback authority denied');
  end if;

  select * into r
  from public.equipment_releases
  where organization_id = v_org
    and asset_id = p_asset_id
    and status = 'released'
  order by released_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('error','this asset is not currently released to maintenance');
  end if;
  if coalesce(length(btrim(p_note)),0) < 20 then
    return jsonb_build_object('error','record the condition, restoration state and outstanding limitations before handback');
  end if;

  update public.equipment_releases
  set status = 'returned',
      returned_by = v_actor,
      returned_at = now(),
      return_note = btrim(p_note),
      rts_verification_status = 'pending'
  where id = r.id;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'equipment_release',v_role,jsonb_build_object(
    'release_id',r.id,
    'asset_id',r.asset_id,
    'action','returned_to_operations',
    'returned_by',v_actor,
    'return_to_service_authorized',false));

  return jsonb_build_object(
    'returned',p_asset_id,
    'releaseId',r.id,
    'returnToServiceAuthorized',false,
    'note','Awaiting a released return-to-service acceptance test and named-human operations verification.');
end
$$;

revoke all on function public.return_equipment(uuid, text)
  from public, anon;
grant execute on function public.return_equipment(uuid, text)
  to authenticated;

create or replace function public.verify_and_accept_equipment(
  p_release_id uuid,
  p_acceptance_test_id bigint,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid := auth.uid();
  v_role text;
  r public.equipment_releases%rowtype;
  t public.acceptance_tests%rowtype;
  e public.evidence_items%rowtype;
  v_performer_role text;
  v_releaser_role text;
  v_sha text;
begin
  select role into v_role
  from public.user_profiles
  where id = v_actor and organization_id = v_org;

  if v_org is null or v_actor is null or v_role is null then
    return jsonb_build_object('error','forbidden');
  end if;
  if coalesce(v_role,'') = 'ai_admin' then
    return jsonb_build_object('error','the AI-operator identity cannot authorize return to service');
  end if;
  if v_role not in ('operator','executive','admin') then
    return jsonb_build_object('error','named-human operations authority is required');
  end if;
  if coalesce(length(btrim(p_note)),0) < 20 then
    return jsonb_build_object('error','operations verification note must be at least 20 characters');
  end if;

  select * into r
  from public.equipment_releases
  where id = p_release_id
    and organization_id = v_org
    and status = 'returned'
  for update;

  if not found then
    return jsonb_build_object('error','returned same-tenant equipment release not found');
  end if;
  if r.returned_by = v_actor then
    return jsonb_build_object('error','segregation of duties: the person who returned the equipment cannot accept it');
  end if;

  select * into t
  from public.acceptance_tests candidate
  where candidate.id = p_acceptance_test_id
    and candidate.organization_id = v_org
    and candidate.asset_id = r.asset_id
    and candidate.test_stage = 'return_to_service'
    and candidate.release_status = 'released'
    and candidate.outcome = 'pass'
    and candidate.punch_items_open = 0
    and candidate.performed_on >= r.released_at::date
    and candidate.released_at >= r.returned_at
    and not exists(
      select 1 from public.equipment_releases used
      where used.acceptance_test_id = candidate.id
    );

  if not found then
    return jsonb_build_object(
      'error',
      'a released return-to-service acceptance test with a pass outcome and zero open punch items is required');
  end if;
  if r.work_order_id is not null and t.work_order_id is distinct from r.work_order_id then
    return jsonb_build_object('error','the acceptance test does not cover this released work order');
  end if;

  select * into e
  from public.evidence_items e
  where e.id = t.evidence_item_id
    and e.organization_id = v_org
    and e.asset_id = r.asset_id
    and e.verification_status = 'verified';

  if not found then
    return jsonb_build_object('error','the acceptance test requires independently verified same-asset canonical evidence');
  end if;

  select role into v_performer_role
  from public.user_profiles
  where id = t.performed_by and organization_id = v_org;
  select role into v_releaser_role
  from public.user_profiles
  where id = t.released_by and organization_id = v_org;

  if t.performed_by is null or v_performer_role is null
     or coalesce(v_performer_role,'') = 'ai_admin' then
    return jsonb_build_object('error','the acceptance test requires a named-human same-tenant performer');
  end if;
  if t.released_by is null or v_releaser_role is null
     or coalesce(v_releaser_role,'') = 'ai_admin' then
    return jsonb_build_object('error','the acceptance test requires a named-human independent releaser');
  end if;
  if not public.quality_control_role(v_releaser_role) then
    return jsonb_build_object('error','the acceptance test releaser must hold quality-control authority');
  end if;
  if t.performed_by = t.released_by then
    return jsonb_build_object('error','acceptance-test performance and release must be independent');
  end if;
  if t.performed_by = v_actor then
    return jsonb_build_object('error','operations acceptance must be independent of test performance');
  end if;
  if t.released_by = v_actor then
    return jsonb_build_object('error','operations acceptance must be independent of quality release');
  end if;

  v_sha := encode(digest(jsonb_build_object(
    'release_id',r.id,
    'asset_id',r.asset_id,
    'work_order_id',r.work_order_id,
    'acceptance_test_id',t.id,
    'test_ref',t.test_ref,
    'test_stage',t.test_stage,
    'outcome',t.outcome,
    'punch_items_open',t.punch_items_open,
    'evidence_item_id',e.id,
    'evidence_verified_by',e.verified_by,
    'evidence_verified_at',e.verified_at,
    'performed_by',t.performed_by,
    'released_by',t.released_by,
    'accepted_by',v_actor,
    'acceptance_note',btrim(p_note)
  )::text,'sha256'),'hex');

  perform set_config('app.return_to_service_write','allowed',true);
  update public.equipment_releases
  set status = 'accepted',
      acceptance_test_id = t.id,
      accepted_by = v_actor,
      accepted_at = now(),
      acceptance_note = btrim(p_note),
      rts_verification_status = 'verified',
      verified_by = v_actor,
      verified_at = now(),
      verification_sha256 = v_sha
  where id = r.id;

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'equipment_release',v_role,jsonb_build_object(
    'release_id',r.id,
    'asset_id',r.asset_id,
    'action','return_to_service_verified',
    'acceptance_test_id',t.id,
    'evidence_item_id',e.id,
    'performed_by',t.performed_by,
    'test_released_by',t.released_by,
    'accepted_by',v_actor,
    'verification_sha256',v_sha));

  return jsonb_build_object(
    'accepted',r.asset_id,
    'releaseId',r.id,
    'acceptanceTestId',t.id,
    'verificationSha256',v_sha,
    'verifiedBy',v_actor,
    'returnToServiceAuthorized',true,
    'outOfServiceHours',round(extract(epoch from (now()-r.released_at))/3600.0,1),
    'authorityBoundary','This records operations return-to-service acceptance; it does not override permits, isolations, protective systems or regulatory authority.');
end
$$;

revoke all on function public.verify_and_accept_equipment(uuid, bigint, text)
  from public, anon;
grant execute on function public.verify_and_accept_equipment(uuid, bigint, text)
  to authenticated;

-- Preserve the complete production-loss read model and enrich only each open
-- canonical release with acceptance tests that satisfy the same predicate the
-- write door rechecks. The UI list is advisory; the writer remains authority.
do $$
begin
  if to_regprocedure('public.get_ops_coordination_pre_rts()') is null then
    alter function public.get_ops_coordination()
      rename to get_ops_coordination_pre_rts;
  end if;
end
$$;

create or replace function public.get_ops_coordination()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_org uuid := public.app_current_org();
  v_base jsonb;
  v_releases jsonb;
begin
  if v_org is null then
    return jsonb_build_object('error','forbidden');
  end if;

  v_base := public.get_ops_coordination_pre_rts();
  if v_base ? 'error' then return v_base; end if;

  select coalesce(jsonb_agg(
    item.value || jsonb_build_object(
      'eligible_rts_tests',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',t.id,
          'test_ref',t.test_ref,
          'performed_on',t.performed_on,
          'acceptance_criteria',t.acceptance_criteria,
          'evidence_description',e.description,
          'performed_by_name',coalesce(performer.full_name,performer.email),
          'released_by_name',coalesce(releaser.full_name,releaser.email),
          'released_at',t.released_at
        ) order by t.released_at desc)
        from public.equipment_releases r
        join public.acceptance_tests t
          on t.organization_id = r.organization_id
         and t.asset_id = r.asset_id
         and t.test_stage = 'return_to_service'
         and t.release_status = 'released'
         and t.outcome = 'pass'
         and t.punch_items_open = 0
         and t.performed_on >= r.released_at::date
         and t.released_at >= r.returned_at
         and (r.work_order_id is null or t.work_order_id = r.work_order_id)
         and not exists(
           select 1 from public.equipment_releases used
           where used.acceptance_test_id = t.id
         )
        join public.evidence_items e
          on e.id = t.evidence_item_id
         and e.organization_id = r.organization_id
         and e.asset_id = r.asset_id
         and e.verification_status = 'verified'
        join public.user_profiles performer
          on performer.id = t.performed_by
         and performer.organization_id = r.organization_id
         and performer.role <> 'ai_admin'
        join public.user_profiles releaser
          on releaser.id = t.released_by
         and releaser.organization_id = r.organization_id
         and releaser.role <> 'ai_admin'
         and public.quality_control_role(releaser.role)
        where r.id = (item.value->>'release_id')::uuid
          and r.organization_id = v_org
          and r.status = 'returned'
          and performer.id <> releaser.id
          and performer.id <> auth.uid()
          and releaser.id <> auth.uid()
      ),'[]'::jsonb)
    )
    order by (item.value->>'released_at')::timestamptz
  ),'[]'::jsonb)
  into v_releases
  from jsonb_array_elements(coalesce(v_base->'open_releases','[]'::jsonb)) item(value);

  return jsonb_set(v_base,'{open_releases}',v_releases,true)
    || jsonb_build_object(
      'return_to_service_basis',
      'Acceptance requires a released return-to-service acceptance test, verified same-asset canonical evidence, independent named-human test performance/release, and a separate named-human operations act.');
end
$$;

revoke all on function public.get_ops_coordination_pre_rts()
  from public, anon, authenticated;
revoke all on function public.get_ops_coordination()
  from public, anon;
grant execute on function public.get_ops_coordination()
  to authenticated;

update public.decision_rights
set enforcement = 'enforced',
    description = 'Return-to-service requires a released canonical return-to-service acceptance test, verified same-asset evidence, independent named-human quality release and named-human operations acceptance; AI identities and direct writes are refused.',
    version = version + 1,
    effective_at = now()
where right_key = 'return_to_service'
  and (enforcement <> 'enforced'
    or description not like 'Return-to-service requires a released canonical%');

comment on function public.verify_and_accept_equipment(uuid,bigint,text) is
  'C5.21 canonical return-to-service act: tenant-scoped, named-human operations acceptance over independently released canonical acceptance-test and verified evidence provenance; never overrides permits, isolations, protective systems or regulation.';

notify pgrst, 'reload schema';
