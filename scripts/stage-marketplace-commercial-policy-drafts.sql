-- Stage the three Azure Marketplace commercial policies as drafts only.
--
-- This script never approves a policy, activates a subscription or publishes
-- an offer. It is intentionally fail-closed around the canonical production
-- project and the two external prerequisites that cannot be inferred from the
-- database. Run with psql and explicit variables, for example:
--
--   psql ... \
--     -v target_project_ref=pjvoswbwomesuwhygpby \
--     -v partner_center_drafts_verified=true \
--     -v marketplace_client_secret_present=true \
--     -v commit_drafts=false \
--     -f scripts/stage-marketplace-commercial-policy-drafts.sql
--
-- Keep commit_drafts=false for a transactional evaluation. Set it to true only
-- after the dry run returns three allowed draft policies with the exact inputs.

\set ON_ERROR_STOP on

\if :{?target_project_ref}
\else
  \echo 'Refusing: target_project_ref is required.'
  select 1 / 0 as prerequisite_refusal;
\endif

select :'target_project_ref' = 'pjvoswbwomesuwhygpby'
  as target_project_ref_is_canonical
\gset

\if :target_project_ref_is_canonical
\else
  \echo 'Refusing: target_project_ref is not the canonical SyncAI production project.'
  select 1 / 0 as prerequisite_refusal;
\endif

-- target_project_ref is an operator assertion, not connection evidence. Verify
-- psql's actual connection identity as well. Direct Supabase connections carry
-- the project ref in HOST; pooler connections carry it in USER.
select position(
    lower(:'target_project_ref') in lower(coalesce(:'HOST', ''))
  ) > 0
  or position(
    lower(:'target_project_ref') in lower(coalesce(:'USER', ''))
  ) > 0 as actual_connection_is_canonical
\gset

\if :actual_connection_is_canonical
\else
  \echo 'Refusing: the actual psql connection is not the canonical SyncAI production project.'
  select 1 / 0 as prerequisite_refusal;
\endif

\if :{?partner_center_drafts_verified}
\else
  \echo 'Refusing: partner_center_drafts_verified is required.'
  select 1 / 0 as prerequisite_refusal;
\endif

\if :partner_center_drafts_verified
\else
  \echo 'Refusing: Partner Center plan drafts have not been verified.'
  select 1 / 0 as prerequisite_refusal;
\endif

\if :{?marketplace_client_secret_present}
\else
  \echo 'Refusing: marketplace_client_secret_present is required.'
  select 1 / 0 as prerequisite_refusal;
\endif

\if :marketplace_client_secret_present
\else
  \echo 'Refusing: AZURE_MARKETPLACE_CLIENT_SECRET is not present in production.'
  select 1 / 0 as prerequisite_refusal;
\endif

\if :{?commit_drafts}
\else
  \set commit_drafts false
\endif

select lower(:'commit_drafts') in ('true', 'false')
  as commit_drafts_is_boolean
\gset

\if :commit_drafts_is_boolean
\else
  \echo 'Refusing: commit_drafts must be true or false.'
  select 1 / 0 as prerequisite_refusal;
\endif

begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

select pg_advisory_xact_lock(
  hashtextextended('syncai:azure-marketplace:commercial-policy-drafts', 0)
);

do $preconditions$
begin
  if to_regprocedure(
    'public.configure_ai_commercial_plan_policy(text,text,text,text,text,integer,bigint,integer,bigint,integer,numeric,numeric,numeric,numeric,text[],text,numeric,numeric,text)'
  ) is null
    or to_regprocedure(
      'public.configure_commercial_plan_capacity(text,text,text,integer,integer)'
    ) is null
    or to_regprocedure(
      'public.evaluate_ai_commercial_plan_policy(text,text,text)'
    ) is null then
    raise exception 'Canonical commercial-policy RPCs are absent';
  end if;

  if exists (
    select 1
    from private.ai_commercial_plan_policies
    where billing_source = 'azure_marketplace'
      and offer_id = 'syncai-predictive-maintenance'
      and plan_id in ('starter', 'professional', 'enterprise')
      and status <> 'draft'
  ) then
    raise exception 'Refusing to overwrite an approved or retired policy';
  end if;

  if exists (
    select 1
    from public.billing_subscriptions
    where billing_source = 'azure_marketplace'
      and marketplace_offer_id = 'syncai-predictive-maintenance'
      and status = 'active'
  ) then
    raise exception 'Refusing to reconfigure policy while a Marketplace subscription is active';
  end if;
end
$preconditions$;

select public.configure_ai_commercial_plan_policy(
  'azure_marketplace',
  'syncai-predictive-maintenance',
  'starter', 'flat_rate', 'hard_stop',
  100, 10000000, 100, 10000000, 20,
  6980, 1100, 1.1, 0.75,
  ARRAY['gpt-5.6-terra', 'gpt-5.6-luna'],
  null, null, null,
  'Controlled Marketplace draft; decision record 2026-11-01'
);

select public.configure_ai_commercial_plan_policy(
  'azure_marketplace',
  'syncai-predictive-maintenance',
  'professional', 'flat_rate', 'hard_stop',
  300, 30000000, 300, 30000000, 60,
  20940, 3700, 1.1, 0.75,
  ARRAY['gpt-5.6-terra', 'gpt-5.6-luna'],
  null, null, null,
  'Controlled Marketplace draft; decision record 2026-11-01'
);

select public.configure_ai_commercial_plan_policy(
  'azure_marketplace',
  'syncai-predictive-maintenance',
  'enterprise', 'flat_rate', 'hard_stop',
  600, 60000000, 600, 60000000, 120,
  41880, 7400, 1.1, 0.75,
  ARRAY['gpt-5.6-terra', 'gpt-5.6-luna'],
  null, null, null,
  'Controlled Marketplace draft; decision record 2026-11-01'
);

select public.configure_commercial_plan_capacity(
  'azure_marketplace', 'syncai-predictive-maintenance', 'starter', 1, 25
);
select public.configure_commercial_plan_capacity(
  'azure_marketplace', 'syncai-predictive-maintenance', 'professional', 5, 100
);
select public.configure_commercial_plan_capacity(
  'azure_marketplace', 'syncai-predictive-maintenance', 'enterprise', 15, 250
);

create temporary table syncai_marketplace_draft_evaluations (
  plan_id text primary key,
  evaluation jsonb not null
) on commit drop;

insert into syncai_marketplace_draft_evaluations (plan_id, evaluation)
values
  (
    'starter',
    public.evaluate_ai_commercial_plan_policy(
      'azure_marketplace', 'syncai-predictive-maintenance', 'starter'
    )
  ),
  (
    'professional',
    public.evaluate_ai_commercial_plan_policy(
      'azure_marketplace', 'syncai-predictive-maintenance', 'professional'
    )
  ),
  (
    'enterprise',
    public.evaluate_ai_commercial_plan_policy(
      'azure_marketplace', 'syncai-predictive-maintenance', 'enterprise'
    )
  );

do $verification$
begin
  if (
    select count(*)
    from private.ai_commercial_plan_policies
    where billing_source = 'azure_marketplace'
      and offer_id = 'syncai-predictive-maintenance'
      and plan_id in ('starter', 'professional', 'enterprise')
  ) <> 3 then
    raise exception 'Expected exactly three Marketplace policy rows';
  end if;

  if exists (
    select 1
    from private.ai_commercial_plan_policies
    where billing_source = 'azure_marketplace'
      and offer_id = 'syncai-predictive-maintenance'
      and plan_id in ('starter', 'professional', 'enterprise')
      and (
        status <> 'draft'
        or approved_by is not null
        or approved_at is not null
        or pricing_model <> 'flat_rate'
        or allowance_mode <> 'hard_stop'
        or max_calls_per_period <> included_calls_per_period
        or max_tokens_per_period <> included_tokens_per_period
        or meter_dimension is not null
        or meter_unit_tokens is not null
        or overage_revenue_cad_per_unit is not null
        or provider_cost_multiplier <> 1.1
        or minimum_gross_margin_ratio <> 0.75
        or allowed_models <> ARRAY['gpt-5.6-luna', 'gpt-5.6-terra']::text[]
      )
  ) then
    raise exception 'A Marketplace policy row differs from the controlled boundary';
  end if;

  if exists (
    select 1
    from private.ai_commercial_plan_policies
    where billing_source = 'azure_marketplace'
      and offer_id = 'syncai-predictive-maintenance'
      and (
        (plan_id = 'starter' and row(
          included_calls_per_period, included_tokens_per_period,
          max_decisions_per_period, minimum_period_revenue_cad,
          non_inference_variable_cost_cad, max_sites, max_named_users
        ) is distinct from row(100, 10000000::bigint, 20, 6980::numeric, 1100::numeric, 1, 25))
        or (plan_id = 'professional' and row(
          included_calls_per_period, included_tokens_per_period,
          max_decisions_per_period, minimum_period_revenue_cad,
          non_inference_variable_cost_cad, max_sites, max_named_users
        ) is distinct from row(300, 30000000::bigint, 60, 20940::numeric, 3700::numeric, 5, 100))
        or (plan_id = 'enterprise' and row(
          included_calls_per_period, included_tokens_per_period,
          max_decisions_per_period, minimum_period_revenue_cad,
          non_inference_variable_cost_cad, max_sites, max_named_users
        ) is distinct from row(600, 60000000::bigint, 120, 41880::numeric, 7400::numeric, 15, 250))
      )
  ) then
    raise exception 'A Marketplace policy allowance or capacity differs from the decision record';
  end if;

  if exists (
    select 1
    from syncai_marketplace_draft_evaluations
    where not coalesce((evaluation ->> 'allowed')::boolean, false)
      or coalesce((evaluation ->> 'baseGrossMarginRatio')::numeric, 0) < 0.75
  ) then
    raise exception 'A Marketplace policy failed the 75 percent gross-margin gate';
  end if;
end
$verification$;

select plan_id, evaluation
from syncai_marketplace_draft_evaluations
order by plan_id;

\if :commit_drafts
  commit;
  \echo 'Committed three Marketplace commercial-policy drafts; no policy was approved.'
\else
  rollback;
  \echo 'Dry run complete; all draft writes were rolled back.'
\endif
