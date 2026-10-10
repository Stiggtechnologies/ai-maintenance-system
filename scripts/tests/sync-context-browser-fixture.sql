-- Disposable GitHub Actions E2E database only. Never apply to an app database.
-- Only base identities are seeded here. The browser witness must use the actual
-- authenticated author, independent reviewer and source-rights RPCs. No source
-- classification, feature verification, evidence or operational approval bypass.
begin;
do $fixture$
begin
  if coalesce(current_setting('app.ci_context_browser_fixture',true),'')<>'github_actions_only' then
    raise exception 'Context browser fixtures require the explicit isolated CI marker';
  end if;
  if not exists(select 1 from public.organizations
    where id='11111111-1111-1111-1111-111111111111'
      and name='Fort McMurray Oil Sands Demo') then
    raise exception 'Context browser fixtures require the disposable demo organization';
  end if;
  if not exists(select 1 from public.evidence_items
    where id='98100000-0000-0000-0000-000000000021'
      and organization_id='11111111-1111-1111-1111-111111111111'
      and verification_status='verified' and verified_at is not null) then
    raise exception 'Context browser fixtures require the earlier authenticated geospatial evidence qualification';
  end if;
end
$fixture$;

insert into public.sites(id,organization_id,name,code) values
  ('ee020000-0000-4000-8000-000000000201','11111111-1111-1111-1111-111111111111','SC-02 Browser Site A','SC02-A'),
  ('ee020000-0000-4000-8000-000000000202','11111111-1111-1111-1111-111111111111','SC-02 Browser Site B','SC02-B');
insert into public.assets(id,organization_id,site_id,name) values
  ('ee020000-0000-4000-8000-000000000211','11111111-1111-1111-1111-111111111111','ee020000-0000-4000-8000-000000000201','SC-02 Browser Asset A'),
  ('ee020000-0000-4000-8000-000000000212','11111111-1111-1111-1111-111111111111','ee020000-0000-4000-8000-000000000202','SC-02 Browser Asset B');

-- A retry uses a fresh classified source. Revoked rights are never restored or
-- directly overwritten to make a repeated browser run pass.
insert into public.connectors(
  organization_id,connector_key,name,connector_type,status,enabled,
  expected_interval_minutes,direction,write_enabled,contract_note
)
select '11111111-1111-1111-1111-111111111111',
  'sc02-browser-'||surface||'-'||attempt,
  'SC-02 synthetic browser '||surface||' attempt '||attempt,
  'gis','active',true,15,'read_only',false,
  'Disposable synthetic CI source. No customer feed, survey certification, engineering approval or operational authority.'
from (values('desktop'),('mobile')) as surfaces(surface)
cross join generate_series(0,1) as attempts(attempt);
commit;
