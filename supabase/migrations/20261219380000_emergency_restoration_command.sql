-- U16.01 — governed operating modes over canonical Sync Recovery events.
-- Mode records never dispatch work, release plans, isolate equipment, or declare safety.

create table public.recovery_operating_commands (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 site_id uuid references public.sites(id) on delete cascade, asset_id uuid references public.assets(id) on delete cascade,
 restoration_event_id uuid references public.restoration_events(id) on delete set null, command_ref text not null,
 current_mode text not null default 'normal' check(current_mode in ('normal','elevated_risk','emergency_response','business_continuity','damage_assessment','restoration','recovery','post_event_learning')),
 mode_started_at timestamptz not null default now(), created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(organization_id,command_ref), check(site_id is not null or asset_id is not null), check(length(btrim(command_ref))>=3));
create table public.recovery_operating_mode_transitions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 command_id uuid not null references public.recovery_operating_commands(id) on delete cascade,
 from_mode text not null check(from_mode in ('normal','elevated_risk','emergency_response','business_continuity','damage_assessment','restoration','recovery','post_event_learning')),
 to_mode text not null check(to_mode in ('normal','elevated_risk','emergency_response','business_continuity','damage_assessment','restoration','recovery','post_event_learning')),
 status text not null default 'pending' check(status in ('pending','authorized','rejected')),
 basis text not null, evidence_item_ids uuid[] not null default '{}', missing_evidence text[] not null default '{}',
 requested_by uuid not null references auth.users(id), requested_role text not null, requested_at timestamptz not null default now(),
 reviewed_by uuid references auth.users(id), reviewed_role text, reviewed_at timestamptz, review_note text,
 check(from_mode<>to_mode), check(length(btrim(basis))>=20), check(status='pending' or (reviewed_by is not null and reviewed_at is not null and length(btrim(review_note))>=20)));
create unique index recovery_one_pending_mode_transition on public.recovery_operating_mode_transitions(command_id) where status='pending';
create index recovery_commands_org_mode on public.recovery_operating_commands(organization_id,current_mode,updated_at desc);
create index recovery_mode_transitions_command on public.recovery_operating_mode_transitions(organization_id,command_id,requested_at desc);
alter table public.recovery_operating_commands enable row level security;
alter table public.recovery_operating_mode_transitions enable row level security;
create policy recovery_operating_commands_read on public.recovery_operating_commands for select to authenticated using(organization_id=public.app_current_org());
create policy recovery_operating_mode_transitions_read on public.recovery_operating_mode_transitions for select to authenticated using(organization_id=public.app_current_org());
revoke insert,update,delete,truncate on public.recovery_operating_commands from public,anon,authenticated;
revoke insert,update,delete,truncate on public.recovery_operating_mode_transitions from public,anon,authenticated;

create function public.protect_recovery_operating_command() returns trigger language plpgsql set search_path=public as $$ begin
 if tg_op='DELETE' then raise exception 'Operating command history is immutable.'; end if;
 if new.organization_id is distinct from old.organization_id or new.site_id is distinct from old.site_id or new.asset_id is distinct from old.asset_id or new.restoration_event_id is distinct from old.restoration_event_id or new.command_ref is distinct from old.command_ref or new.created_by is distinct from old.created_by then raise exception 'Operating command identity is immutable.'; end if;
 if new.current_mode is distinct from old.current_mode and current_setting('app.recovery_mode_authorized',true) is distinct from 'granted' then raise exception 'Operating mode changes require an independently authorized transition.'; end if; return new; end $$;
create trigger protect_recovery_operating_command before update or delete on public.recovery_operating_commands for each row execute function public.protect_recovery_operating_command();
create function public.protect_recovery_mode_transition() returns trigger language plpgsql set search_path=public as $$ begin
 if tg_op='DELETE' then raise exception 'Operating-mode transition history is immutable.'; end if;
 if old.status<>'pending' or current_setting('app.recovery_mode_authorized',true) is distinct from 'granted' then raise exception 'Transition records change only through independent authorization.'; end if;
 if (to_jsonb(new)-array['status','reviewed_by','reviewed_role','reviewed_at','review_note']::text[]) is distinct from (to_jsonb(old)-array['status','reviewed_by','reviewed_role','reviewed_at','review_note']::text[]) then raise exception 'Transition request provenance is immutable.'; end if; return new; end $$;
create trigger protect_recovery_mode_transition before update or delete on public.recovery_operating_mode_transitions for each row execute function public.protect_recovery_mode_transition();

create function public.create_recovery_operating_command(p_command jsonb) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); v_id uuid; v_asset uuid:=nullif(p_command->>'asset_id','')::uuid; v_site uuid:=nullif(p_command->>'site_id','')::uuid; v_event uuid:=nullif(p_command->>'restoration_event_id','')::uuid;
begin
 if v_org is null or coalesce(v_role,'') not in ('operator','planner','supervisor','maintenance_manager','reliability_engineer','admin','ai_admin') then return jsonb_build_object('error','a named same-tenant operating role is required'); end if;
 if v_asset is null and v_site is null then return jsonb_build_object('error','select a canonical site or asset'); end if;
 if v_asset is not null and not exists(select 1 from assets where id=v_asset and organization_id=v_org) then return jsonb_build_object('error','asset not found in this organization'); end if;
 if v_site is not null and not exists(select 1 from sites where id=v_site and organization_id=v_org) then return jsonb_build_object('error','site not found in this organization'); end if;
 if v_event is not null and not exists(select 1 from restoration_events e where e.id=v_event and e.organization_id=v_org and (v_asset is null or e.asset_id=v_asset) and (v_site is null or e.site_id is not distinct from v_site)) then return jsonb_build_object('error','canonical restoration event does not match this command scope'); end if;
 insert into recovery_operating_commands(organization_id,site_id,asset_id,restoration_event_id,command_ref,created_by) values(v_org,v_site,v_asset,v_event,btrim(p_command->>'command_ref'),auth.uid()) returning id into v_id;
 insert into audit_events(organization_id,entity_type,actor,event_data) values(v_org,'recovery_operating_command',v_role,jsonb_build_object('command_id',v_id,'action','created','mode','normal'));
 return jsonb_build_object('command_id',v_id,'current_mode','normal'); exception when others then return jsonb_build_object('error',sqlerrm); end $$;

create function public.request_recovery_operating_mode(p_command_id uuid,p_to_mode text,p_basis text,p_evidence_item_ids uuid[] default '{}',p_missing_evidence text[] default '{}') returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); c recovery_operating_commands%rowtype; v_id uuid;
begin
 if v_org is null or coalesce(v_role,'') not in ('operator','planner','supervisor','maintenance_manager','reliability_engineer','admin','ai_admin') then return jsonb_build_object('error','mode request authority denied'); end if;
 select * into c from recovery_operating_commands where id=p_command_id and organization_id=v_org for update; if not found then return jsonb_build_object('error','operating command not found'); end if;
 if p_to_mode not in ('normal','elevated_risk','emergency_response','business_continuity','damage_assessment','restoration','recovery','post_event_learning') then return jsonb_build_object('error','invalid operating mode'); end if;
 if coalesce(length(btrim(p_basis)),0)<20 then return jsonb_build_object('error','record a substantive transition basis'); end if;
 if not ((c.current_mode='normal' and p_to_mode in ('elevated_risk','emergency_response','business_continuity')) or (c.current_mode='elevated_risk' and p_to_mode in ('normal','emergency_response','business_continuity','damage_assessment')) or (c.current_mode='emergency_response' and p_to_mode in ('business_continuity','damage_assessment')) or (c.current_mode='business_continuity' and p_to_mode in ('emergency_response','damage_assessment','restoration')) or (c.current_mode='damage_assessment' and p_to_mode in ('emergency_response','business_continuity','restoration')) or (c.current_mode='restoration' and p_to_mode in ('emergency_response','damage_assessment','recovery')) or (c.current_mode='recovery' and p_to_mode in ('emergency_response','restoration','post_event_learning')) or (c.current_mode='post_event_learning' and p_to_mode in ('normal','elevated_risk'))) then return jsonb_build_object('error',format('transition from %s to %s is not permitted',c.current_mode,p_to_mode)); end if;
 if p_to_mode in ('emergency_response','business_continuity','damage_assessment','restoration','recovery','post_event_learning') and c.restoration_event_id is null then return jsonb_build_object('error','this mode requires a canonical restoration event'); end if;
 insert into recovery_operating_mode_transitions(organization_id,command_id,from_mode,to_mode,basis,evidence_item_ids,missing_evidence,requested_by,requested_role) values(v_org,c.id,c.current_mode,p_to_mode,btrim(p_basis),coalesce(p_evidence_item_ids,'{}'),coalesce(p_missing_evidence,'{}'),auth.uid(),v_role) returning id into v_id;
 insert into audit_events(organization_id,entity_type,actor,event_data) values(v_org,'recovery_operating_mode',v_role,jsonb_build_object('transition_id',v_id,'command_id',c.id,'action','requested','from_mode',c.current_mode,'to_mode',p_to_mode));
 return jsonb_build_object('transition_id',v_id,'status','pending','from_mode',c.current_mode,'to_mode',p_to_mode,'authority_boundary','Request only: no emergency declaration, dispatch, isolation, work release or return-to-service action occurred.');
exception when unique_violation then return jsonb_build_object('error','resolve the existing pending transition first'); when others then return jsonb_build_object('error',sqlerrm); end $$;

create function public.review_recovery_operating_mode(p_transition_id uuid,p_decision text,p_note text) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.app_current_org(); v_role text:=public.app_current_role(); t recovery_operating_mode_transitions%rowtype; c recovery_operating_commands%rowtype;
begin
 if v_org is null or coalesce(v_role,'') not in ('supervisor','maintenance_manager','reliability_engineer','executive','admin') then return jsonb_build_object('error','independent operating authority is required'); end if;
 if p_decision not in ('authorize','reject') then return jsonb_build_object('error','decision must be authorize or reject'); end if;
 if coalesce(length(btrim(p_note)),0)<20 then return jsonb_build_object('error','record a substantive independent review note'); end if;
 select * into t from recovery_operating_mode_transitions where id=p_transition_id and organization_id=v_org and status='pending' for update; if not found then return jsonb_build_object('error','pending transition not found'); end if;
 if t.requested_by=auth.uid() then return jsonb_build_object('error','the requester cannot authorize their own operating-mode transition'); end if;
 select * into c from recovery_operating_commands where id=t.command_id and organization_id=v_org for update; if c.current_mode<>t.from_mode then return jsonb_build_object('error','command mode changed; submit a new transition request'); end if;
 if p_decision='authorize' then
  if cardinality(t.evidence_item_ids)=0 then return jsonb_build_object('error','authorization requires verified canonical evidence'); end if;
  if exists(select 1 from unnest(t.evidence_item_ids) x(id) left join evidence_items e on e.id=x.id and e.organization_id=v_org where e.id is null or e.verification_status<>'verified') then return jsonb_build_object('error','all cited canonical evidence must be independently verified'); end if;
  if t.to_mode='post_event_learning' and not exists(select 1 from restoration_events e where e.id=c.restoration_event_id and e.organization_id=v_org and e.status='closed') then return jsonb_build_object('error','post-event learning requires the canonical restoration event to be closed'); end if;
 end if;
 perform set_config('app.recovery_mode_authorized','granted',true);
 update recovery_operating_mode_transitions set status=case when p_decision='authorize' then 'authorized' else 'rejected' end,reviewed_by=auth.uid(),reviewed_role=v_role,reviewed_at=now(),review_note=btrim(p_note) where id=t.id;
 if p_decision='authorize' then update recovery_operating_commands set current_mode=t.to_mode,mode_started_at=now(),updated_at=now() where id=c.id; end if;
 insert into audit_events(organization_id,entity_type,actor,event_data) values(v_org,'recovery_operating_mode_review',v_role,jsonb_build_object('transition_id',t.id,'command_id',c.id,'action',p_decision,'from_mode',t.from_mode,'to_mode',t.to_mode,'boundary','Mode authorization records accountable command state only; canonical approvals, plans, work, permits, isolations and return-to-service controls remain unchanged.'));
 return jsonb_build_object('transition_id',t.id,'status',case when p_decision='authorize' then 'authorized' else 'rejected' end,'current_mode',case when p_decision='authorize' then t.to_mode else c.current_mode end); end $$;

create function public.get_recovery_operating_command_workspace() returns jsonb language sql stable security definer set search_path=public as $$ select case when public.app_current_org() is null then jsonb_build_object('error','forbidden') else jsonb_build_object(
 'modes',jsonb_build_array('normal','elevated_risk','emergency_response','business_continuity','damage_assessment','restoration','recovery','post_event_learning'),
 'commands',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('asset_name',a.name,'site_name',s.name,'event_code',e.event_code,'transitions',coalesce((select jsonb_agg(to_jsonb(t) order by t.requested_at desc) from recovery_operating_mode_transitions t where t.command_id=c.id),'[]'::jsonb)) order by c.updated_at desc) from recovery_operating_commands c left join assets a on a.id=c.asset_id left join sites s on s.id=c.site_id left join restoration_events e on e.id=c.restoration_event_id where c.organization_id=public.app_current_org()),'[]'::jsonb),
 'authority_boundary','Human-authorized command state only. SyncAI does not automatically declare emergencies, dispatch people, isolate assets, release work or approve return to service.') end $$;
revoke all on function public.create_recovery_operating_command(jsonb), public.request_recovery_operating_mode(uuid,text,text,uuid[],text[]), public.review_recovery_operating_mode(uuid,text,text), public.get_recovery_operating_command_workspace() from public,anon;
grant execute on function public.create_recovery_operating_command(jsonb), public.request_recovery_operating_mode(uuid,text,text,uuid[],text[]), public.review_recovery_operating_mode(uuid,text,text), public.get_recovery_operating_command_workspace() to authenticated,service_role;
comment on table public.recovery_operating_commands is 'U16.01 command-state overlay on canonical Sync Recovery events; never a parallel incident or work authority.';
