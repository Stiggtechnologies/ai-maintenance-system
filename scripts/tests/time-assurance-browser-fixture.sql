-- Disposable GitHub Actions E2E database only. Never apply to an app database.
-- These sources do not poll, ingest observations, or represent approved clocks.
-- Existing demo connectors and their disabled ingestion posture stay unchanged.
-- Separate attempt identities retain a failed attempt's committed contract;
-- retry must never reset history or mistake that contract for a fresh capture.
begin;
do $fixture$
begin
  if coalesce(current_setting('app.ci_time_browser_fixture',true),'')<>'github_actions_only' then
    raise exception 'clock browser fixtures require the explicit isolated CI marker';
  end if;
  if not exists(select 1 from public.organizations
    where id='11111111-1111-1111-1111-111111111111'
      and name='Fort McMurray Oil Sands Demo') then
    raise exception 'clock browser fixtures require the disposable demo organization';
  end if;
end
$fixture$;

insert into public.connectors(
  organization_id,connector_key,name,connector_type,system_kind,
  status,enabled,direction,write_enabled,contract_note
) values
  ('11111111-1111-1111-1111-111111111111','e12-browser-enabled-synthetic-attempt-0',
    'E12 browser synthetic enabled source attempt 0','manual_file','file','active',true,
    'read_only',false,'CI-only synthetic source. No external feed, clock observations, engineering approval or operational authority.'),
  ('11111111-1111-1111-1111-111111111111','e12-browser-disabled-synthetic-attempt-0',
    'E12 browser synthetic disabled source attempt 0','manual_file','file','configured',false,
    'read_only',false,'CI-only synthetic source. Disabled ingestion remains refused; no external feed or operational authority.'),
  ('11111111-1111-1111-1111-111111111111','e12-browser-enabled-synthetic-attempt-1',
    'E12 browser synthetic enabled source attempt 1','manual_file','file','active',true,
    'read_only',false,'CI-only synthetic source. No external feed, clock observations, engineering approval or operational authority.'),
  ('11111111-1111-1111-1111-111111111111','e12-browser-disabled-synthetic-attempt-1',
    'E12 browser synthetic disabled source attempt 1','manual_file','file','configured',false,
    'read_only',false,'CI-only synthetic source. Disabled ingestion remains refused; no external feed or operational authority.');
commit;
