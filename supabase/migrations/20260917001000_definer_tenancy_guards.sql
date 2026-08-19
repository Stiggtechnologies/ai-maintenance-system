-- ============================================================================
-- Tenancy isolation, part 2 — the SECURITY DEFINER functions that walk around
-- the policies.
--
-- 20260917000000_tenancy_isolation.sql closed the table-level hole. Row-level
-- security is only half a boundary: a SECURITY DEFINER function runs as its
-- owner and RLS never applies to it, so every such function reachable by
-- `authenticated` is its own access-control surface and has to carry its own
-- org check. Three of them do not, and the tenancy review found them by
-- attacking the fixed database rather than by reading the diff.
--
-- The shared idiom, used identically in all three places:
--
--     case when auth.uid() is not null then app_current_org() else <param> end
--
-- A signed-in caller always gets their own organization, whatever they ask
-- for. An organization parameter is honoured only when there is NO SESSION AT
-- ALL, which means the service role. Crucially the gate is `auth.uid()`, not
-- `app_current_org()` — see part 2 below for why that distinction is the whole
-- bug in the KB functions.
--
-- ---------------------------------------------------------------------------
-- 1. get_pm_due_count — a caller-supplied organization, unchecked.
--
-- 20260903090000_maintenance_plans_dispatch_urgency.sql:106 declares it
-- `security definer`, filters maintenance_plans by the p_org ARGUMENT, and
-- :139 grants execute to `authenticated`. Nothing compares p_org to the
-- caller. Measured on a throwaway Postgres as a second tenant, after the
-- part-1 fix was in place:
--
--     select count(*) from maintenance_plans          -- org A's rows:  0   (RLS holds)
--     select * from get_pm_due_count('<org A>', …)    -- 5 due, 3 calendar, 1 usage
--
-- so the policy is correct and the function reports straight past it. The
-- attacker needs the victim's organization UUID, and after part 1 no table
-- exposes one, which is why this was rated major rather than critical — but
-- "you also need a UUID" is not an access control.
--
-- The only in-tree caller is get_work_management_health at :228, which passes
-- a v_org it derived from app_current_org() at :164 and returns early when
-- that is null. Under the new expression it re-derives the identical value, so
-- that path is unchanged.
--
-- 2. retrieve_kb_context / explain_kb_exclusions — gated on the wrong thing.
--
-- 20260825143000_kb_service_role_scope.sql:29,74. Its header states the org
-- parameter "is reachable only by a caller that already holds the service
-- key". That is false. It gates on `coalesce(app_current_org(), p_organization_id)`,
-- so the parameter is honoured whenever app_current_org() is NULL — and
-- app_current_org() reads user_profiles for auth.uid(), so it is null for any
-- signed-in user who has no profile row, not only for the service role.
--
-- There is no trigger on auth.users anywhere in the chain, so a user is
-- profile-less from sign-up until something provisions them. Measured: a user
-- holding a real auth.users row and no user_profiles row read org A's private
-- chunk FIXTURE-BROCHURE-0001 by passing org A's id; the org-B user, who has a
-- profile, correctly got nothing. The gap between "has no session" and "has no
-- profile" is the entire vulnerability, and `auth.uid() is null` is the test
-- the comment always meant.
--
-- Behaviour is otherwise identical: with a session the caller's own org wins;
-- with the service role the parameter is honoured; the shared corpus
-- (organization_id is null) stays readable to everyone, which is the point of
-- the table.
--
-- 3. provision_deployment — `<>` is not a null-safe comparison.
--
-- 00000000000015_autonomous_deployment.sql:45 guards with
-- `inst.organization_id <> app_current_org()`. When the instance's
-- organization_id is NULL that expression is NULL, the IF does not fire, and
-- the function provisions sites, assets and sensors into a null organization
-- for any caller. Part 1 removed the only way an authenticated user could
-- create such a row, so the exploit path is already shut; the guard is still
-- wrong for any service-role path that creates one.
--
-- Fixed from both ends, because either alone leaves a residue:
--   * the comparison becomes `is distinct from`, which is false only when the
--     two are genuinely equal;
--   * deployment_instances.organization_id gets a NOT NULL check, so no role
--     can create the row the guard mishandles.
--
-- The check is added NOT VALID deliberately. This chain is applied to
-- databases that already exist, and a plain NOT NULL would abort the
-- deployment if any historical row carried a null. NOT VALID constrains every
-- future insert and update while ignoring rows already present, then the
-- constraint is validated in the same transaction if — and only if — the table
-- is measurably clean. A deployment cannot fail because of data it inherited.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. get_pm_due_count
--
--    Re-declared verbatim from 20260903090000:106 apart from the WHERE clause,
--    which is the only line that changes. Signature and return type are
--    unchanged, so `create or replace` suffices and the grant survives.
-- ---------------------------------------------------------------------------
create or replace function get_pm_due_count(
  p_org uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (due_count bigint, calendar_plans bigint, usage_plans bigint)
language sql stable security definer set search_path = public as $$
  with plans as (
    select * from maintenance_plans
     where organization_id =
             -- A signed-in caller cannot ask for another tenant. p_org is
             -- honoured only when there is no session at all.
             case when auth.uid() is not null then app_current_org() else p_org end
       and active
  ),
  calendar as (
    -- Interval boundaries crossed inside the window. The plan is a repeating
    -- schedule, so it is projected in BOTH directions from the last completion:
    -- a 30-day route generates about three occurrences per 90 days whatever
    -- date you ask on. Clamping the earlier term to zero instead — counting
    -- only forward from the last completion — makes every recently performed
    -- plan contribute nothing, so the denominator collapses to whatever is
    -- overdue and compliance looks best on the assets being neglected.
    select (
      floor(extract(epoch from (p_to - coalesce(last_performed_at, p_from)))
            / nullif(interval_value * 86400, 0))
      - floor(extract(epoch from (p_from - coalesce(last_performed_at, p_from)))
              / nullif(interval_value * 86400, 0))
    )::bigint as occurrences
    from plans where interval_basis = 'calendar_days'
  )
  select
    coalesce((select sum(occurrences) from calendar), 0)::bigint,
    (select count(*) from plans where interval_basis = 'calendar_days')::bigint,
    (select count(*) from plans where interval_basis = 'run_hours')::bigint;
$$;

-- ---------------------------------------------------------------------------
-- 2. The knowledge-base retrieval pair.
--
--    Re-declared from 20260825143000:29,74 with one changed line each: the
--    v_org initialiser. Everything else — the claim-type gate, the tsquery
--    guard, the ordering, the limit clamp — is unchanged.
-- ---------------------------------------------------------------------------
create or replace function retrieve_kb_context(
  p_query text,
  p_claim_type text,
  p_limit int default 4,
  -- Honoured ONLY when there is no session — see the header.
  p_organization_id uuid default null
)
returns table (
  chunk_id text, title text, page_start int, page_end int, content text,
  "documentClass" text, "trustRank" int, redistributable boolean,
  "isClientPrivate" boolean, rank real
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q tsquery;
  -- Gate on the SESSION, not on the profile. app_current_org() is also null
  -- for a signed-in user who has no user_profiles row, and there is no trigger
  -- on auth.users to create one — so gating on it let a freshly signed-up
  -- account pass any organization id it liked.
  v_org uuid := case when auth.uid() is not null then app_current_org() else p_organization_id end;
begin
  if p_claim_type is null or not (p_claim_type = any (kb_claim_types())) then
    return;
  end if;
  v_q := websearch_to_tsquery('english', coalesce(p_query, ''));
  if v_q is null or v_q::text = '' then return; end if;

  return query
  select c.chunk_id, c.title, c.page_start, c.page_end, c.content,
         c.document_class, d.trust_rank, d.redistributable,
         c.organization_id is not null,
         ts_rank(to_tsvector('english', c.content), v_q)
  from reliability_kb_chunks c
  join kb_document_classes d on d.class_key = c.document_class
  where p_claim_type = any (d.permitted_claims)
    and (c.organization_id is null
         or (v_org is not null and c.organization_id = v_org))
    and to_tsvector('english', c.content) @@ v_q
  order by ts_rank(to_tsvector('english', c.content), v_q) desc,
           d.trust_rank desc, c.chunk_index
  limit greatest(1, least(coalesce(p_limit, 4), 20));
end;
$$;

create or replace function explain_kb_exclusions(
  p_query text, p_claim_type text, p_organization_id uuid default null
)
returns table (
  "documentClass" text, label text, "chunksMatchedButExcluded" bigint, rationale text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_q tsquery;
  v_org uuid := case when auth.uid() is not null then app_current_org() else p_organization_id end;
begin
  v_q := websearch_to_tsquery('english', coalesce(p_query, ''));
  if v_q is null or v_q::text = '' then return; end if;

  return query
  select d.class_key, d.label, count(c.id), d.rationale
  from kb_document_classes d
  join reliability_kb_chunks c on c.document_class = d.class_key
  where not (p_claim_type = any (d.permitted_claims))
    and (c.organization_id is null
         or (v_org is not null and c.organization_id = v_org))
    and to_tsvector('english', c.content) @@ v_q
  group by d.class_key, d.label, d.rationale
  having count(c.id) > 0
  order by count(c.id) desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3a. deployment_instances.organization_id must exist.
--
--     NOT VALID so the statement cannot fail on inherited data, then validated
--     only when the table is measurably clean. Both steps are guarded so the
--     chain still applies any number of times.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.deployment_instances'::regclass
       and conname = 'deployment_instances_organization_id_present'
  ) then
    execute 'alter table public.deployment_instances
             add constraint deployment_instances_organization_id_present
             check (organization_id is not null) not valid';
  end if;

  if not exists (
    select 1 from public.deployment_instances where organization_id is null
  ) then
    execute 'alter table public.deployment_instances
             validate constraint deployment_instances_organization_id_present';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3b. provision_deployment's authorization guard.
--
--     The function is 160 lines of asset-seeding arithmetic and exactly one of
--     them is wrong. Re-declaring the whole body here would duplicate it into
--     a second place that must then be kept in step with the first, and the
--     transcription is itself the risk. So the definition is read back from
--     the catalog and the single comparison is rewritten in place.
--
--     Idempotent and self-disarming: the replacement only runs when the exact
--     defective text is present, so a second apply is a no-op, and if the
--     function is ever legitimately rewritten this block silently stops
--     touching it instead of clobbering the new version.
-- ---------------------------------------------------------------------------
do $$
declare
  v_src  text;
  v_bad  constant text := 'inst.organization_id <> app_current_org()';
  v_good constant text := 'inst.organization_id is distinct from app_current_org()';
begin
  select pg_get_functiondef(p.oid) into v_src
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'provision_deployment'
     and pg_get_function_identity_arguments(p.oid) = 'p_instance_id uuid';

  if v_src is null then
    raise notice 'provision_deployment(uuid) not present — nothing to harden';
    return;
  end if;

  if position(v_bad in v_src) = 0 then
    return;  -- already fixed, or the body has moved on. Leave it alone.
  end if;

  execute replace(v_src, v_bad, v_good);
end $$;

notify pgrst, 'reload schema';
