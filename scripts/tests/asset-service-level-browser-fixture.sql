-- Disposable local browser database ONLY. No customer facts, approved source,
-- normative limit, restoration priority or operational authority are asserted.
-- Seed scaffolding only: evidence capture/verification and service decisions
-- are exercised by authenticated HTTP in the browser suite.
begin;
do $fixture$
begin
  if coalesce(current_setting('app.ci_u208_browser_fixture',true),'') <> 'disposable_local_only' then
    raise exception 'U2 browser fixture requires the explicit disposable-local marker';
  end if;
  if not exists(select 1 from public.organizations
    where id='11111111-1111-1111-1111-111111111111'
      and name='Fort McMurray Oil Sands Demo') then
    raise exception 'U2 browser fixture requires the disposable demo organization';
  end if;
  if exists(select 1 from public.assets where id::text like '9208b000-%')
    or exists(select 1 from public.evidence_items where id::text like '9208b000-%')
    or exists(select 1 from public.risks where id::text like '9208b000-%') then
    raise exception 'U2 browser fixture already consumed; use a fresh disposable database';
  end if;
end
$fixture$;
insert into public.organizations(id,name,industry,org_level)
values('9208b000-0000-4000-8000-000000000099','U2 browser synthetic foreign organization','utilities','enterprise');
insert into public.assets(id,organization_id,name,tag) values
 ('9208b000-0000-4000-8000-000000000001','11111111-1111-1111-1111-111111111111','U2 browser synthetic water pump','U208-BROWSER-PW-1'),
 ('9208b000-0000-4000-8000-000000000002','11111111-1111-1111-1111-111111111111','U2 browser synthetic backup pump','U208-BROWSER-PW-2'),
 ('9208b000-0000-4000-8000-000000000003','9208b000-0000-4000-8000-000000000099','U2 browser synthetic foreign pump','U208-BROWSER-FOREIGN');
insert into public.risks(id,organization_id,title,information_sensitivity)
values('9208b000-0000-4000-8000-000000000021','11111111-1111-1111-1111-111111111111','Synthetic U2 browser visibility fixture; not an operational risk assertion','public');
commit;
