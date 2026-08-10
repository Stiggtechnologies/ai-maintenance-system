-- ============================================================================
-- Cross-tenant contribution: the licensed gate through the wall
-- (register E12 data governance, U19 AI governance, U3 shared ontology).
--
-- WHAT THE INDUSTRY DOES, AND WHAT IS BORROWED FROM EACH.
--
-- Microsoft's promise for 365 Copilot is absolute and therefore sellable:
-- customer data is logically isolated per tenant, stays inside the service
-- boundary, and is never used to train foundation models. The cross-customer
-- value in their security products comes from a SEPARATE pipeline — their own
-- research and first-party telemetry — not from mining customer tenants. The
-- lesson is that a promise with an "unless..." clause costs enterprise deals,
-- so the boundary is stated without one.
--
-- Palantir Foundry's mechanism is inherited restriction. An ontology may be
-- shared across organizations, but referencing a dataset into a shared project
-- does NOT make it visible: the data carries its origin organization's access
-- requirement with it, and users of the other organization stay blocked until
-- somebody deliberately removes that requirement. Sharing the container is not
-- sharing the contents, and de-restriction is an explicit, attributable act.
--
-- SO THIS IS NOT A DATA PIPELINE.
--
-- Nothing here mines a tenant. No background job reads customer data to build
-- aggregates — that is what preserves the Microsoft-style absolute statement.
-- Instead a named person CONTRIBUTES a specific derived artefact, which is
-- Palantir's "remove the inherited restriction" made into a first-class,
-- reviewable, revocable record.
--
-- TWO LANES, DELIBERATELY DIFFERENT RULES.
--
--   structural  — component breakdowns, failure-mode taxonomies. No k-anonymity
--                 needed, because "a track dozer has a final drive" discloses
--                 nothing about who owns one. Needs engineering review instead.
--
--   statistical — benchmarks like Weibull shape by asset class. Discloses
--                 nothing individually and everything in aggregate if the
--                 contributing set is small, so it needs k-anonymity, a cap on
--                 any single contributor, and explicit consent.
--
-- REVOCATION IS DESIGNED IN, NOT ADDED LATER.
--
-- Every published benchmark records the contribution ids it was computed from.
-- Withdraw a contribution and the aggregates that depended on it are marked
-- stale immediately. Retrofitting this is impossible, which is why it is here
-- before the first contribution exists.
--
-- Canonical reuse: organizations, app_current_org(), the maturity vocabulary
-- from asset_twin_templates. Additive.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Policy thresholds as configuration, not constants.
--
-- The right numbers are a commercial and contractual judgement, not an
-- engineering one. They live in a row so they can be set by the people who own
-- that decision, and so a change to them is a visible act.
-- ---------------------------------------------------------------------------
create table if not exists contribution_policy (
  policy_key text primary key,
  -- k in k-anonymity: how many distinct tenants must contribute before a
  -- statistic may be published.
  min_contributing_tenants int not null,
  -- A floor on the sample too. Five tenants with one asset each is five
  -- machines, and a benchmark built on five machines is an anecdote.
  min_contributing_assets int not null,
  -- No single tenant may exceed this share of the sample. Without it, a
  -- benchmark that is 95% one operator is that operator's data wearing a
  -- disguise, and re-identifiable by subtraction.
  max_single_tenant_share_pct numeric not null
    check (max_single_tenant_share_pct > 0 and max_single_tenant_share_pct <= 100),
  -- Terms the consent refers to. Bumping this invalidates existing consent,
  -- which is the point: changed terms need to be agreed again.
  terms_version text not null,
  rationale text not null,
  updated_at timestamptz not null default now()
);

insert into contribution_policy
  (policy_key, min_contributing_tenants, min_contributing_assets,
   max_single_tenant_share_pct, terms_version, rationale)
values
  ('default', 5, 20, 40, 'v1-draft',
   'Starting values, NOT agreed commercial terms. Five tenants is the common '
   || 'floor for k-anonymity in benchmarking; twenty assets keeps a benchmark '
   || 'from being an anecdote; forty percent stops one contributor dominating a '
   || 'sample they could then subtract themselves out of. terms_version is '
   || 'marked draft because no customer has agreed to anything yet — consent '
   || 'recorded against a draft version must be re-obtained before publication.')
on conflict (policy_key) do nothing;

alter table contribution_policy enable row level security;
drop policy if exists cpol_read on contribution_policy;
create policy cpol_read on contribution_policy
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Consent. Per tenant, per lane, defaulting to OFF.
--
-- Absence of a row means no consent. A tenant that has never been asked and a
-- tenant that declined are treated identically, which is the safe direction.
-- ---------------------------------------------------------------------------
create table if not exists contribution_consent (
  organization_id uuid primary key references organizations(id) on delete cascade,
  structural_consent boolean not null default false,
  statistical_consent boolean not null default false,
  -- Which terms were agreed. Consent against a superseded version is not
  -- consent to the current one.
  terms_version text,
  granted_by uuid references auth.users(id),
  granted_at timestamptz,
  revoked_at timestamptz,
  note text,
  updated_at timestamptz not null default now(),
  -- Consent to anything requires knowing what was agreed and who agreed it.
  constraint consent_needs_provenance
    check ((structural_consent = false and statistical_consent = false)
           or (terms_version is not null and granted_by is not null
               and granted_at is not null))
);

alter table contribution_consent enable row level security;
drop policy if exists ccon_read on contribution_consent;
create policy ccon_read on contribution_consent
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- The contributions themselves.
--
-- payload holds DERIVED artefacts only — a fitted parameter, a component list,
-- a taxonomy. Never raw rows, never document text, never an asset name. The
-- check below cannot enforce "derived", but it can refuse the obvious leaks.
-- ---------------------------------------------------------------------------
create table if not exists knowledge_contributions (
  id bigserial primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  lane text not null check (lane in ('structural','statistical')),
  artefact_type text not null,
  artefact_key text not null,
  -- How many of the tenant's own assets stand behind this contribution. Used
  -- for the sample-size floor and the single-contributor cap.
  asset_count int not null check (asset_count > 0),
  payload jsonb not null,
  -- Who at the tenant chose to contribute it. Not a system actor.
  contributed_by uuid references auth.users(id),
  contributed_at timestamptz not null default now(),
  review_state text not null default 'submitted'
    check (review_state in ('submitted','engineer_reviewed','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  -- Withdrawal is a timestamp, not a delete: the aggregates that used it must
  -- still be able to find it in order to know they are stale.
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  unique(organization_id, lane, artefact_type, artefact_key),
  -- A payload naming an asset is not a derived artefact. Cheap, partial, and
  -- worth having: it catches the copy-paste mistake, not a determined one.
  constraint payload_has_no_identifiers
    check (not (payload::text ilike '%"asset_name"%'
             or payload::text ilike '%"serial_number"%'
             or payload::text ilike '%"organization_id"%'))
);

create index if not exists idx_kcontrib_lane
  on knowledge_contributions(lane, artefact_type, artefact_key)
  where withdrawn_at is null;

alter table knowledge_contributions enable row level security;
drop policy if exists kcontrib_read on knowledge_contributions;
-- A tenant sees only its OWN contributions. Seeing everyone's would disclose
-- who is contributing what, which is itself commercially sensitive.
create policy kcontrib_read on knowledge_contributions
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- Published aggregates.
--
-- source_contribution_ids is the whole reason revocation works. Recomputing
-- "which benchmarks used this tenant" from scratch would be impossible once
-- the contribution is gone.
-- ---------------------------------------------------------------------------
create table if not exists shared_benchmarks (
  id bigserial primary key,
  benchmark_key text not null unique,
  asset_class text not null,
  metric text not null,
  value jsonb not null,
  contributing_tenants int not null,
  contributing_assets int not null,
  max_single_tenant_share_pct numeric not null,
  source_contribution_ids bigint[] not null,
  policy_key text not null references contribution_policy(policy_key),
  terms_version text not null,
  published_at timestamptz not null default now(),
  -- Set when a contributor withdraws. A stale benchmark is withheld from
  -- readers rather than served with a warning nobody reads.
  stale_since timestamptz,
  stale_reason text
);

alter table shared_benchmarks enable row level security;
drop policy if exists sbench_read on shared_benchmarks;
-- Published benchmarks are world facts by construction — they are only ever
-- published once they pass k-anonymity — so every tenant may read a fresh one.
create policy sbench_read on shared_benchmarks
  for select to authenticated using (stale_since is null);

-- ---------------------------------------------------------------------------
-- Publication gate. Refuses rather than publishes.
-- ---------------------------------------------------------------------------
drop function if exists evaluate_benchmark_eligibility(text, text, text);
create or replace function evaluate_benchmark_eligibility(
  p_asset_class text,
  p_metric text,
  p_policy_key text default 'default'
)
returns table (
  eligible boolean,
  "contributingTenants" int,
  "contributingAssets" int,
  "maxSingleTenantSharePct" numeric,
  "tenantsWithoutConsent" int,
  "staleConsentTenants" int,
  reason text
)
language plpgsql stable security definer set search_path = public as $$
declare
  p contribution_policy%rowtype;
  v_tenants int; v_assets int; v_max_share numeric;
  v_no_consent int; v_stale_consent int;
  v_fail text := '';
begin
  select * into p from contribution_policy where policy_key = p_policy_key;
  if not found then
    return query select false, 0, 0, 0::numeric, 0, 0,
      format('No contribution policy named "%s". Nothing is published without one.', p_policy_key);
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
    count(distinct organization_id) filter (where not coalesce(statistical_consent,false)),
    count(distinct organization_id) filter (
      where statistical_consent and consent_terms is distinct from p.terms_version)
  into v_tenants, v_assets, v_no_consent, v_stale_consent
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
      '%s consenting tenant(s), policy requires %s — below k-anonymity, so a reader could '
      || 'narrow the sample to individual operators. ', v_tenants, p.min_contributing_tenants);
  end if;
  if v_assets < p.min_contributing_assets then
    v_fail := v_fail || format(
      '%s asset(s) in the sample, policy requires %s — a benchmark this thin is an anecdote. ',
      v_assets, p.min_contributing_assets);
  end if;
  if v_max_share > p.max_single_tenant_share_pct then
    v_fail := v_fail || format(
      'One tenant contributes %s%% of the sample, policy caps a single contributor at %s%% — '
      || 'they could subtract themselves out and read the rest. ',
      round(v_max_share, 1), p.max_single_tenant_share_pct);
  end if;
  if p.terms_version like '%draft%' then
    v_fail := v_fail || format(
      'Policy terms_version is "%s". No customer has agreed to draft terms, so nothing '
      || 'may be published under them however well the thresholds are met. ', p.terms_version);
  end if;

  return query select
    v_fail = '',
    v_tenants, v_assets, round(v_max_share, 1), v_no_consent, v_stale_consent,
    case when v_fail = '' then format(
      'Eligible: %s tenants, %s assets, largest single contributor %s%%, terms %s.',
      v_tenants, v_assets, round(v_max_share,1), p.terms_version)
    else 'NOT PUBLISHED. ' || v_fail
      || case when v_no_consent > 0 then format(
           '%s tenant(s) have contributed but not consented and are excluded from every '
           || 'figure above. ', v_no_consent) else '' end
      || case when v_stale_consent > 0 then format(
           '%s tenant(s) consented under different terms; that consent does not carry '
           || 'forward. ', v_stale_consent) else '' end
    end;
end;
$$;

grant execute on function evaluate_benchmark_eligibility(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Withdrawal. Marks every dependent benchmark stale in the same transaction.
-- ---------------------------------------------------------------------------
drop function if exists withdraw_contribution(bigint, text);
create or replace function withdraw_contribution(
  p_contribution_id bigint,
  p_reason text default null
)
returns table (outcome text, "benchmarksInvalidated" int, detail text)
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
  -- A tenant may withdraw only its own. Withdrawing somebody else's would be a
  -- denial-of-service on the shared corpus.
  if v_owner <> v_org then
    return query select 'refused'::text, 0,
      'This contribution belongs to another organization.'::text;
    return;
  end if;

  update knowledge_contributions
    set withdrawn_at = now()
    where id = p_contribution_id and withdrawn_at is null;

  update shared_benchmarks
    set stale_since = now(),
        stale_reason = coalesce(p_reason,
          'A contributing organization withdrew its contribution. The published '
          || 'figure still contains their data and is withheld until recomputed.')
    where stale_since is null
      and p_contribution_id = any (source_contribution_ids);
  get diagnostics v_count = row_count;

  return query select 'withdrawn'::text, v_count, format(
    'Contribution withdrawn. %s published benchmark(s) depended on it and are now '
    || 'withheld from every tenant until recomputed without it. Withholding rather '
    || 'than annotating is deliberate: a figure that still contains withdrawn data '
    || 'is not made acceptable by a footnote.', v_count);
end;
$$;

grant execute on function withdraw_contribution(bigint, text) to authenticated;

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
  "staleBenchmarks" int
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
    (select count(*)::int from shared_benchmarks where stale_since is not null)
  from contribution_policy p
  left join contribution_consent c on c.organization_id = app_current_org()
  where p.policy_key = 'default';
$$;

grant execute on function get_contribution_posture() to authenticated;

notify pgrst, 'reload schema';
