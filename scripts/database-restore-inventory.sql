-- Read-only qualification inventory. Never emit row payloads or role passwords.
set timezone = 'UTC';
set extra_float_digits = 3;
set statement_timeout = '5min';

select jsonb_build_object('kind','role','key',rolname,'value',
  jsonb_build_array(rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,
    rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,rolconfig))
from pg_roles where rolname <> 'syncai_dr_bootstrap' order by rolname;

select jsonb_build_object('kind','membership','key',
  pg_get_userbyid(roleid)||':'||pg_get_userbyid(member),'value',
  jsonb_build_array(pg_get_userbyid(grantor),admin_option,inherit_option,set_option))
from pg_auth_members order by roleid,member;

select jsonb_build_object('kind','extension','key',extname,'value',
  jsonb_build_array(extversion,n.nspname,pg_get_userbyid(extowner)))
from pg_extension e join pg_namespace n on n.oid=e.extnamespace
where extname <> 'plpgsql' order by extname;

select jsonb_build_object('kind','schema','key',nspname,'value',
  jsonb_build_array(pg_get_userbyid(nspowner),nspacl::text))
from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema'
order by nspname;

select jsonb_build_object('kind','relation','key',n.nspname||'.'||c.relname,'value',
  jsonb_build_array(c.relkind,c.relpersistence,pg_get_userbyid(c.relowner),
    c.relrowsecurity,c.relforcerowsecurity,c.relacl::text,c.reloptions))
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','auth','storage','supabase_migrations')
  and c.relkind in ('r','p','v','m','S','f') order by n.nspname,c.relname;

select jsonb_build_object('kind','column','key',n.nspname||'.'||c.relname||'.'||a.attname,'value',
  jsonb_build_array(a.attnum,format_type(a.atttypid,a.atttypmod),a.attnotnull,
    a.attidentity,a.attgenerated,a.attacl::text,pg_get_expr(d.adbin,d.adrelid)))
from pg_attribute a join pg_class c on c.oid=a.attrelid
join pg_namespace n on n.oid=c.relnamespace
left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
where n.nspname in ('public','auth','storage','supabase_migrations')
  and c.relkind in ('r','p','v','m','f') and a.attnum>0 and not a.attisdropped
order by n.nspname,c.relname,a.attnum;

select jsonb_build_object('kind','policy','key',n.nspname||'.'||c.relname||'.'||p.polname,'value',
  jsonb_build_array(p.polcmd,p.polpermissive,
    (select jsonb_agg(case when x=0 then 'public' else pg_get_userbyid(x) end order by case when x=0 then 'public' else pg_get_userbyid(x) end)
      from unnest(p.polroles) x),pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid)))
from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','auth','storage') order by n.nspname,c.relname,p.polname;

select jsonb_build_object('kind','function','key',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')','value',
  jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,p.proacl::text,pg_get_functiondef(p.oid)))
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('public','auth','storage') and p.prokind in ('f','p')
  and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid);

select jsonb_build_object('kind','constraint','key',n.nspname||'.'||c.relname||'.'||k.conname,'value',
  jsonb_build_array(k.convalidated,k.condeferrable,k.condeferred,pg_get_constraintdef(k.oid)))
from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','auth','storage','supabase_migrations') order by n.nspname,c.relname,k.conname;

select jsonb_build_object('kind','trigger','key',n.nspname||'.'||c.relname||'.'||t.tgname,'value',
  jsonb_build_array(t.tgenabled,pg_get_triggerdef(t.oid)))
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','auth','storage') and not t.tgisinternal order by n.nspname,c.relname,t.tgname;

select jsonb_build_object('kind','index','key',schemaname||'.'||indexname,'value',indexdef)
from pg_indexes where schemaname in ('public','auth','storage','supabase_migrations') order by schemaname,indexname;

-- Each ordinary table contributes count + ordered multiset SHA-256, including
-- duplicates and nulls. No sampling, no row contents in the inventory.
-- Partition parents are deliberately not double-counted; leaf tables are read.
select format($query$
  select jsonb_build_object('kind','data','key',%L,'value',jsonb_build_object(
    'count',count(*),'digest',encode(sha256(convert_to(coalesce(string_agg(h,'' order by h),''),'UTF8')),'hex')))
  from (select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h from %I.%I t) rows;
$query$,n.nspname||'.'||c.relname,n.nspname,c.relname)
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','auth','storage','supabase_migrations') and c.relkind='r'
order by n.nspname,c.relname
\gexec
