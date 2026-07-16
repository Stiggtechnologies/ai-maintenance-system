-- ============================================================================
-- Security event audit log (SOC 2 CC7.2 / ISO 27001 A.8.15-8.16).
--
-- A tamper-resistant, org-scoped record of security-relevant events —
-- sign-ins, MFA enrollment, role changes, admin actions, access denials —
-- separate from the operational decision/learning logs. Readable only by
-- admins; writable only through a security-definer RPC (never directly by
-- clients), so the log cannot be forged or edited from the app.
-- ============================================================================

create table if not exists security_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  actor_id uuid,               -- auth.users id, when known
  actor_label text,            -- email / name snapshot
  event_type text not null,    -- sign_in | sign_out | mfa_enrolled | mfa_removed
                               -- | role_changed | admin_action | access_denied | deployment | other
  severity text not null default 'info' check (severity in ('info','notice','warning','critical')),
  detail text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_security_events_org on security_events(organization_id, created_at desc);
create index if not exists idx_security_events_type on security_events(event_type, created_at desc);

alter table security_events enable row level security;

-- Admins (and ai_admin) may read their organization's security log; nobody
-- can write, update, or delete through the API.
drop policy if exists security_events_admin_read on security_events;
create policy security_events_admin_read on security_events
  for select to authenticated
  using (
    organization_id = app_current_org()
    and exists (
      select 1 from user_profiles p
      where p.id = auth.uid() and p.role in ('admin', 'ai_admin')
    )
  );

-- ----------------------------------------------------------------------------
-- Recorder — the only write path. Stamps the caller automatically.
-- ----------------------------------------------------------------------------
create or replace function public.record_security_event(
  p_event_type text,
  p_detail text default null,
  p_severity text default 'info',
  p_ip text default null,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_label text;
begin
  select coalesce(p.full_name, u.email) into v_label
  from auth.users u left join user_profiles p on p.id = u.id
  where u.id = auth.uid();

  insert into security_events (organization_id, actor_id, actor_label, event_type,
    severity, detail, ip, user_agent)
  values (v_org, auth.uid(), v_label, p_event_type,
    case when p_severity in ('info','notice','warning','critical') then p_severity else 'info' end,
    left(p_detail, 2000), p_ip, left(p_user_agent, 400));
end
$$;

grant execute on function public.record_security_event(text, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Server-side capture of role changes — the highest-value audit event, and
-- one an app-layer call could miss. Trigger records every privilege change.
-- ----------------------------------------------------------------------------
create or replace function public.on_role_change_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role then
    insert into security_events (organization_id, actor_id, actor_label, event_type,
      severity, detail)
    values (new.organization_id, auth.uid(),
      (select coalesce(p.full_name, u.email) from auth.users u
         left join user_profiles p on p.id = u.id where u.id = auth.uid()),
      'role_changed',
      case when new.role in ('admin','ai_admin') then 'warning' else 'notice' end,
      'Role for ' || coalesce(new.email, new.id::text) || ' changed from '
        || coalesce(old.role, 'none') || ' to ' || coalesce(new.role, 'none'));
  end if;
  return new;
end
$$;

drop trigger if exists trg_role_change_audit on user_profiles;
create trigger trg_role_change_audit
  after update of role on user_profiles
  for each row execute function public.on_role_change_audit();

-- ----------------------------------------------------------------------------
-- Admin reader RPC (bounded, newest first).
-- ----------------------------------------------------------------------------
create or replace function public.get_security_events(p_limit int default 200)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_role text;
begin
  select role into v_role from user_profiles where id = auth.uid();
  if v_role not in ('admin', 'ai_admin') then
    return jsonb_build_object('error', 'forbidden');
  end if;

  return jsonb_build_object('events', coalesce((
    select jsonb_agg(row_to_json(e))
    from (
      select id, actor_label, event_type, severity, detail, created_at
      from security_events
      where organization_id = app_current_org()
      order by created_at desc
      limit least(greatest(p_limit, 1), 500)
    ) e
  ), '[]'::jsonb));
end
$$;

grant execute on function public.get_security_events(int) to authenticated;
