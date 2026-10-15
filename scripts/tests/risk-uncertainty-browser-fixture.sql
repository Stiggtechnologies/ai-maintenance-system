-- Disposable GitHub CI only. Newly synthetic rows, never customer calibration.
-- Insert-only per-attempt identities: retry 1 cannot reset retry 0 history.
begin;
do $guard$
begin
  if current_setting('app.ci_u18_browser_fixture',true) is distinct from 'github_actions_only'
    or session_user<>'postgres' or current_user<>'postgres'
    -- Docker reports its private bind/5432, not the pinned host-forwarded port.
    or inet_server_addr() is null
    or not (inet_server_addr()<<inet '127.0.0.0/8'
      or inet_server_addr()<<inet '10.0.0.0/8'
      or inet_server_addr()<<inet '172.16.0.0/12'
      or inet_server_addr()<<inet '192.168.0.0/16')
    or inet_server_port() not in(5432,54322) or current_database()<>'postgres' then
    raise exception 'U18 browser fixture requires isolated CI owner, loopback and explicit marker';
  end if;
  if not exists(select 1 from public.organizations
    where id='11111111-1111-1111-1111-111111111111'
      and name='Fort McMurray Oil Sands Demo') then
    raise exception 'U18 browser fixture requires the disposable seeded stack';
  end if;
end $guard$;
-- Canonical profile privilege pinning must never inherit a prior JWT actor.
select set_config('request.jwt.claims','',true);
select set_config('request.jwt.claim.sub','',true);
create temporary table u18_browser_fixture as
select attempt,gen_random_uuid() as org,gen_random_uuid() as author,
  gen_random_uuid() as reviewer,gen_random_uuid() as adopter,gen_random_uuid() as criteria,
  gen_random_uuid() as risk,gen_random_uuid() as evidence
from generate_series(0,1) attempt;
insert into public.organizations(id,name,industry)
select org,'U18 browser isolated synthetic attempt '||attempt,'utilities'
from u18_browser_fixture;
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,
  email_change,email_change_token_new,email_change_token_current,phone_change,
  phone_change_token,reauthentication_token)
select '00000000-0000-0000-0000-000000000000'::uuid,uid,'authenticated','authenticated',
  'u18-browser-'||actor||'-'||attempt||'@syncai-ci.invalid',
  extensions.crypt('U18BrowserSynthetic123!@#',extensions.gen_salt('bf')),
  now(),now(),now(),'{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"U18 synthetic browser human"}'::jsonb,'','','','','','','',''
from u18_browser_fixture f cross join lateral (values(f.author,'author'),(f.reviewer,'reviewer'),(f.adopter,'adopter')) u(uid,actor);
insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at,last_sign_in_at)
select gen_random_uuid(),uid,uid::text,
  jsonb_build_object('sub',uid,'email','u18-browser-'||actor||'-'||attempt||'@syncai-ci.invalid'),
  'email',now(),now(),now()
from u18_browser_fixture f cross join lateral (values(f.author,'author'),(f.reviewer,'reviewer'),(f.adopter,'adopter')) u(uid,actor);
insert into public.user_profiles(id,organization_id,email,role)
select uid,org,'u18-browser-'||actor||'-'||attempt||'@syncai-ci.invalid',
  case when actor='adopter' then 'admin' else 'reliability_engineer' end
from u18_browser_fixture f cross join lateral (values(f.author,'author'),(f.reviewer,'reviewer'),(f.adopter,'adopter')) u(uid,actor);
insert into public.risk_criteria_profiles(id,organization_id,name,version,status,
  consequence_dimensions,likelihood_scale,thresholds,decision_thresholds,scoring_weights,risk_capacity,basis)
select criteria,org,'U18 browser synthetic thresholds',1,'draft',
  '[{"key":"synthetic_loss","name":"Synthetic loss","weight":1,"scale":[{"score":1,"label":"Synthetic bounded consequence"}]}]',
  '[{"score":1,"label":"Synthetic low"},{"score":5,"label":"Synthetic high"}]',
  '{"low":1,"medium":5,"high":16,"critical":24}',
  '{"accept":1,"monitor":5,"investigate":10,"treat":16,"escalate":24}',
  '{"inherent":1,"exposure":0,"uncertainty":0,"connectivity":0,"velocity":0,"capacity":0}',
  '{"capacity_limit":100,"current_committed_capacity":0}',
  'Explicit synthetic browser fixture; these numbers are not customer engineering policy or approved calibration.'
from u18_browser_fixture;
grant select on u18_browser_fixture to authenticated;
set local role authenticated;
do $adoption$
declare f record; result jsonb;
begin
  for f in select * from u18_browser_fixture loop
    perform set_config('request.jwt.claim.sub',f.adopter::text,true);
    result:=public.adopt_risk_criteria(f.criteria,
      'Named synthetic CI administrator adopts explicitly synthetic test policy; no customer engineering approval.');
    if result is distinct from jsonb_build_object('criteria_id',f.criteria,'status','adopted','version',1) then
      raise exception 'Canonical synthetic criteria adoption failed';
    end if;
  end loop;
end $adoption$;
reset role;
select set_config('request.jwt.claim.sub','',true);
insert into public.risks(id,organization_id,criteria_profile_id,title,status,value_currency,created_by)
select risk,org,criteria,'U18 browser synthetic cooling risk '||attempt,'draft','CAD',author
from u18_browser_fixture;
insert into public.evidence_items(id,organization_id,risk_id,source_system,evidence_type,description,evidence_class,
  verification_status,verified_by,verified_at,verification_method,quality_grade,applicability_grade,revision)
select evidence,org,risk,'CMMS','inspection','U18 browser synthetic exact-risk inspection',
  'INSPECTED','verified',reviewer,now(),'Synthetic browser inspection fixture','high','direct','BROWSER-R1'
from u18_browser_fixture;
do $witness$
begin
  if (select count(*) from public.user_profiles p join u18_browser_fixture f on p.organization_id=f.org
    where p.role='reliability_engineer' and p.id in(f.author,f.reviewer))<>4 then
    raise exception 'U18 browser fixture actual human membership was not persisted';
  end if;
end $witness$;
commit;
