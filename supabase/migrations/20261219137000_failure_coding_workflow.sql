-- C2.03 — reachable, governed human failure-mechanism coding.

create table if not exists public.failure_mechanism_coding_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  prior_mechanism_id uuid references public.damage_mechanisms(id),
  mechanism_id uuid not null references public.damage_mechanisms(id),
  coding_note text not null check (length(btrim(coding_note)) >= 10),
  coded_by uuid not null references auth.users(id),
  coded_at timestamptz not null default now()
);
create index if not exists idx_failure_mechanism_coding_events_work
  on public.failure_mechanism_coding_events(organization_id,work_order_id,coded_at desc);
alter table public.failure_mechanism_coding_events enable row level security;
drop policy if exists failure_mechanism_coding_events_read
  on public.failure_mechanism_coding_events;
create policy failure_mechanism_coding_events_read
  on public.failure_mechanism_coding_events for select to authenticated
  using (organization_id=public.app_current_org());
revoke insert,update,delete,truncate on public.failure_mechanism_coding_events
  from anon,authenticated;
grant select on public.failure_mechanism_coding_events to authenticated;

create or replace function public.enforce_failure_coding_event_tenant()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if not exists(select 1 from public.work_orders w
    where w.id=new.work_order_id and w.organization_id=new.organization_id) then
    raise exception 'failure coding work order must belong to the receipt organization';
  end if;
  if not exists(select 1 from public.damage_mechanisms dm
    where dm.id=new.mechanism_id and dm.organization_id=new.organization_id) then
    raise exception 'failure coding mechanism must belong to the receipt organization';
  end if;
  if new.prior_mechanism_id is not null and not exists(select 1 from public.damage_mechanisms dm
    where dm.id=new.prior_mechanism_id and dm.organization_id=new.organization_id) then
    raise exception 'prior failure mechanism must belong to the receipt organization';
  end if;
  if not exists(select 1 from public.user_profiles up
    where up.id=new.coded_by and up.organization_id=new.organization_id) then
    raise exception 'failure coding actor must belong to the receipt organization';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_enforce_failure_coding_event_tenant
  on public.failure_mechanism_coding_events;
create trigger trg_enforce_failure_coding_event_tenant
before insert or update on public.failure_mechanism_coding_events
for each row execute function public.enforce_failure_coding_event_tenant();
revoke all on function public.enforce_failure_coding_event_tenant() from public,anon,authenticated;

-- The broad work-order policy remains available for ordinary work management,
-- but these four governed columns can change only under a definer-owned RPC.
create or replace function public.protect_failure_mechanism_provenance()
returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if current_user = 'postgres' then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;
  if tg_op='INSERT' then
    if new.failure_mechanism_id is not null or new.mechanism_coded_by is not null
       or new.mechanism_coded_at is not null or new.mechanism_note is not null then
      raise exception 'failure mechanism provenance changes require code_failure_mechanism()';
    end if;
    return new;
  end if;
  if tg_op='DELETE' then
    if old.failure_mechanism_id is not null then
      raise exception 'governed coded failure history cannot be deleted directly';
    end if;
    return old;
  end if;
  if (new.failure_mechanism_id,new.mechanism_coded_by,new.mechanism_coded_at,new.mechanism_note,
      new.asset_id,new.work_type,new.completed_at)
       is distinct from
     (old.failure_mechanism_id,old.mechanism_coded_by,old.mechanism_coded_at,old.mechanism_note,
      old.asset_id,old.work_type,old.completed_at)
     and (old.failure_mechanism_id is not null or new.failure_mechanism_id is not null) then
    raise exception 'governed failure history changes require the approved closeout or coding function';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_protect_failure_mechanism_provenance on public.work_orders;
create trigger trg_protect_failure_mechanism_provenance
before insert or update or delete
on public.work_orders for each row
execute function public.protect_failure_mechanism_provenance();
revoke all on function public.protect_failure_mechanism_provenance() from public,anon,authenticated;

create or replace function public.code_failure_mechanism(
  p_work_order_id uuid,p_mechanism_key text,p_note text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.app_current_org();
  v_role text;
  v_mech uuid;
  w public.work_orders%rowtype;
begin
  if v_org is null or auth.uid() is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from public.user_profiles
  where id=auth.uid() and organization_id=v_org;
  if v_role is null or v_role not in ('reliability_engineer','maintenance_manager','technician','admin') then
    return jsonb_build_object('error','coding a failure mechanism requires a maintenance or engineering role');
  end if;
  if coalesce(length(btrim(p_note)),0)<10 then
    return jsonb_build_object('error','a coding evidence note of at least 10 characters is required');
  end if;
  select * into w from public.work_orders
  where id=p_work_order_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','work order not found'); end if;
  if w.work_type<>'corrective' then
    return jsonb_build_object('error','a failure mechanism can be coded only on corrective work');
  end if;
  select id into v_mech from public.damage_mechanisms
  where organization_id=v_org and mechanism_key=p_mechanism_key;
  if v_mech is null then return jsonb_build_object('error','unknown mechanism'); end if;
  if w.failure_mechanism_id=v_mech then
    return jsonb_build_object('error','this mechanism is already the governed coding');
  end if;
  if w.failure_mechanism_id is not null
     and v_role not in ('reliability_engineer','maintenance_manager','admin') then
    return jsonb_build_object('error','correcting an existing coding requires engineering or manager authority');
  end if;

  update public.work_orders set failure_mechanism_id=v_mech,
    mechanism_coded_by=auth.uid(),mechanism_coded_at=now(),mechanism_note=btrim(p_note)
  where id=w.id;
  insert into public.failure_mechanism_coding_events(
    organization_id,work_order_id,prior_mechanism_id,mechanism_id,coding_note,coded_by)
  values(v_org,w.id,w.failure_mechanism_id,v_mech,btrim(p_note),auth.uid());
  return jsonb_build_object('coded',w.id,'mechanism',p_mechanism_key,
    'corrected',w.failure_mechanism_id is not null);
end;
$$;
revoke all on function public.code_failure_mechanism(uuid,text,text) from public,anon;
grant execute on function public.code_failure_mechanism(uuid,text,text) to authenticated;

create or replace function public.get_failure_coding_queue(p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_limit int:=least(greatest(coalesce(p_limit,50),1),100);
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  return jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'workOrderId',q.id,'workOrderNumber',q.wo_number,'title',q.title,
      'assetTag',q.asset_tag,'priority',q.priority,'completedAt',q.completed_at,
      'rawSourceLabel',q.actual_failure_mode,'systemGroup',q.system_group,
      'candidates',coalesce((select jsonb_agg(jsonb_build_object(
        'mechanismKey',dm.mechanism_key,'name',dm.name,'description',dm.description)
        order by dm.name)
        from (select dm.mechanism_key,dm.name,dm.description
          from public.system_group_candidates c join public.damage_mechanisms dm
            on dm.id=c.mechanism_id and dm.organization_id=v_org
          where c.organization_id=v_org and c.source_label=q.system_group
          order by dm.name limit 25) dm),'[]'::jsonb)
    ) order by q.priority_rank,q.completed_at desc nulls last,q.id) from (
      select w.id,w.wo_number,w.title,w.priority,w.completed_at,w.actual_failure_mode,
        w.system_group,a.tag asset_tag,
        case w.priority when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end priority_rank
      from public.work_orders w join public.assets a
        on a.id=w.asset_id and a.organization_id=w.organization_id
      where w.organization_id=v_org and w.work_type='corrective'
        and w.failure_mechanism_id is null
      order by priority_rank,w.completed_at desc nulls last,w.id limit v_limit
    ) q),'[]'::jsonb),
    'allMechanisms',(select coalesce(jsonb_agg(jsonb_build_object(
      'mechanismKey',dm.mechanism_key,'name',dm.name,'description',dm.description)
      order by dm.name),'[]'::jsonb)
      from (select * from public.damage_mechanisms
        where organization_id=v_org order by name limit 500) dm),
    'candidateLimitPerItem',25,
    'mechanismLibraryLimit',500,
    'mechanismLibraryTotal',(select count(*) from public.damage_mechanisms where organization_id=v_org),
    'limit',v_limit,
    'basis','Priority-ordered uncoded corrective work. Candidate mechanisms are a bounded shortlist only; a named human selects from the governed mechanism library result and supplies an evidence note. The returned total and limit disclose if that library result is truncated.'
  );
end;
$$;
revoke all on function public.get_failure_coding_queue(int) from public,anon;
grant execute on function public.get_failure_coding_queue(int) to authenticated;
notify pgrst,'reload schema';
