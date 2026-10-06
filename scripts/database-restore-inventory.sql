-- Read-only qualification inventory. Never emit row payloads or role passwords.
set timezone = 'UTC';
set extra_float_digits = 3;
set search_path = pg_catalog;
set statement_timeout = '5min';

select jsonb_build_object('kind','database','key',datname,'value',
  jsonb_build_array(pg_get_userbyid(datdba),encoding,datcollate,datctype,
    datistemplate,datallowconn,datconnlimit,
    case when datacl is null then null else array(select x::text from unnest(datacl) x order by x::text) end))
from pg_database where datname=current_database();

select jsonb_build_object('kind','database_role_setting','key',
  case when setrole=0 then '*' else pg_get_userbyid(setrole) end,'value',setconfig)
from pg_db_role_setting where setdatabase=(select oid from pg_database where datname=current_database())
order by setrole;

select jsonb_build_object('kind','parameter_acl','key',parname,'value',
  case when paracl is null then null else array(select x::text from unnest(paracl) x order by x::text) end)
from pg_parameter_acl order by parname;

select jsonb_build_object('kind','role','key',rolname,'value',
  jsonb_build_array(rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,
    rolreplication,rolbypassrls,rolconnlimit,rolvaliduntil,rolconfig))
from pg_roles order by rolname;

select jsonb_build_object('kind','membership','key',
  pg_get_userbyid(roleid)||':'||pg_get_userbyid(member),'value',
  jsonb_build_array(pg_get_userbyid(grantor),admin_option,inherit_option,set_option))
from pg_auth_members order by roleid,member;

select jsonb_build_object('kind','default_acl','key',
  pg_get_userbyid(defaclrole)||':'||coalesce(n.nspname,'*')||':'||defaclobjtype::text,'value',
  case when defaclacl is null then null else array(select x::text from unnest(defaclacl) x order by x::text) end)
from pg_default_acl a left join pg_namespace n on n.oid=a.defaclnamespace
order by pg_get_userbyid(defaclrole),n.nspname,defaclobjtype;

select jsonb_build_object('kind','extension','key',extname,'value',
  jsonb_build_array(extversion,n.nspname,pg_get_userbyid(extowner)))
from pg_extension e join pg_namespace n on n.oid=e.extnamespace
where extname <> 'plpgsql' order by extname;

-- Supabase attaches this wrapper to pg_graphql after installation. pg_dump
-- omits member definitions, although its ACL still appears in the archive.
select jsonb_build_object('kind','platform_function','key','graphql_public.graphql(text,text,jsonb,jsonb)','value',
  jsonb_build_object('definition',pg_get_functiondef(p.oid),'owner',pg_get_userbyid(p.proowner),
    'securityDefiner',p.prosecdef,'searchPath',p.proconfig,'extension',e.extname,
    'acl',case when p.proacl is null then null else array(select x::text from unnest(p.proacl) x order by x::text) end))
from pg_proc p join pg_depend d on d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e'
join pg_extension e on e.oid=d.refobjid
where p.oid=to_regprocedure('graphql_public.graphql(text,text,jsonb,jsonb)') and e.extname='pg_graphql';

-- The platform trigger's initial GraphQL schema grants are not reproduced by
-- bare extension installation. Capture their exact grantor/recipient/options.
select jsonb_build_object('kind','platform_schema_acl','key',n.nspname,'value',
  jsonb_build_object('owner',pg_get_userbyid(n.nspowner),'defaultAcl',n.nspacl is null,
    'privileges',coalesce((select jsonb_agg(jsonb_build_object(
      'grantee',case when x.grantee=0 then null else pg_get_userbyid(x.grantee) end,
      'grantor',pg_get_userbyid(x.grantor),'privilege',x.privilege_type,'isGrantable',x.is_grantable)
      order by case when x.grantee=0 then '' else pg_get_userbyid(x.grantee) end,
        pg_get_userbyid(x.grantor),x.privilege_type,x.is_grantable)
      from aclexplode(n.nspacl) x),'[]'::jsonb)))
from pg_namespace n where n.nspname in ('graphql','graphql_public') order by n.nspname;

select jsonb_build_object('kind','schema','key',nspname,'value',
  jsonb_build_array(pg_get_userbyid(nspowner),
    case when nspacl is null then null else array(select x::text from unnest(nspacl) x order by x::text) end))
from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema'
order by nspname;

select jsonb_build_object('kind','relation','key',n.nspname||'.'||c.relname,'value',
  jsonb_build_array(c.relkind,c.relpersistence,pg_get_userbyid(c.relowner),
    c.relrowsecurity,c.relforcerowsecurity,
    case when c.relacl is null then null else array(select x::text from unnest(c.relacl) x order by x::text) end,c.reloptions))
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','auth','storage','supabase_migrations')
  and c.relkind in ('r','p','v','m','S','f') order by n.nspname,c.relname;

select jsonb_build_object('kind','view','key',n.nspname||'.'||c.relname,'value',pg_get_viewdef(c.oid))
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','auth','storage') and c.relkind in ('v','m') order by n.nspname,c.relname;

-- Logical restores retain live-column order, not dropped physical tombstones.
-- Ranking the surviving columns still detects any reordering or lost column.
select jsonb_build_object('kind','column','key',n.nspname||'.'||c.relname||'.'||a.attname,'value',
  jsonb_build_array(row_number() over (partition by a.attrelid order by a.attnum),format_type(a.atttypid,a.atttypmod),a.attnotnull,
    a.attidentity,a.attgenerated,
    case when a.attacl is null then null else array(select x::text from unnest(a.attacl) x order by x::text) end,pg_get_expr(d.adbin,d.adrelid)))
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
  jsonb_build_array(pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,
    case when p.proacl is null then null else array(select x::text from unnest(p.proacl) x order by x::text) end,pg_get_functiondef(p.oid)))
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
