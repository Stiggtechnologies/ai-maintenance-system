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
-- CONCURRENCY. The gate is a check-AND-RESERVE, not a bare SUM: under a
-- per-organization advisory transaction lock it sums the day's usage
-- (settled rows AND open reservations), refuses if over budget, and
-- otherwise inserts a reservation row carrying a conservative-high token
-- estimate before returning. A burst of N concurrent requests therefore
-- serializes through the gate (the lock is held only for the SUM + one
-- INSERT, never for the model call itself) and each request sees every
-- earlier reservation — the daily token cap is a hard bound, not a
-- read-then-write race. record_llm_usage settles the reservation with the
-- actual token counts; release_llm_reservation deletes it when the provider
-- call failed and returned no usage.
--
-- NOTE ON WHAT COUNTS. check_llm_quota sums ALL of llm_usage for the org,
-- so the enrichment loops (agent-loop-enrich, batch limit 5 every 10 min =
-- at most 720 calls/day GLOBALLY; onboarding-enrich, 1 asset every 15 min =
-- at most 96/day) also draw down tenant budget when they record with a real
-- organization_id. Even if one tenant absorbed every enrichment call that
-- is ~816 calls (~16% of the call cap) and ~1.6M tokens (~7% of the token
-- cap) — inside the x3 headroom above, by design.
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
  -- True while the row is a pre-call reservation holding an ESTIMATE;
  -- record_llm_usage flips it to false with the actual counts, and
  -- release_llm_reservation deletes it if the provider call failed.
  reserved boolean not null default false,
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
-- 4. The gate — atomic check-AND-RESERVE under a per-org advisory lock
-- ----------------------------------------------------------------------------

create or replace function public.check_llm_quota(
  p_organization_id uuid,
  p_fn text default 'unknown',
  p_model text default 'pending',
  p_estimated_tokens bigint default 0
)
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
  v_estimate integer;
  v_day_start timestamptz;
  v_resets_at timestamptz;
  v_reservation_id bigint;
begin
  if p_organization_id is null then
    -- No tenant scope means no per-tenant budget to charge against. Callers
    -- must not use this function as an allowance for anonymous traffic —
    -- that is what the per-IP allowance is for.
    return jsonb_build_object('allowed', false, 'limit', 'organization_required');
  end if;

  -- Serialize GATE EVALUATION (never the model call) per organization.
  -- Without this, N concurrent requests all read the same pre-insert totals
  -- and all pass — a midnight burst could overrun the daily token cap by
  -- its entire in-flight concurrency before the first usage row landed.
  -- The lock covers one SUM and one INSERT (milliseconds) and releases at
  -- transaction end.
  perform pg_advisory_xact_lock(
    hashtextextended('llm_quota:' || p_organization_id::text, 0)
  );

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
  v_estimate  := least(greatest(coalesce(p_estimated_tokens, 0), 0), 2000000000)::integer;

  -- Open reservations are ordinary rows here, so a concurrent request that
  -- already reserved (and holds nothing — the lock is released) is counted.
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
  -- The estimate participates in the token check, so the cap bounds what the
  -- approved call COULD spend, not just what earlier calls already spent.
  if v_tokens >= v_max_tokens or v_tokens + v_estimate > v_max_tokens then
    return jsonb_build_object(
      'allowed', false,
      'limit', 'max_tokens_per_day',
      'calls_used', v_calls, 'max_calls', v_max_calls,
      'tokens_used', v_tokens, 'max_tokens', v_max_tokens,
      'resets_at', v_resets_at
    );
  end if;

  -- Reserve: the estimate is held against the budget until the caller
  -- settles it (record_llm_usage) or releases it (release_llm_reservation).
  insert into private.llm_usage
    (organization_id, fn, model, prompt_tokens, completion_tokens, reserved)
  values (
    p_organization_id,
    coalesce(nullif(trim(p_fn), ''), 'unknown'),
    coalesce(nullif(trim(p_model), ''), 'pending'),
    0,
    v_estimate,
    true
  )
  returning id into v_reservation_id;

  return jsonb_build_object(
    'allowed', true,
    'reservation_id', v_reservation_id,
    'calls_used', v_calls, 'max_calls', v_max_calls,
    'tokens_used', v_tokens, 'max_tokens', v_max_tokens,
    'resets_at', v_resets_at
  );
end
$$;

comment on function public.check_llm_quota(uuid, text, text, bigint) is
  'Pre-model-call gate AND reservation: under a per-org advisory lock, sums '
  'the current UTC day (settled usage plus open reservations) against '
  'private.llm_org_quotas override or the sized defaults, and on success '
  'inserts a reservation row holding the caller''s conservative token '
  'estimate. The caller must FAIL CLOSED both when allowed=false and when '
  'this call errors, settle via record_llm_usage(p_reservation_id), and '
  'release via release_llm_reservation when the provider call failed.';

revoke execute on function public.check_llm_quota(uuid, text, text, bigint) from public, anon, authenticated;
grant execute on function public.check_llm_quota(uuid, text, text, bigint) to service_role;

-- ----------------------------------------------------------------------------
-- 5. The telemetry insert — called fail-soft after every model call
-- ----------------------------------------------------------------------------

create or replace function public.record_llm_usage(
  p_organization_id uuid,
  p_fn text,
  p_model text,
  p_prompt_tokens integer,
  p_completion_tokens integer,
  p_reservation_id bigint default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_reservation_id is not null then
    -- Settle the reservation opened by check_llm_quota: replace the estimate
    -- with the actual counts. Only an OPEN reservation is settled — settling
    -- twice, or settling a released id, falls through to a plain insert so
    -- the call is still counted.
    update private.llm_usage
       set fn = coalesce(nullif(trim(p_fn), ''), fn),
           model = coalesce(nullif(trim(p_model), ''), 'unknown'),
           prompt_tokens = greatest(coalesce(p_prompt_tokens, 0), 0),
           completion_tokens = greatest(coalesce(p_completion_tokens, 0), 0),
           reserved = false
     where id = p_reservation_id
       and reserved = true;
    if found then
      return;
    end if;
  end if;

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

comment on function public.record_llm_usage(uuid, text, text, integer, integer, bigint) is
  'One row per model call. With p_reservation_id, settles the reservation '
  'opened by check_llm_quota (estimate -> actual); without it, plain insert. '
  'Edge functions call this in a try/catch: telemetry failure must never '
  'fail or delay the user request.';

revoke execute on function public.record_llm_usage(uuid, text, text, integer, integer, bigint) from public, anon, authenticated;
grant execute on function public.record_llm_usage(uuid, text, text, integer, integer, bigint) to service_role;

-- Release a reservation whose provider call FAILED and returned no usage.
-- Deliberately deletes only OPEN reservations: a settled row (actual spend)
-- can never be released. If the edge function crashes before either settle
-- or release, the reservation simply stands for the rest of the UTC day —
-- an overcount in the fail-closed direction, never an undercount.
create or replace function public.release_llm_reservation(
  p_reservation_id bigint
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from private.llm_usage
   where id = p_reservation_id
     and reserved = true;
end
$$;

comment on function public.release_llm_reservation(bigint) is
  'Deletes an OPEN quota reservation after a failed provider call (no usage '
  'to settle). Settled rows are untouchable — spend is never un-counted.';

revoke execute on function public.release_llm_reservation(bigint) from public, anon, authenticated;
grant execute on function public.release_llm_reservation(bigint) to service_role;

-- ----------------------------------------------------------------------------
-- 6. Per-IP allowance for the anonymous public rail
-- ----------------------------------------------------------------------------
-- Same table and same semantics as consume_public_reliability_allowance
-- (00000000000025_public_reliability_access.sql) — extended, not duplicated:
-- that function hard-caps p_limit at 10, which is correct for a per-browser
-- allowance but too small for a per-IP cap sized as a multiple of it.
-- Ceiling 100 keeps even a hostile IP bounded to two-digit daily spend.
-- Sizing honesty: the assessment cap (5/IP/day) admits five distinct
-- browsers behind one NAT per day, not a whole office — a deliberate
-- spend-bound tradeoff on a free anonymous rail, chosen over a ceiling
-- large enough to make a hostile IP expensive.
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
