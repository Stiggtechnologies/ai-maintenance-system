-- ============================================================================
-- Fleet-history import sessions (capability register U21.02; extends the
-- asset-onboarding capability, C9.01).
--
-- The auxiliary fleet was loaded by a hand-written parser. A customer
-- onboarding cannot depend on someone writing a parser, and — more to the
-- point — that parser made judgement calls the customer never saw: that unit
-- numbers repeat across equipment types, that MIDLIFE is an activity rather
-- than a failure, that timestamps beat a disagreeing duration column.
--
-- Each of those changes the numbers. A planned service counted as a failure
-- inflates every reliability metric; a wait counted as work inflates
-- maintenance effort; merged assets halve an apparent fleet.
--
-- So the session records the DECISIONS, not just the outcome: the column
-- mapping and the vocabulary classification a human confirmed, stored with the
-- profile they were shown when they confirmed it. An import whose judgement
-- calls cannot be reconstructed is a number with no provenance.
--
-- Nothing loads until a human confirms. commit_history_import refuses a
-- session that is not confirmed, and refuses to run twice.
--
-- Canonical reuse: assets, sites, work_orders, operating_states,
-- failure_code_map, app_current_org(). Additive.
-- ============================================================================

create table if not exists history_import_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  source_name text not null,
  source_system text not null,
  -- What the human was shown.
  column_profile jsonb not null default '[]',
  vocabulary_profile jsonb not null default '[]',
  -- What the human decided.
  column_mapping jsonb,
  vocabulary_mapping jsonb,
  preview jsonb,
  status text not null default 'profiled'
    check (status in ('profiled', 'confirmed', 'committed', 'abandoned')),
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  committed_at timestamptz,
  rows_loaded int,
  rows_rejected int,
  register_ref text not null default 'U21.02',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, source_system)
);

alter table history_import_sessions enable row level security;
drop policy if exists history_import_read on history_import_sessions;
create policy history_import_read on history_import_sessions
  for select to authenticated using (organization_id = app_current_org());

create or replace function public.start_history_import(
  p_source_name text,
  p_source_system text,
  p_column_profile jsonb,
  p_vocabulary_profile jsonb,
  p_preview jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  v_id uuid;
begin
  select role into v_role from user_profiles where id = auth.uid();
  if v_role not in ('planner','reliability_engineer','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error', 'importing fleet history requires a planning, engineering or administrator role');
  end if;
  if coalesce(length(trim(p_source_system)), 0) < 3 then
    return jsonb_build_object('error', 'a source-system key is required — it is what makes a re-import idempotent rather than duplicating');
  end if;

  insert into history_import_sessions (organization_id, source_name, source_system,
    column_profile, vocabulary_profile, preview, created_by)
  values (v_org, p_source_name, trim(p_source_system),
    coalesce(p_column_profile,'[]'), coalesce(p_vocabulary_profile,'[]'),
    p_preview, auth.uid())
  on conflict (organization_id, source_system) do update
    set source_name = excluded.source_name,
        column_profile = excluded.column_profile,
        vocabulary_profile = excluded.vocabulary_profile,
        preview = excluded.preview,
        status = case when history_import_sessions.status = 'committed'
                 then history_import_sessions.status else 'profiled' end
  returning id into v_id;

  if (select status from history_import_sessions where id = v_id) = 'committed' then
    return jsonb_build_object('error',
      format('source "%s" has already been imported. Re-importing the same source would duplicate its history; choose a new source key or abandon the existing session.', trim(p_source_system)));
  end if;

  return jsonb_build_object('session_id', v_id, 'status', 'profiled');
end
$$;

grant execute on function public.start_history_import(text, text, jsonb, jsonb, jsonb) to authenticated;

create or replace function public.confirm_history_import(
  p_id uuid,
  p_column_mapping jsonb,
  p_vocabulary_mapping jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  s history_import_sessions%rowtype;
  v_unclassified int;
begin
  select * into s from history_import_sessions where id = p_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'import session not found');
  end if;
  if s.status = 'committed' then
    return jsonb_build_object('error', 'this session is already committed');
  end if;
  if p_column_mapping is null or jsonb_array_length(p_column_mapping) = 0 then
    return jsonb_build_object('error', 'confirm the column mapping before loading');
  end if;

  -- An unclassified code is not a blocker, but it must be a DECISION rather
  -- than an oversight: it will load as raw and be invisible to every
  -- segmentation until someone classifies it.
  select count(*) into v_unclassified
  from jsonb_array_elements(coalesce(p_vocabulary_mapping, '[]'::jsonb)) v
  where v->>'kind' = 'unclassified';

  update history_import_sessions
  set column_mapping = p_column_mapping,
      vocabulary_mapping = coalesce(p_vocabulary_mapping, '[]'),
      status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = now()
  where id = p_id;

  return jsonb_build_object('session_id', p_id, 'status', 'confirmed',
    'unclassified_codes', v_unclassified,
    'note', case when v_unclassified > 0
      then format('%s code(s) remain unclassified. They will load with their raw label and stay invisible to segmentation by system group until classified.', v_unclassified)
      else 'Every code is classified.' end);
end
$$;

grant execute on function public.confirm_history_import(uuid, jsonb, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- The load. Validated, idempotent, rejects retained — the same posture as the
-- connector contract, because this IS a connector whose transport is a file.
-- ----------------------------------------------------------------------------
create or replace function public.commit_history_import(
  p_id uuid,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  s history_import_sessions%rowtype;
  v_site uuid;
  row_in jsonb;
  v_asset uuid;
  v_name text;
  v_start timestamptz;
  v_end timestamptz;
  v_dur numeric;
  v_reason text;
  v_kind text;
  v_ext text;
  v_reason_txt text;
  v_ok int := 0;
  v_rej int := 0;
  v_dup int := 0;
  v_assets int := 0;
begin
  select * into s from history_import_sessions where id = p_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'import session not found');
  end if;
  if s.status <> 'confirmed' then
    return jsonb_build_object('error',
      format('this session is %s — nothing loads until the mapping and vocabulary are confirmed by a person', s.status));
  end if;

  select id into v_site from sites
  where organization_id = v_org and name = s.source_name;
  if v_site is null then
    insert into sites (organization_id, name) values (v_org, s.source_name)
    returning id into v_site;
  end if;

  for row_in in select * from jsonb_array_elements(p_rows) loop
    v_reason_txt := null;
    v_name := nullif(trim(coalesce(row_in->>'asset_name','')), '');
    v_ext := row_in->>'external_id';
    v_start := (row_in->>'started_at')::timestamptz;
    v_end := (row_in->>'ended_at')::timestamptz;
    v_dur := (row_in->>'duration_hours')::numeric;
    v_reason := upper(trim(coalesce(row_in->>'reason_code','')));

    if v_name is null then v_reason_txt := 'no asset name or unit number';
    elsif v_ext is null then v_reason_txt := 'no external_id — a re-import could not be made idempotent';
    elsif v_start is null then v_reason_txt := 'no start timestamp';
    elsif v_end is null and v_dur is null then v_reason_txt := 'neither an end timestamp nor a duration';
    end if;

    if v_reason_txt is null then
      if v_end is null then -- secs, not hours: make_interval's hours argument is an integer and
      -- would silently truncate a 0.75-hour event to zero.
      v_end := v_start + make_interval(secs => greatest(v_dur, 0.0167) * 3600.0); end if;
      if v_end <= v_start then v_end := v_start + interval '1 minute'; end if;

      select id into v_asset from assets where organization_id = v_org and name = v_name;
      if v_asset is null then
        insert into assets (organization_id, site_id, name, asset_class, criticality, status)
        values (v_org, v_site, v_name, nullif(trim(coalesce(row_in->>'asset_class','')),''), 'medium', 'operating')
        returning id into v_asset;
        v_assets := v_assets + 1;
      end if;

      select kind into v_kind from (
        select v->>'label' as label, v->>'kind' as kind
        from jsonb_array_elements(s.vocabulary_mapping) v) m
      where m.label = v_reason;
      v_kind := coalesce(v_kind, 'unclassified');

      if exists (select 1 from operating_states
                 where organization_id = v_org and source_system = s.source_system
                   and external_id = v_ext) then
        v_dup := v_dup + 1;
        continue;
      end if;

      insert into operating_states (organization_id, asset_id, state, started_at, ended_at,
        reason_code, source_system, external_id)
      values (v_org, v_asset,
        case when v_kind = 'activity_type' then 'down_planned' else 'down_unplanned' end,
        v_start, v_end, nullif(v_reason,''), s.source_system, v_ext);

      -- Waiting is not work. A delay becomes a state and never a work order,
      -- or the work count and every effort figure derived from it inflate.
      if v_kind in ('system_group','activity_type') then
        insert into work_orders (organization_id, asset_id, wo_number, title, work_type,
          actual_failure_mode, system_group, work_activity, downtime_hours,
          created_at, completed_at, status, priority, source_system, external_id)
        values (v_org, v_asset, upper(left(s.source_system,6))||'-'||v_ext,
          left(coalesce(nullif(trim(coalesce(row_in->>'comment','')),''), v_reason, 'Down event'), 200),
          case when v_kind='activity_type' then 'preventive' else 'corrective' end,
          nullif(v_reason,''),
          case when v_kind='system_group' then nullif(v_reason,'') end,
          case when v_kind='activity_type' then nullif(v_reason,'') end,
          round(extract(epoch from (v_end - v_start))/3600.0, 2),
          v_start, v_end, 'completed',
          case when extract(epoch from (v_end - v_start))/3600.0 >= 24 then 'high' else 'medium' end,
          s.source_system, v_ext)
        on conflict do nothing;
      end if;
      v_ok := v_ok + 1;
    else
      v_rej := v_rej + 1;
      insert into ingest_staging (organization_id, entity_type, external_id, payload, status, reject_reason)
      values (v_org, 'history_row', v_ext, row_in, 'rejected', v_reason_txt);
    end if;
  end loop;

  -- The confirmed vocabulary becomes the organisation's code map.
  insert into failure_code_map (organization_id, source_label, label_kind, note)
  select v_org, v->>'label', v->>'kind',
    format('Confirmed during import of "%s" on %s.', s.source_name, now()::date)
  from jsonb_array_elements(s.vocabulary_mapping) v
  where v->>'label' is not null
  on conflict (organization_id, source_label) do nothing;

  update history_import_sessions
  set status = 'committed', committed_at = now(),
      rows_loaded = coalesce(rows_loaded,0) + v_ok,
      rows_rejected = coalesce(rows_rejected,0) + v_rej
  where id = p_id;

  return jsonb_build_object('loaded', v_ok, 'rejected', v_rej, 'duplicates', v_dup,
    'assets_created', v_assets, 'site', s.source_name);
end
$$;

grant execute on function public.commit_history_import(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
