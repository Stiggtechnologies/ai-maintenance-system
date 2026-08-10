-- ============================================================================
-- Recompute after withdrawal, and industry-standard survival of published
-- aggregates.
--
-- WHAT WAS WRONG.
--
-- withdraw_contribution() set stale_since on every dependent benchmark, and
-- NOTHING in the system could ever clear it — no recompute function, no
-- migration, nothing. A benchmark that went stale was withheld permanently, so
-- a departing tenant could break figures every other tenant relied on. The
-- function's own message said "withheld until recomputed", promising a step
-- that did not exist.
--
-- THE MODEL NOW, WHICH IS THE STANDARD ONE.
--
-- A published aggregate has already been anonymised and pooled. At that point it
-- is no longer the contributor's data, so withdrawal does not retract it. What
-- withdrawal does is remove that contributor from FUTURE aggregates and queue
-- the published one for recomputation without them.
--
--   current            — published and correct.
--   pending_recompute  — a contributor withdrew. The figure STILL STANDS and
--                        stays readable, because it is anonymised and was
--                        validly published; it is queued to be replaced.
--   withheld           — recomputed, and the remainder no longer clears the
--                        gate. This is the k-anonymity threshold doing its job,
--                        not a punishment, and it reverses on its own when
--                        another contributor joins.
--
-- That distinction is what removes the denial-of-service: no tenant can withhold
-- anything by leaving. Only the threshold withholds, and only temporarily.
--
-- WHY RECOMPUTE IS NOW CHEAP.
--
-- Contributions carry a fitted value AND its standard error, which is enough to
-- pool by inverse-variance weighting and enough to UNPOOL. Removing a
-- contributor is dropping a row and re-weighting — no return to raw failure
-- times, which is fortunate because nobody has them outside the tenant.
--
-- WHERE THE ARITHMETIC LIVES.
--
-- Not here. Pooling is in src/lib/knowledge-contribution/pooling.ts, validated
-- against the closed-form inverse-variance mean. This migration owns GOVERNANCE
-- — k-anonymity, consent, provenance, who may publish — and re-validates every
-- one of those against the submitted source ids. It cannot check the arithmetic,
-- which is the honest cost of not implementing the same maths twice.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Standard errors, required for the lane that needs them.
-- ---------------------------------------------------------------------------
alter table knowledge_contributions
  add column if not exists fitted_value numeric,
  add column if not exists standard_error numeric;

comment on column knowledge_contributions.standard_error is
  'Standard error of the fit. Required for statistical contributions because it '
  'is what makes pooling possible AND what makes withdrawal recoverable — an '
  'estimate without one cannot be weighted, and an unweighted pool lets a fit '
  'from twelve failures carry the authority of one from two hundred.';

alter table knowledge_contributions
  drop constraint if exists statistical_needs_estimate;
alter table knowledge_contributions
  add constraint statistical_needs_estimate
  check (
    lane <> 'statistical'
    or (fitted_value is not null and fitted_value > 0
        and standard_error is not null and standard_error > 0)
  );

-- ---------------------------------------------------------------------------
-- Benchmark lifecycle state.
-- ---------------------------------------------------------------------------
alter table shared_benchmarks
  add column if not exists state text not null default 'current';

alter table shared_benchmarks
  drop constraint if exists benchmark_state_valid;
alter table shared_benchmarks
  add constraint benchmark_state_valid
  check (state in ('current','pending_recompute','withheld'));

-- Carry the old flag across: anything previously stale becomes pending, since
-- under the standard model it should never have been withheld outright.
update shared_benchmarks
set state = case when stale_since is not null then 'pending_recompute' else 'current' end
where state = 'current';

alter table shared_benchmarks
  add column if not exists superseded_benchmark_id bigint references shared_benchmarks(id),
  add column if not exists recomputed_at timestamptz,
  add column if not exists heterogeneity_i2 numeric,
  add column if not exists estimator text
    check (estimator is null or estimator in ('fixed','random'));

-- Readable while current OR pending: a pending figure is anonymised, was
-- validly published, and is being replaced rather than retracted. Withheld
-- rows are the only ones hidden, and only because the pool behind them no
-- longer clears k-anonymity.
drop policy if exists sbench_read on shared_benchmarks;
create policy sbench_read on shared_benchmarks
  for select to authenticated
  using (
    state in ('current','pending_recompute')
    and exists (
      select 1 from contribution_consent c
      where c.organization_id = app_current_org()
        and (
          (c.statistical_consent
           and c.terms_version = (select terms_version from contribution_policy
                                  where policy_key = 'default')
           and exists (select 1 from knowledge_contributions k
                       where k.organization_id = c.organization_id
                         and k.lane = 'statistical'
                         and k.withdrawn_at is null
                         and k.review_state <> 'rejected'))
          or c.benchmark_access_override
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Withdrawal, corrected.
-- ---------------------------------------------------------------------------
drop function if exists withdraw_contribution(bigint, text);
create or replace function withdraw_contribution(
  p_contribution_id bigint,
  p_reason text default null
)
returns table (outcome text, "benchmarksQueued" int, detail text)
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := app_current_org();
  v_owner uuid;
  v_count int;
begin
  select organization_id into v_owner
  from knowledge_contributions where id = p_contribution_id;

  if v_owner is null then
    return query select 'error'::text, 0, 'No such contribution.'::text;
    return;
  end if;
  if v_owner <> v_org then
    return query select 'refused'::text, 0,
      'This contribution belongs to another organization.'::text;
    return;
  end if;

  update knowledge_contributions
    set withdrawn_at = now()
    where id = p_contribution_id and withdrawn_at is null;

  -- Queue, do not withhold. The published figure is anonymised and stands.
  update shared_benchmarks
    set state = 'pending_recompute',
        stale_since = now(),
        stale_reason = coalesce(p_reason,
          'A contributor withdrew. The published figure was anonymised and pooled '
          || 'before publication, so it is not retracted — it is queued to be '
          || 'recomputed without them.')
    where state = 'current'
      and p_contribution_id = any (source_contribution_ids);
  get diagnostics v_count = row_count;

  return query select 'withdrawn'::text, v_count, format(
    'Contribution withdrawn and excluded from every future aggregate. %s published '
    || 'benchmark(s) used it and are queued for recomputation; they remain readable '
    || 'in the meantime because a pooled, anonymised figure is no longer the '
    || 'contributor''s data to retract. No tenant can withhold a benchmark by '
    || 'leaving — only the k-anonymity threshold can, and only until another '
    || 'contributor joins.', v_count);
end;
$$;

grant execute on function withdraw_contribution(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Republish a recomputed benchmark.
--
-- The caller supplies the pooled value; this re-validates the GOVERNANCE around
-- it against the submitted source ids and refuses anything that does not clear
-- the gate. It deliberately does not recompute the arithmetic — that lives in
-- one place, in the validated engine.
-- ---------------------------------------------------------------------------
drop function if exists republish_benchmark(text, jsonb, bigint[], numeric, text);
create or replace function republish_benchmark(
  p_benchmark_key text,
  p_value jsonb,
  p_source_contribution_ids bigint[],
  p_heterogeneity_i2 numeric default null,
  p_estimator text default null
)
returns table (outcome text, state text, detail text)
language plpgsql security definer set search_path = public as $$
declare
  b shared_benchmarks%rowtype;
  p contribution_policy%rowtype;
  v_policy text;
  v_tenants int; v_assets int; v_events int; v_max_share numeric;
  v_withdrawn int;
begin
  select * into b from shared_benchmarks where benchmark_key = p_benchmark_key;
  if not found then
    return query select 'error'::text, null::text, 'No such benchmark.'::text;
    return;
  end if;

  v_policy := coalesce(
    (select policy_key from metric_policy_map where metric = b.metric), 'default');
  select * into p from contribution_policy where policy_key = v_policy;

  -- A republished benchmark must not contain a withdrawn contribution. This is
  -- the check the whole feature exists for, so it is made explicitly rather
  -- than assumed from the caller having filtered.
  select count(*) into v_withdrawn
  from knowledge_contributions
  where id = any (p_source_contribution_ids) and withdrawn_at is not null;

  if v_withdrawn > 0 then
    return query select 'refused'::text, b.state, format(
      '%s of the submitted source contribution(s) have been withdrawn. Republishing '
      || 'with them would reinstate exactly the data the withdrawal removed.',
      v_withdrawn);
    return;
  end if;

  select count(distinct k.organization_id), coalesce(sum(k.asset_count),0),
         coalesce(sum(k.failure_events),0)
  into v_tenants, v_assets, v_events
  from knowledge_contributions k
  join contribution_consent c on c.organization_id = k.organization_id
  where k.id = any (p_source_contribution_ids)
    and k.withdrawn_at is null
    and k.review_state <> 'rejected'
    and c.statistical_consent
    and c.terms_version = p.terms_version;

  select coalesce(max(share),0) into v_max_share from (
    select 100.0 * sum(k.asset_count) / nullif(v_assets,0) share
    from knowledge_contributions k
    where k.id = any (p_source_contribution_ids) and k.withdrawn_at is null
    group by k.organization_id
  ) s;

  if v_tenants < p.min_contributing_tenants
     or v_assets < p.min_contributing_assets
     or v_events < p.min_failure_events
     or v_max_share > p.max_single_tenant_share_pct
     or p.terms_version like '%draft%' then
    update shared_benchmarks
      set state = 'withheld',
          stale_since = coalesce(stale_since, now()),
          stale_reason = format(
            'Recomputed without the withdrawn contribution(s) and the remainder no '
            || 'longer clears the %s policy: %s tenant(s) of %s, %s asset(s) of %s, '
            || '%s event(s) of %s, largest contributor %s%% against %s%%. This '
            || 'reverses on its own when another contributor joins.',
            coalesce(p.label, v_policy), v_tenants, p.min_contributing_tenants,
            v_assets, p.min_contributing_assets, v_events, p.min_failure_events,
            round(v_max_share,1), p.max_single_tenant_share_pct)
      where id = b.id;
    return query select 'withheld'::text, 'withheld'::text,
      (select stale_reason from shared_benchmarks where id = b.id);
    return;
  end if;

  update shared_benchmarks set
    value = p_value,
    contributing_tenants = v_tenants,
    contributing_assets = v_assets,
    max_single_tenant_share_pct = round(v_max_share,1),
    source_contribution_ids = p_source_contribution_ids,
    heterogeneity_i2 = p_heterogeneity_i2,
    estimator = p_estimator,
    state = 'current',
    stale_since = null,
    stale_reason = null,
    recomputed_at = now()
  where id = b.id;

  return query select 'republished'::text, 'current'::text, format(
    'Republished from %s tenant(s), %s asset(s) and %s failure event(s) under the %s '
    || 'policy%s. The withdrawn contribution is gone from the figure rather than '
    || 'annotated out of it.',
    v_tenants, v_assets, v_events, coalesce(p.label, v_policy),
    case when p_estimator = 'random' then format(
      ', using the random-effects estimator because I² of %s%% says these fleets '
      || 'differ by more than sampling error', round(coalesce(p_heterogeneity_i2,0)*100))
      else '' end);
end;
$$;

grant execute on function republish_benchmark(text, jsonb, bigint[], numeric, text) to authenticated;

-- Everything queued for recomputation, with the estimates needed to do it.
-- Returns the fitted values and standard errors only — never raw data, which
-- is what makes this safe to hand to an application-side pooler.
drop function if exists get_benchmarks_pending_recompute();
create or replace function get_benchmarks_pending_recompute()
returns table (
  "benchmarkKey" text,
  "assetClass" text,
  metric text,
  "withdrawnIds" bigint[],
  estimates jsonb
)
language sql stable security definer set search_path = public as $$
  select b.benchmark_key, b.asset_class, b.metric,
    array(select k.id from knowledge_contributions k
          where k.id = any (b.source_contribution_ids) and k.withdrawn_at is not null),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'contributionId', k.id,
        'organizationId', k.organization_id,
        'value', k.fitted_value,
        'standardError', k.standard_error,
        'failureEvents', k.failure_events
      ) order by k.id)
      from knowledge_contributions k
      join contribution_consent c on c.organization_id = k.organization_id
      where k.lane = 'statistical'
        and k.artefact_type = b.metric
        and k.artefact_key = b.asset_class
        and k.withdrawn_at is null
        and k.review_state <> 'rejected'
        and c.statistical_consent
    ), '[]'::jsonb)
  from shared_benchmarks b
  where b.state = 'pending_recompute';
$$;

grant execute on function get_benchmarks_pending_recompute() to authenticated;

notify pgrst, 'reload schema';
