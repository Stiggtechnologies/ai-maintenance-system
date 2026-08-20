-- Isolated self-signup provisioning.
-- Enterprise/invited identities are deliberately untouched: the trigger only
-- acts when the application stamps raw_user_meta_data.self_signup = 'true'.

create or replace function public.provision_self_signup_evaluation_workspace()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_org_id uuid;
  v_company text := nullif(trim(coalesce(new.raw_user_meta_data->>'company', '')), '');
  v_industry text := nullif(trim(coalesce(new.raw_user_meta_data->>'industry', '')), '');
  v_requested_role text := lower(trim(coalesce(new.raw_user_meta_data->>'requested_role', 'reliability')));
  v_role text;
begin
  if lower(coalesce(new.raw_user_meta_data->>'self_signup', 'false')) <> 'true' then
    return new;
  end if;

  if exists (select 1 from public.user_profiles where id = new.id) then
    return new;
  end if;

  v_role := case v_requested_role
    when 'reliability' then 'reliability_engineer'
    when 'maintenance' then 'planner'
    when 'operations' then 'operator'
    when 'vp' then 'executive'
    when 'executive' then 'executive'
    else 'reliability_engineer'
  end;

  insert into public.organizations (name, industry)
  values (coalesce(v_company, 'SyncAI evaluation workspace'), coalesce(v_industry, 'industrial'))
  returning id into v_org_id;

  insert into public.user_profiles (id, organization_id, email, full_name, role)
  values (
    new.id,
    v_org_id,
    new.email,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)),
    v_role
  )
  on conflict (id) do nothing;

  return new;
exception
  when others then
    -- Do not block identity creation if provisioning fails. A profile-less user
    -- has no tenant access under the active RLS/SECURITY DEFINER guards.
    raise warning 'self-signup evaluation provisioning failed for %: %', new.id, sqlerrm;
    return new;
end;
$$;

revoke all on function public.provision_self_signup_evaluation_workspace() from public;

drop trigger if exists on_syncai_self_signup_created on auth.users;
create trigger on_syncai_self_signup_created
after insert on auth.users
for each row execute function public.provision_self_signup_evaluation_workspace();
