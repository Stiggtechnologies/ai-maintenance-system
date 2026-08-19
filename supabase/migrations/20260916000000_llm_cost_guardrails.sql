-- ============================================================================
-- LLM cost guardrails — usage telemetry, per-organization daily quotas, and a
-- per-IP allowance for the anonymous public rail.
--
-- WHAT WAS BROKEN.
--   1. ai-agent-processor had NO rate limit, no quota, and no usage record.
--      A valid tenant JWT could call it once per second forever; every call
--      permitted up to 12,000 output tokens and returned HTTP 200. Nothing
--      recorded tokens per tenant, so gross margin was unmeasurable and the
--      standing instruction blocking Pro/Enterprise contracts (60 days of
--      measured C$/tenant required) could never be satisfied.
--   2. public-reliability-agent's daily rate-limit key mixed in a
--      CLIENT-SUPPLIED browserId; rotating the browserId minted a fresh
--      allowance, making unauthenticated frontier-model spend unlimited.
--      Its per-IP fix (in the edge function) needs an allowance function
--      whose ceiling is higher than consume_public_reliability_allowance's
--      hard `p_limit <= 10` — added here, reusing the SAME rate-limit table
--      rather than creating a parallel store.
--
-- WHAT THIS ADDS.
--   private.llm_usage        — one row per model call: who, which function,
--                              which model, how many tokens. The counting
--                              source for quota checks and the raw material
--                              for measured C$/tenant.
--   private.llm_prices       — vendor list prices, CAD per 1M tokens. Every
--                              seeded rate carries its vendor source URL and
--                              retrieval date; unverifiable rates are NULL.
--   private.llm_org_quotas   — per-organization overrides of the daily caps.
--   check_llm_quota()        — the pre-call gate. SUM over the current UTC
--                              day, compared against override-or-default.
--   record_llm_usage()       — the post-call insert (edge functions call it
--                              fail-soft; telemetry must never fail a user
--                              request).
--   consume_public_reliability_ip_allowance() — per-IP daily counter for the
--                              public rail, ceiling 100 instead of 10.
--
-- QUOTA SIZING — the arithmetic, from the product's own cadence:
--   * run_operating_loop is scheduled '*/5 * * * *'
--     (00000000000013_realtime_operating_picture.sql:269) = 288 ticks/day.
--   * docs/gtm-readiness.md: "Six proactive functions on the 5-min loop".
--     6 passes x 288 ticks/day = 1,728 agent passes/day/tenant
--     (= 51,840/month, the figure gtm-readiness cites).
--   * Worst legitimate case: EVERY pass produces one typed processor call
--     -> 1,728 calls/day. x3 headroom -> 5,184 calls/day default cap.
--   * Tokens. A typed call is capped at 1,800 completion tokens
--     (ai-agent-processor/index.ts) with a ~1,200-token prompt -> ~3,000
--     tokens/call -> 1,728 x 3,000 = 5,184,000 tokens/day from the loop.
--     Human deliverable sessions run up to 12,000 output tokens plus a
--     30,000-char query (~8,000 tokens) and ~2,000 tokens of KB context
--     ~= 22,000 tokens/call; 100 deliverables/day = 2,200,000.
--     Legitimate peak ~= 5,184,000 + 2,200,000 = 7,384,000 tokens/day.
--     x3 headroom -> 22,152,000; default cap rounded to 22,000,000.
--   These are ABUSE CAPS with headroom above the product's own loops, not
--   engineering thresholds; a tenant that legitimately needs more gets a row
--   in private.llm_org_quotas.
--
-- FAIL-CLOSED ON THE GATE, FAIL-SOFT ON THE TELEMETRY. The quota check is a
-- money cap: exceeding it, or being UNABLE TO READ it, must both refuse the
-- model call — a cost cap that fails open when its table is unreachable is
-- not a cap (the edge function documents the same choice). Recording usage
-- is the opposite: a telemetry insert failure must never fail or delay the
-- user's request, so edge functions wrap record_llm_usage in try/catch.
--
-- RACE NOTE. Two concurrent requests can both pass the SUM check and both
-- insert, overrunning the cap by at most (concurrent requests - 1) calls.
-- That overrun is bounded and acceptable for a daily cap; serializing every
-- model call through a lock is not.
--
-- PRIVACY. llm_usage stores counts and identifiers only — never prompt or
-- completion text.
-- ============================================================================

create schema if not exists private;

-- ----------------------------------------------------------------------------
-- 1. Usage — one row per model call
-- ----------------------------------------------------------------------------

create table if not exists private.llm_usage (
  id bigint generated always as identity primary key,
  -- Null for calls with no tenant scope (the anonymous public rail, internal
  -- service calls). Those are capped by the per-IP allowance instead.
  organization_id uuid,
  fn text not null,
  model text not null,
  prompt_tokens integer not null default 0 check (prompt_tokens >= 0),
  completion_tokens integer not null default 0 check (completion_tokens >= 0),
  created_at timestamptz not null default now()
);

comment on table private.llm_usage is
  'One row per LLM call: tenant, edge function, model, token counts. '
  'Counting source for check_llm_quota and for measured C$/tenant. '
  'Never stores prompt or completion text.';

-- The quota check is an indexed SUM over the current UTC day for one org.
create index if not exists idx_llm_usage_org_created
  on private.llm_usage (organization_id, created_at);

alter table private.llm_usage enable row level security;

-- ----------------------------------------------------------------------------
-- 2. Prices — vendor list rates, CAD per 1M tokens, with provenance
-- ----------------------------------------------------------------------------

create table if not exists private.llm_prices (
  model text primary key,
  input_cad_per_mtok numeric,
  output_cad_per_mtok numeric,
  source text not null,
  effective_date date not null
);

comment on table private.llm_prices is
  'Vendor list prices in CAD per 1M tokens. Every non-null rate cites the '
  'vendor pricing page URL and the FX source in `source`. A model whose rate '
  'could not be verified from the vendor is seeded with NULL rates — a NULL '
  'here means "unknown", never "free".';

alter table private.llm_prices enable row level security;

-- Rates verified 2026-08-19 from the vendors' own pricing pages (house rule:
-- vendor pages, never a registry):
--   OpenAI: https://developers.openai.com/api/docs/pricing (retrieved
--     2026-08-19): gpt-5.6-terra USD 2.00 in / 12.00 out per 1M;
--     gpt-5.6-luna USD 0.20 / 1.20; gpt-4o-mini USD 0.15 / 0.60.
--   xAI: https://docs.x.ai/docs/models (retrieved 2026-08-19):
--     grok-4.6 USD 2.00 in / 6.00 out per 1M (standard <200k-token tier);
--     grok-4.3 USD 1.25 / 2.50 (standard <200k-token tier).
--   FX: USD/CAD 1.3889, Bank of Canada daily average for 2026-08-18,
--     https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json
-- CAD = USD x 1.3889, e.g. terra input 2.00 x 1.3889 = 2.7778.
insert into private.llm_prices
  (model, input_cad_per_mtok, output_cad_per_mtok, source, effective_date)
values
  ('gpt-5.6-terra', 2.7778, 16.6668,
   'USD 2.00/12.00 per 1M: https://developers.openai.com/api/docs/pricing (2026-08-19); USD/CAD 1.3889 Bank of Canada 2026-08-18',
   '2026-08-19'),
  ('gpt-5.6-luna', 0.27778, 1.66668,
   'USD 0.20/1.20 per 1M: https://developers.openai.com/api/docs/pricing (2026-08-19); USD/CAD 1.3889 Bank of Canada 2026-08-18',
   '2026-08-19'),
  ('gpt-4o-mini', 0.208335, 0.83334,
   'USD 0.15/0.60 per 1M: https://developers.openai.com/api/docs/pricing (2026-08-19); USD/CAD 1.3889 Bank of Canada 2026-08-18',
   '2026-08-19'),
  ('grok-4.6', 2.7778, 8.3334,
   'USD 2.00/6.00 per 1M (<200k-token tier): https://docs.x.ai/docs/models (2026-08-19); USD/CAD 1.3889 Bank of Canada 2026-08-18',
   '2026-08-19'),
  ('grok-4.3', 1.736125, 3.47225,
   'USD 1.25/2.50 per 1M (<200k-token tier): https://docs.x.ai/docs/models (2026-08-19); USD/CAD 1.3889 Bank of Canada 2026-08-18',
   '2026-08-19')
on conflict (model) do nothing;

-- ----------------------------------------------------------------------------
-- 3. Per-organization overrides
-- ----------------------------------------------------------------------------

create table if not exists private.llm_org_quotas (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  max_calls_per_day integer check (max_calls_per_day > 0),
  max_tokens_per_day bigint check (max_tokens_per_day > 0),
  note text,
  updated_at timestamptz not null default now()
);

comment on table private.llm_org_quotas is
  'Per-tenant overrides of the default daily LLM caps. Null column = use the '
  'default. Written by operators with the service key only.';

alter table private.llm_org_quotas enable row level security;

-- ----------------------------------------------------------------------------
-- 4. The gate — SUM over the current UTC day vs override-or-default
-- ----------------------------------------------------------------------------

create or replace function public.check_llm_quota(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- Defaults sized in the header: 1,728 legitimate calls/day x3 = 5,184;
  -- ~7.384M legitimate tokens/day x3 ~= 22M.
  c_default_max_calls  constant integer := 5184;
  c_default_max_tokens constant bigint  := 22000000;
  v_max_calls  integer;
  v_max_tokens bigint;
  v_calls  bigint;
  v_tokens bigint;
  v_day_start timestamptz;
  v_resets_at timestamptz;
begin
  if p_organization_id is null then
    -- No tenant scope means no per-tenant budget to charge against. Callers
    -- must not use this function as an allowance for anonymous traffic —
    -- that is what the per-IP allowance is for.
    return jsonb_build_object('allowed', false, 'limit', 'organization_required');
  end if;

  select coalesce(q.max_calls_per_day, c_default_max_calls),
         coalesce(q.max_tokens_per_day, c_default_max_tokens)
    into v_max_calls, v_max_tokens
    from (select 1) one
    left join private.llm_org_quotas q on q.organization_id = p_organization_id;

  -- Defensive: a missing override row leaves the SELECT INTO with defaults.
  v_max_calls  := coalesce(v_max_calls, c_default_max_calls);
  v_max_tokens := coalesce(v_max_tokens, c_default_max_tokens);

  v_day_start := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_resets_at := v_day_start + interval '1 day';

  select count(*), coalesce(sum(prompt_tokens + completion_tokens), 0)
    into v_calls, v_tokens
    from private.llm_usage
   where organization_id = p_organization_id
     and created_at >= v_day_start;

  if v_calls >= v_max_calls then
    return jsonb_build_object(
      'allowed', false,
      'limit', 'max_calls_per_day',
      'calls_used', v_calls, 'max_calls', v_max_calls,
      'tokens_used', v_tokens, 'max_tokens', v_max_tokens,
      'resets_at', v_resets_at
    );
  end if;
  if v_tokens >= v_max_tokens then
    return jsonb_build_object(
      'allowed', false,
      'limit', 'max_tokens_per_day',
      'calls_used', v_calls, 'max_calls', v_max_calls,
      'tokens_used', v_tokens, 'max_tokens', v_max_tokens,
      'resets_at', v_resets_at
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'calls_used', v_calls, 'max_calls', v_max_calls,
    'tokens_used', v_tokens, 'max_tokens', v_max_tokens,
    'resets_at', v_resets_at
  );
end
$$;

comment on function public.check_llm_quota(uuid) is
  'Pre-model-call gate: current-UTC-day call and token totals for one tenant '
  'against private.llm_org_quotas override or the sized defaults. The caller '
  'must FAIL CLOSED both when allowed=false and when this call errors.';

revoke execute on function public.check_llm_quota(uuid) from public, anon, authenticated;
grant execute on function public.check_llm_quota(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 5. The telemetry insert — called fail-soft after every model call
-- ----------------------------------------------------------------------------

create or replace function public.record_llm_usage(
  p_organization_id uuid,
  p_fn text,
  p_model text,
  p_prompt_tokens integer,
  p_completion_tokens integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into private.llm_usage
    (organization_id, fn, model, prompt_tokens, completion_tokens)
  values (
    p_organization_id,
    coalesce(nullif(trim(p_fn), ''), 'unknown'),
    coalesce(nullif(trim(p_model), ''), 'unknown'),
    greatest(coalesce(p_prompt_tokens, 0), 0),
    greatest(coalesce(p_completion_tokens, 0), 0)
  );
end
$$;

comment on function public.record_llm_usage(uuid, text, text, integer, integer) is
  'One insert per model call. Edge functions call this in a try/catch: '
  'telemetry failure must never fail or delay the user request.';

revoke execute on function public.record_llm_usage(uuid, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.record_llm_usage(uuid, text, text, integer, integer) to service_role;

-- ----------------------------------------------------------------------------
-- 6. Per-IP allowance for the anonymous public rail
-- ----------------------------------------------------------------------------
-- Same table and same semantics as consume_public_reliability_allowance
-- (00000000000025_public_reliability_access.sql) — extended, not duplicated:
-- that function hard-caps p_limit at 10, which is correct for a per-browser
-- allowance but too small for a per-IP cap that must admit a NATed office.
-- Ceiling 100 keeps even a hostile IP bounded to two-digit daily spend.
create or replace function public.consume_public_reliability_ip_allowance(
  p_fingerprint_hash text,
  p_window_start timestamptz,
  p_limit integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count integer;
begin
  if length(p_fingerprint_hash) <> 64 or p_limit < 1 or p_limit > 100 then
    return false;
  end if;

  select run_count into current_count
  from public.public_reliability_rate_limits
  where fingerprint_hash = p_fingerprint_hash and window_start = p_window_start
  for update;

  if not found then
    insert into public.public_reliability_rate_limits (fingerprint_hash, window_start)
    values (p_fingerprint_hash, p_window_start);
    return true;
  end if;

  if current_count >= p_limit then return false; end if;

  update public.public_reliability_rate_limits
  set run_count = run_count + 1, last_run_at = now()
  where fingerprint_hash = p_fingerprint_hash and window_start = p_window_start;
  return true;
end;
$$;

comment on function public.consume_public_reliability_ip_allowance(text, timestamptz, integer) is
  'Per-IP daily counter for the anonymous public rail. The key is derived '
  'SERVER-SIDE from the client IP — never from any client-supplied value — '
  'so rotating a browserId cannot mint a fresh allowance.';

revoke execute on function public.consume_public_reliability_ip_allowance(text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.consume_public_reliability_ip_allowance(text, timestamptz, integer) to service_role;

-- ----------------------------------------------------------------------------
-- 7. Lock the private tables down explicitly
-- ----------------------------------------------------------------------------
-- The private schema is not exposed through PostgREST, RLS is enabled with no
-- policies (deny-all), and these revokes close the third door. Service-role
-- access flows through the SECURITY DEFINER functions above.
revoke all on private.llm_usage from public, anon, authenticated;
revoke all on private.llm_prices from public, anon, authenticated;
revoke all on private.llm_org_quotas from public, anon, authenticated;
