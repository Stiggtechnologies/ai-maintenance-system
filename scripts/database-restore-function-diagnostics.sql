-- Diagnostic-only read. Raw identities, catalog tuples, definitions and session
-- settings stay in exclusive private artifacts, never public Actions output.
select jsonb_build_object('privateFunctionDiagnostics', jsonb_build_object(
  'schemaVersion', 1,
  -- Fixed synthetic engine witness, never a source identity or body.
  'oidJsonRepresentationQualified', jsonb_typeof(to_jsonb(1234::oid))='string'
    and (to_jsonb(1234::oid)#>>'{}')='1234',
  'environment', jsonb_build_object(
    'search_path', current_setting('search_path'),
    'quote_all_identifiers', current_setting('quote_all_identifiers'),
    'standard_conforming_strings', current_setting('standard_conforming_strings'),
    'DateStyle', current_setting('DateStyle'),
    'IntervalStyle', current_setting('IntervalStyle'),
    'TimeZone', current_setting('TimeZone'),
    'extra_float_digits', current_setting('extra_float_digits'),
    'client_encoding', current_setting('client_encoding'),
    'server_version_num', current_setting('server_version_num')),
  'functions', coalesce((select jsonb_agg(jsonb_build_object(
    'identity', case when p.oid=to_regprocedure('graphql_public.graphql(text,text,jsonb,jsonb)')
      then 'graphql_public.graphql(text,text,jsonb,jsonb)'
      else n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' end,
    'oid', p.oid::text, 'tupleVersion', p.xmin::text,
    'catalog', to_jsonb(p), 'definition', pg_get_functiondef(p.oid))
    order by n.nspname,p.proname,p.oid)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.prokind in ('f','p') and (
      (n.nspname in ('public','auth','storage') and not exists(
        select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e'))
      or (p.oid=to_regprocedure('graphql_public.graphql(text,text,jsonb,jsonb)') and exists(
        select 1 from pg_depend d join pg_extension e on e.oid=d.refobjid
        where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e' and e.extname='pg_graphql'))
    )), '[]'::jsonb)
));
