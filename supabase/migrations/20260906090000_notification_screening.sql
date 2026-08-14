-- ============================================================================
-- The notification loop a human can actually operate (C9.02, C6.08).
--
-- 20260904090000 modelled maintenance notifications and a duplicate detector,
-- and 20260905090000 made both loadable by a connector. Neither gave anyone a
-- way to REPORT a fault, SCREEN what was reported, CONVERT it into work, or
-- CONFIRM a merge. A grep for maintenance_notifications across src/ returns
-- nothing: the screening lifecycle those migrations declared —
-- open | in_planning | converted | rejected | merged — has never had a single
-- transition written, and every reliability argument made for detecting
-- duplicates lands on a customer with no tool to act on one.
--
-- THIS SUPERSEDES A STATEMENT IN 20260904090000. That migration says, at the
-- head of its duplicate detector, "no function here writes merged_into_id". It
-- was true of that migration and it is deliberately no longer true of this one.
-- The rule it was protecting is unchanged and is enforced below: merging is a
-- human act. What changes is that the human now has a function to do it with,
-- instead of the column being unreachable and the rule being theoretical.
--
-- Every function here is SECURITY DEFINER and records auth.uid() as the actor.
-- None of them decide anything: they carry out a decision a person has already
-- made, and refuse the ones that would corrupt history.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Report a fault.
-- ---------------------------------------------------------------------------
-- Open to any authenticated member of the organization. Restricting who may
-- REPORT is the wrong instinct: the operator who sees the leak is usually the
-- least senior person present, and a platform that makes reporting a privilege
-- gets fewer reports, not better ones. Screening is where authority belongs.
create or replace function public.raise_maintenance_notification(
  p_asset_id uuid,
  p_description text,
  p_notification_type text default 'fault'
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  v_id uuid;
  v_name text;
begin
  if v_org is null then
    return jsonb_build_object('error', 'no organization in session');
  end if;
  if coalesce(length(trim(p_description)), 0) < 5 then
    return jsonb_build_object('error',
      'describe what was observed — a notification with no observation is not a report');
  end if;
  if p_notification_type not in ('fault', 'observation', 'request', 'safety') then
    return jsonb_build_object('error', format('unknown notification type "%s"', p_notification_type));
  end if;
  -- An unmatched asset is refused rather than stored as null, for the same
  -- reason the ingest contract refuses it: a report with no equipment is
  -- invisible to duplicate detection and to every per-asset reliability figure.
  if not exists (select 1 from assets where id = p_asset_id and organization_id = v_org) then
    return jsonb_build_object('error', 'choose the equipment this was observed on');
  end if;

  select coalesce(full_name, email) into v_name from user_profiles where id = auth.uid();

  insert into maintenance_notifications
    (organization_id, asset_id, description, notification_type, reported_by, status)
  values (v_org, p_asset_id, trim(p_description), p_notification_type,
          coalesce(v_name, 'unknown'), 'open')
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'status', 'open');
end $$;

-- ---------------------------------------------------------------------------
-- Screen it: accept into planning, or reject with a reason.
-- ---------------------------------------------------------------------------
create or replace function public.screen_maintenance_notification(
  p_id uuid,
  p_status text,
  p_reason text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  n maintenance_notifications%rowtype;
begin
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('planner','reliability_engineer','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error', 'screening a notification requires a planning, engineering or administrator role');
  end if;
  if p_status not in ('in_planning', 'rejected') then
    return jsonb_build_object('error', 'screening decides in_planning or rejected');
  end if;
  -- A rejection with no reason is indistinguishable from a report nobody read,
  -- and the reporter is the person who has to decide whether to raise it again.
  if p_status = 'rejected' and coalesce(length(trim(p_reason)), 0) < 5 then
    return jsonb_build_object('error', 'say why it was rejected — the reporter needs to know whether to raise it again');
  end if;

  select * into n from maintenance_notifications
   where id = p_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'notification not found');
  end if;
  if n.status <> 'open' then
    return jsonb_build_object('error', format('this notification is already %s', n.status));
  end if;

  update maintenance_notifications
     set status = p_status,
         description = case when p_status = 'rejected'
           then description || E'\n\nRejected at screening: ' || trim(p_reason)
           else description end
   where id = p_id;

  return jsonb_build_object('id', p_id, 'status', p_status);
end $$;

-- ---------------------------------------------------------------------------
-- Convert it into work, carrying the equipment and the response mode.
-- ---------------------------------------------------------------------------
-- This is where C6.08 stops being a proxy for human-raised work: the person
-- converting is the one who knows whether this was an emergency callout or
-- planned work, and it is asked at the only moment anybody knows the answer.
create or replace function public.convert_notification_to_work_order(
  p_id uuid,
  p_title text,
  p_priority text default 'medium',
  p_work_type text default 'corrective',
  p_response_class text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  n maintenance_notifications%rowtype;
  v_wo uuid;
begin
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('planner','reliability_engineer','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error', 'converting a notification requires a planning, engineering or administrator role');
  end if;
  if coalesce(length(trim(p_title)), 0) < 5 then
    return jsonb_build_object('error', 'the work order needs a title');
  end if;
  if p_response_class is not null
     and p_response_class not in ('emergency', 'urgent', 'scheduled') then
    return jsonb_build_object('error', format('unknown response class "%s"', p_response_class));
  end if;

  select * into n from maintenance_notifications
   where id = p_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'notification not found');
  end if;
  if n.status in ('converted', 'rejected', 'merged') then
    return jsonb_build_object('error', format('this notification is already %s', n.status));
  end if;

  insert into work_orders
    (organization_id, asset_id, title, status, priority, work_type,
     response_class, created_at)
  values (v_org, n.asset_id, trim(p_title), 'open', p_priority, p_work_type,
          p_response_class, now())
  returning id into v_wo;

  update maintenance_notifications
     set status = 'converted', work_order_id = v_wo
   where id = p_id;

  return jsonb_build_object('id', p_id, 'status', 'converted', 'work_order_id', v_wo);
end $$;

-- ---------------------------------------------------------------------------
-- Confirm a merge. The human act the detector has always deferred to.
-- ---------------------------------------------------------------------------
create or replace function public.merge_maintenance_notification(
  p_duplicate_id uuid,
  p_keep_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  d maintenance_notifications%rowtype;
  k maintenance_notifications%rowtype;
begin
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('planner','reliability_engineer','maintenance_manager','admin','ai_admin') then
    return jsonb_build_object('error', 'confirming a merge requires a planning, engineering or administrator role');
  end if;
  if p_duplicate_id = p_keep_id then
    return jsonb_build_object('error', 'a notification cannot be a duplicate of itself');
  end if;

  select * into d from maintenance_notifications where id = p_duplicate_id and organization_id = v_org;
  if not found then return jsonb_build_object('error', 'duplicate notification not found'); end if;
  select * into k from maintenance_notifications where id = p_keep_id and organization_id = v_org;
  if not found then return jsonb_build_object('error', 'surviving notification not found'); end if;

  -- Two reports on different machines are two faults, whatever the wording
  -- coincidence. Merging them would delete one machine's history.
  if d.asset_id is distinct from k.asset_id then
    return jsonb_build_object('error',
      'these are on different equipment — similar wording across a fleet is a pattern, not a duplicate');
  end if;
  if d.status in ('merged', 'converted') then
    return jsonb_build_object('error', format('the duplicate is already %s', d.status));
  end if;
  -- No transitive chains. 20260904090000 refuses to cluster candidates because
  -- similarity is not transitive; letting a merge point at something already
  -- merged would rebuild that chain one confirmation at a time.
  if k.status = 'merged' then
    return jsonb_build_object('error',
      'the surviving notification has itself been merged — merge into the one that survived');
  end if;

  update maintenance_notifications
     set status = 'merged',
         merged_into_id = p_keep_id,
         merged_by = auth.uid(),
         merged_at = now(),
         description = description
           || E'\n\nConfirmed duplicate of ' || coalesce(k.notification_no, k.id::text)
           || coalesce(E'\n' || nullif(trim(p_note), ''), '')
   where id = p_duplicate_id;

  return jsonb_build_object('id', p_duplicate_id, 'status', 'merged', 'merged_into', p_keep_id);
end $$;

-- ---------------------------------------------------------------------------
-- The open queue, shaped for the screening surface.
-- ---------------------------------------------------------------------------
drop function if exists get_open_notifications(int);
create or replace function public.get_open_notifications(p_limit int default 100)
returns table (
  id uuid,
  notification_no text,
  description text,
  notification_type text,
  reported_by text,
  reported_at timestamptz,
  status text,
  asset_id uuid,
  asset_name text,
  work_order_id uuid
)
language sql stable security definer set search_path = public as $$
  select n.id, n.notification_no, n.description, n.notification_type,
         n.reported_by, n.reported_at, n.status, n.asset_id, a.name, n.work_order_id
  from maintenance_notifications n
  left join assets a on a.id = n.asset_id
  where n.organization_id = app_current_org()
    and n.status in ('open', 'in_planning')
  order by n.reported_at desc
  limit greatest(p_limit, 1);
$$;

grant execute on function public.raise_maintenance_notification(uuid, text, text) to authenticated;
grant execute on function public.screen_maintenance_notification(uuid, text, text) to authenticated;
grant execute on function public.convert_notification_to_work_order(uuid, text, text, text, text) to authenticated;
grant execute on function public.merge_maintenance_notification(uuid, uuid, text) to authenticated;
grant execute on function public.get_open_notifications(int) to authenticated;

notify pgrst, 'reload schema';
