-- RIA activation directory control-flow correction.
--
-- RETURN QUERY appends rows in PL/pgSQL but does not terminate the function.
-- The original governed-write migration therefore fell through to the final
-- authority exception even after an authorized ai_admin/admin branch returned
-- its permitted organization rows. Preserve the same authority model and make
-- successful branches explicit terminal returns.

create or replace function public.list_ria_activation_organizations()
returns table(id uuid, name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_current_org uuid := public.app_current_org();
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = 'insufficient_privilege';
  end if;

  select p.role into v_role
  from public.user_profiles p
  where p.id = auth.uid();

  if v_role = 'ai_admin' then
    return query
      select o.id, o.name
      from public.organizations o
      order by o.name;
    return;
  elsif v_role = 'admin' and v_current_org is not null then
    return query
      select o.id, o.name
      from public.organizations o
      where o.id = v_current_org
      order by o.name;
    return;
  end if;

  raise exception 'RIA activation organization directory requires administrator authority'
    using errcode = 'insufficient_privilege';
end;
$$;

revoke all on function public.list_ria_activation_organizations() from public, anon;
grant execute on function public.list_ria_activation_organizations() to authenticated;
