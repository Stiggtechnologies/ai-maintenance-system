-- ============================================================================
-- Tightened contribution policy, an events floor, per-metric sensitivity,
-- reciprocal access, and consent authority.
--
-- FIVE CHANGES, EACH FOR A DIFFERENT REASON.
--
-- 1. k RAISED FROM 5 TO 8.
--    k-anonymity protects you when k is small relative to the population it is
--    drawn from. This market is concentrated — a handful of major operators in
--    any given basin — so five of eight is a majority of the field, and a
--    contributor who subtracts themselves is left reading four identifiable
--    competitors. Eight leaves seven after subtraction, which is a pool rather
--    than a shortlist.
--
-- 2. A FAILURE-EVENT FLOOR, BECAUSE ASSET COUNT WAS MEASURING THE WRONG THING.
--    Asset count is a privacy proxy. Statistical validity depends on how many
--    FAILURES the fit saw: twenty assets with three failures each is a
--    defensible Weibull; twenty assets with one failure each is twenty events
--    and noise. Both floors are needed and they constrain different things. The
--    original policy could have published a benchmark that was anonymous and
--    meaningless.
--
-- 3. SINGLE-CONTRIBUTOR CAP 40% -> 25%.
--    At forty percent one operator is nearly half the sample and everyone else
--    is being benchmarked against one company's maintenance culture. Twenty-five
--    percent implies at least four meaningful contributors.
--
-- 4. PER-METRIC SENSITIVITY.
--    "How often does an undercarriage need replacing" is commercially bland.
--    "What does downtime cost per hour" is pricing intelligence a competitor
--    would pay for. One threshold for both is wrong in one direction or the
--    other, so metrics map to policies.
--
-- 5. RECIPROCAL ACCESS.
--    Previously ANY tenant could read every published benchmark whether or not
--    they contributed. That was a default I chose without flagging it, not a
--    decision anybody made. Now reading requires contributing — the consortium
--    model — with an explicit override for pilots and demos.
--
-- STILL OPEN, AND DELIBERATELY NOT FIXED HERE: withdrawal invalidates dependent
-- benchmarks with no recompute path, so a departing tenant can withhold figures
-- others rely on. Recomputing correctly means pooling fitted parameters, which
-- is a real statistical design question and not a migration.
-- ============================================================================

alter table contribution_policy
  add column if not exists min_failure_events int not null default 60,
  add column if not exists label text;

comment on column contribution_policy.min_failure_events is
  'Failure events behind the pooled sample. Separate from min_contributing_assets '
  'because assets bound disclosure risk and events bound statistical validity — '
  'a benchmark can satisfy one and fail the other.';

update contribution_policy set
  min_contributing_tenants = 8,
  min_contributing_assets = 20,
  min_failure_events = 60,
  max_single_tenant_share_pct = 25,
  label = 'Default',
  rationale =
    'Eight tenants, not five: k-anonymity assumes k is small relative to the '
    || 'population, and this market is concentrated enough that five of roughly '
    || 'eight operators is a majority of the field — a contributor subtracting '
    || 'themselves would read four identifiable competitors. Sixty failure events '
    || 'because asset count bounds disclosure and event count bounds whether the '
    || 'fit means anything; twenty assets with one failure each is noise. '
    || 'Twenty-five percent so no single operator is half the sample everyone '
    || 'else is measured against. terms_version stays draft: no customer has '
    || 'agreed to anything, and the gate refuses to publish under draft terms '
    || 'however well the thresholds are met.'
where policy_key = 'default';

insert into contribution_policy
  (policy_key, label, min_contributing_tenants, min_contributing_assets,
   min_failure_events, max_single_tenant_share_pct, terms_version, rationale)
values
  ('commercially_sensitive', 'Commercially sensitive', 15, 60, 200, 15, 'v1-draft',
   'For metrics that are competitive intelligence rather than engineering fact — '
   || 'cost per hour of downtime, labour rates, contractor performance. A '
   || 'competitor would pay for these, so the thresholds are set where the '
   || 'aggregate stops being useful to a rival trying to price against a '
   || 'specific operator. Deliberately high enough that these may never publish, '
   || 'which is an acceptable outcome: there is no obligation to benchmark '
   || 'everything.')
on conflict (policy_key) do update set
  label = excluded.label,
  min_contributing_tenants = excluded.min_contributing_tenants,
  min_contributing_assets = excluded.min_contributing_assets,
  min_failure_events = excluded.min_failure_events,
  max_single_tenant_share_pct = excluded.max_single_tenant_share_pct,
  rationale = excluded.rationale;

-- ---------------------------------------------------------------------------
-- Which policy governs which metric. Unmapped metrics fall to 'default'
-- rather than to the loosest available — an unclassified metric should not
-- gain permissive treatment by being forgotten about.
-- ---------------------------------------------------------------------------
create table if not exists metric_policy_map (
  metric text primary key,
  policy_key text not null references contribution_policy(policy_key),
  rationale text not null
);

insert into metric_policy_map (metric, policy_key, rationale) values
  ('weibull_beta','default','Shape parameter of a life distribution. Engineering fact about a machine type.'),
  ('weibull_eta','default','Characteristic life. Engineering fact.'),
  ('mtbf_hours','default','Mean time between failures. Engineering fact.'),
  ('mttr_hours','default','Mean time to repair. Borderline — it reflects crew capability as much as the machine — but not directly priceable.'),
  ('downtime_cost_per_hour','commercially_sensitive','Pricing intelligence. Tells a competitor what an outage is worth to this operator.'),
  ('labour_rate','commercially_sensitive','Directly commercially sensitive.'),
  ('contractor_performance','commercially_sensitive','Names a third party by implication and affects their commercial position.')
on conflict (metric) do update set
  policy_key = excluded.policy_key, rationale = excluded.rationale;

alter table metric_policy_map enable row level security;
drop policy if exists mpm_read on metric_policy_map;
create policy mpm_read on metric_policy_map for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Failure events behind each contribution.
-- ---------------------------------------------------------------------------
alter table knowledge_contributions
  add column if not exists failure_events int;

comment on column knowledge_contributions.failure_events is
  'Failure events behind this contribution. Null for structural artefacts, which '
  'are not fitted from events. Required for statistical ones.';

-- Nullable in general, required for the lane that needs it.
alter table knowledge_contributions
  drop constraint if exists statistical_needs_events;
alter table knowledge_contributions
  add constraint statistical_needs_events
  check (lane <> 'statistical' or (failure_events is not null and failure_events > 0));

-- ---------------------------------------------------------------------------
-- Consent authority, and the pilot override.
-- ---------------------------------------------------------------------------
alter table contribution_consent
  add column if not exists benchmark_access_override boolean not null default false,
  add column if not exists override_reason text;

comment on column contribution_consent.benchmark_access_override is
  'Lets a tenant read shared benchmarks without contributing — for pilots, '
  'trials and evaluations. Explicit and reasoned so it cannot become the silent '
  'default that reciprocity was introduced to end.';

-- Consent is a contractual act, not an application setting. Restricting it to
-- roles that plausibly hold signing authority stops a technician toggling away
-- their employer's data.
create or replace function enforce_consent_authority()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  if new.structural_consent = false and new.statistical_consent = false then
    return new;
  end if;
  if new.granted_by is null then
    raise exception 'Consent requires granted_by.' using errcode = 'check_violation';
  end if;

  select role into v_role from user_profiles where id = new.granted_by;

  if v_role is null or v_role not in ('admin','executive') then
    raise exception
      'Consent to contribute was recorded against a user with role "%". Contributing '
      'an organization''s data to a shared corpus is a contractual act, not an '
      'application setting, and must be granted by someone with signing authority '
      '(admin or executive).', coalesce(v_role, 'unknown')
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_consent_authority on contribution_consent;
create trigger trg_consent_authority
  before insert or update of structural_consent, statistical_consent, granted_by
  on contribution_consent
  for each row execute function enforce_consent_authority();

-- ---------------------------------------------------------------------------
-- Reciprocal access. Replaces "any authenticated tenant may read".
-- ---------------------------------------------------------------------------
drop policy if exists sbench_read on shared_benchmarks;
create policy sbench_read on shared_benchmarks
  for select to authenticated
  using (
    stale_since is null
    and exists (
      select 1 from contribution_consent c
      where c.organization_id = app_current_org()
        and (
          -- Contributing, under current terms, with something actually given.
          (c.statistical_consent
           and c.terms_version = (select terms_version from contribution_policy
                                  where policy_key = 'default')
           and exists (select 1 from knowledge_contributions k
                       where k.organization_id = c.organization_id
                         and k.lane = 'statistical'
                         and k.withdrawn_at is null
                         and k.review_state <> 'rejected'))
          -- Or explicitly granted read access without contributing.
          or c.benchmark_access_override
        )
    )
  );

-- ---------------------------------------------------------------------------
-- Eligibility, now policy-aware and events-aware.
-- ---------------------------------------------------------------------------
drop function if exists evaluate_benchmark_eligibility(text, text, text);
create or replace function evaluate_benchmark_eligibility(
  p_asset_class text,
  p_metric text,
  p_policy_key text default null
)
returns table (
  eligible boolean,
  "policyKey" text,
  "contributingTenants" int,
  "contributingAssets" int,
  "failureEvents" int,
  "maxSingleTenantSharePct" numeric,
  "tenantsWithoutConsent" int,
  "staleConsentTenants" int,
  reason text
)
language plpgsql stable security definer set search_path = public as $$
declare
  p contribution_policy%rowtype;
  v_policy text;
  v_tenants int; v_assets int; v_events int; v_max_share numeric;
  v_no_consent int; v_stale_consent int;
  v_fail text := '';
begin
  -- An unmapped metric falls to 'default', never to the loosest policy.
  v_policy := coalesce(
    p_policy_key,
    (select policy_key from metric_policy_map where metric = p_metric),
    'default');

  select * into p from contribution_policy where policy_key = v_policy;
  if not found then
    return query select false, v_policy, 0, 0, 0, 0::numeric, 0, 0,
      format('No contribution policy named "%s". Nothing publishes without one.', v_policy);
    return;
  end if;

  with eligible_contrib as (
    select k.*, c.statistical_consent, c.terms_version consent_terms
    from knowledge_contributions k
    left join contribution_consent c on c.organization_id = k.organization_id
    where k.lane = 'statistical'
      and k.artefact_type = p_metric
      and k.artefact_key = p_asset_class
      and k.withdrawn_at is null
      and k.review_state <> 'rejected'
  )
  select
    count(distinct organization_id) filter (
      where statistical_consent and consent_terms = p.terms_version),
    coalesce(sum(asset_count) filter (
      where statistical_consent and consent_terms = p.terms_version), 0),
    coalesce(sum(failure_events) filter (
      where statistical_consent and consent_terms = p.terms_version), 0),
    count(distinct organization_id) filter (where not coalesce(statistical_consent,false)),
    count(distinct organization_id) filter (
      where statistical_consent and consent_terms is distinct from p.terms_version)
  into v_tenants, v_assets, v_events, v_no_consent, v_stale_consent
  from eligible_contrib;

  select coalesce(max(share), 0) into v_max_share from (
    select 100.0 * sum(k.asset_count) / nullif(v_assets, 0) share
    from knowledge_contributions k
    join contribution_consent c on c.organization_id = k.organization_id
    where k.lane = 'statistical' and k.artefact_type = p_metric
      and k.artefact_key = p_asset_class and k.withdrawn_at is null
      and k.review_state <> 'rejected'
      and c.statistical_consent and c.terms_version = p.terms_version
    group by k.organization_id
  ) s;

  if v_tenants < p.min_contributing_tenants then
    v_fail := v_fail || format(
      '%s consenting tenant(s), policy requires %s — below that a contributor can '
      || 'subtract themselves and read a shortlist rather than a pool. ',
      v_tenants, p.min_contributing_tenants);
  end if;
  if v_assets < p.min_contributing_assets then
    v_fail := v_fail || format(
      '%s asset(s), policy requires %s. ', v_assets, p.min_contributing_assets);
  end if;
  if v_events < p.min_failure_events then
    v_fail := v_fail || format(
      '%s failure event(s), policy requires %s — this bounds whether the fit means '
      || 'anything, which asset count does not. ', v_events, p.min_failure_events);
  end if;
  if v_max_share > p.max_single_tenant_share_pct then
    v_fail := v_fail || format(
      'One tenant contributes %s%% of the sample, capped at %s%%. ',
      round(v_max_share, 1), p.max_single_tenant_share_pct);
  end if;
  if p.terms_version like '%draft%' then
    v_fail := v_fail || format(
      'Policy terms_version is "%s" — no customer has agreed to draft terms, so '
      || 'nothing publishes under them however well the thresholds are met. ',
      p.terms_version);
  end if;

  return query select
    v_fail = '', v_policy,
    v_tenants, v_assets, v_events, round(v_max_share, 1), v_no_consent, v_stale_consent,
    case when v_fail = '' then format(
      'Eligible under the %s policy: %s tenants, %s assets, %s failure events, '
      || 'largest contributor %s%%, terms %s.',
      p.label, v_tenants, v_assets, v_events, round(v_max_share,1), p.terms_version)
    else format('NOT PUBLISHED under the %s policy. ', coalesce(p.label, v_policy)) || v_fail
      || case when v_no_consent > 0 then format(
           '%s tenant(s) contributed without consenting and are excluded from every '
           || 'figure above. ', v_no_consent) else '' end
      || case when v_stale_consent > 0 then format(
           '%s tenant(s) consented under different terms; that does not carry '
           || 'forward. ', v_stale_consent) else '' end
    end;
end;
$$;

grant execute on function evaluate_benchmark_eligibility(text, text, text) to authenticated;

-- Posture, extended with whether this tenant may read benchmarks at all.
drop function if exists get_contribution_posture();
create or replace function get_contribution_posture()
returns table (
  "structuralConsent" boolean,
  "statisticalConsent" boolean,
  "termsVersion" text,
  "policyTermsVersion" text,
  "consentIsCurrent" boolean,
  "ownContributions" int,
  "ownWithdrawn" int,
  "freshBenchmarks" int,
  "staleBenchmarks" int,
  "mayReadBenchmarks" boolean,
  "accessBasis" text
)
language sql stable security definer set search_path = public as $$
  select
    coalesce(c.structural_consent, false),
    coalesce(c.statistical_consent, false),
    c.terms_version,
    p.terms_version,
    c.terms_version is not null and c.terms_version = p.terms_version,
    (select count(*)::int from knowledge_contributions k
      where k.organization_id = app_current_org() and k.withdrawn_at is null),
    (select count(*)::int from knowledge_contributions k
      where k.organization_id = app_current_org() and k.withdrawn_at is not null),
    (select count(*)::int from shared_benchmarks where stale_since is null),
    (select count(*)::int from shared_benchmarks where stale_since is not null),
    coalesce(c.benchmark_access_override, false)
      or (coalesce(c.statistical_consent,false)
          and c.terms_version = p.terms_version
          and exists (select 1 from knowledge_contributions k
                      where k.organization_id = app_current_org()
                        and k.lane = 'statistical' and k.withdrawn_at is null
                        and k.review_state <> 'rejected')),
    case
      when coalesce(c.benchmark_access_override,false)
        then 'Read access granted without contributing: ' || coalesce(c.override_reason, 'no reason recorded')
      when coalesce(c.statistical_consent,false) and c.terms_version = p.terms_version
        then 'Reciprocal — this organization contributes and may therefore read'
      else 'No access. Shared benchmarks are reciprocal: contributing to the pool is what grants the right to read it. A pilot override can be granted instead.'
    end
  from contribution_policy p
  left join contribution_consent c on c.organization_id = app_current_org()
  where p.policy_key = 'default';
$$;

grant execute on function get_contribution_posture() to authenticated;

notify pgrst, 'reload schema';
