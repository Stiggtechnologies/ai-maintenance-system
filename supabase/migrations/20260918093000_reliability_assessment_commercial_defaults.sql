-- Retire the old "48-hour value proof" commercial defaults without rewriting
-- historical migrations or existing lead records. New callers that omit these
-- optional fields now inherit the canonical Reliability Intelligence Assessment
-- framing. Explicit values supplied by a caller continue to win.

alter table public.pilot_intake_requests
  alter column commercial_model
  set default 'Reliability Intelligence Assessment - Standard - US$35,000';

alter table public.pilot_onboarding_packages
  alter column commercial_model
  set default 'Reliability Intelligence Assessment - Standard - US$35,000';

create or replace function public.submit_pilot_intake_request(request jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_id uuid;
  clean_email text := lower(trim(request->>'email'));
begin
  if length(trim(coalesce(request->>'name', ''))) < 2 then
    raise exception 'Name is required';
  end if;

  if clean_email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
    raise exception 'Valid work email is required';
  end if;

  if length(trim(coalesce(request->>'company', ''))) < 2 then
    raise exception 'Company is required';
  end if;

  if length(trim(coalesce(request->>'asset_scope', ''))) < 2 then
    raise exception 'Asset or system scope is required';
  end if;

  if length(trim(coalesce(request->>'primary_pain', ''))) < 2 then
    raise exception 'Primary reliability pain is required';
  end if;

  insert into public.pilot_intake_requests (
    name,
    email,
    company,
    role,
    industry,
    asset_scope,
    system_of_record,
    history_available,
    primary_pain,
    data_readiness,
    security_need,
    commercial_model,
    notes,
    notification_status,
    source_path
  )
  values (
    left(trim(request->>'name'), 160),
    left(clean_email, 254),
    left(trim(request->>'company'), 180),
    left(trim(coalesce(request->>'role', '')), 120),
    left(trim(coalesce(request->>'industry', '')), 120),
    left(trim(request->>'asset_scope'), 240),
    left(trim(coalesce(request->>'system_of_record', '')), 140),
    left(trim(coalesce(request->>'history_available', '')), 180),
    left(trim(request->>'primary_pain'), 240),
    left(trim(coalesce(request->>'data_readiness', 'To be confirmed during assessment scoping')), 160),
    left(trim(coalesce(request->>'security_need', 'Governed data-transfer method to be agreed after scope confirmation')), 160),
    left(trim(coalesce(request->>'commercial_model', 'Reliability Intelligence Assessment - Standard - US$35,000')), 160),
    left(trim(coalesce(request->>'notes', '')), 3000),
    'queued',
    left(trim(coalesce(request->>'source_path', '/pilot/reliability')), 240)
  )
  returning id into request_id;

  return request_id;
end;
$$;

create or replace function public.create_pilot_onboarding_package(request jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  package_id uuid;
  maybe_intake_id uuid;
begin
  if nullif(request->>'intake_request_id', '') is not null then
    maybe_intake_id := (request->>'intake_request_id')::uuid;
  end if;

  if length(trim(coalesce(request->>'company', ''))) < 2 then
    raise exception 'Company is required';
  end if;

  if length(trim(coalesce(request->>'asset_scope', ''))) < 2 then
    raise exception 'Asset or system scope is required';
  end if;

  insert into public.pilot_onboarding_packages (
    intake_request_id,
    company,
    asset_scope,
    system_of_record,
    primary_pain,
    data_readiness,
    security_need,
    commercial_model,
    package_items,
    status,
    source_path
  )
  values (
    maybe_intake_id,
    left(trim(request->>'company'), 180),
    left(trim(request->>'asset_scope'), 240),
    left(trim(coalesce(request->>'system_of_record', '')), 140),
    left(trim(coalesce(request->>'primary_pain', '')), 240),
    left(trim(coalesce(request->>'data_readiness', 'To be confirmed during assessment scoping')), 160),
    left(trim(coalesce(request->>'security_need', 'Governed data-transfer method to be agreed after scope confirmation')), 160),
    left(trim(coalesce(request->>'commercial_model', 'Reliability Intelligence Assessment - Standard - US$35,000')), 160),
    array[
      'workspace_shell',
      'data_request_checklist',
      'role_invites',
      'governance_gates',
      'first_analysis_queue',
      'commercial_path'
    ],
    'generated',
    left(trim(coalesce(request->>'source_path', '/pilot/reliability')), 240)
  )
  returning id into package_id;

  return package_id;
end;
$$;

revoke all on function public.submit_pilot_intake_request(jsonb) from public;
revoke all on function public.create_pilot_onboarding_package(jsonb) from public;
grant execute on function public.submit_pilot_intake_request(jsonb) to anon, authenticated;
grant execute on function public.create_pilot_onboarding_package(jsonb) to anon, authenticated;
