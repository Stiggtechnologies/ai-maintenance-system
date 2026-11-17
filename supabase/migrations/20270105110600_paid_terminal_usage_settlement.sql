-- Paid settlement cannot become a priced success without terminal metadata.
--
-- Replaces public.record_llm_usage(uuid, text, text, integer, integer, bigint, text).
-- No price, plan policy, or customer row is changed. A paid reservation whose
-- provider model is missing, or whose prompt and completion counts are missing
-- or both zero, is stored as unknown_price. When the service tier would
-- otherwise have been approved, pricing_mode_status becomes missing_tier so
-- the existing commercial-period freeze applies. The service_tier column still
-- stores the provider tier when one was returned.

create or replace function public.record_llm_usage(
  p_organization_id uuid,p_fn text,p_model text,p_prompt_tokens integer,
  p_completion_tokens integer,p_reservation_id bigint,p_service_tier text
) returns void
language plpgsql security definer set search_path=public,pg_temp
as $$
declare
  v_price private.llm_prices%rowtype;
  v_usage private.llm_usage%rowtype;
  v_prompt integer := greatest(coalesce(p_prompt_tokens,0),0);
  v_completion integer := greatest(coalesce(p_completion_tokens,0),0);
  v_actual_model text := coalesce(nullif(btrim(p_model),''),'unknown');
  v_priced_model text;
  v_cost numeric;
  v_status text;
  v_model_policy_status text;
  v_service_tier text := nullif(btrim(coalesce(p_service_tier,'')),'');
  v_pricing_mode_status text;
  v_billing_subscription_id uuid;
  v_terminal_metadata_missing boolean :=
    p_prompt_tokens is null
    or p_completion_tokens is null
    or (v_prompt = 0 and v_completion = 0)
    or nullif(btrim(coalesce(p_model,'')),'') is null
    or v_actual_model in ('unknown','pending');
begin
  v_priced_model := private.resolve_priced_llm_model(v_actual_model);
  select * into v_price from private.llm_prices
  where model=v_priced_model
    and input_cad_per_mtok is not null and output_cad_per_mtok is not null;
  if found then
    v_cost := (v_prompt::numeric*v_price.input_cad_per_mtok
      + v_completion::numeric*v_price.output_cad_per_mtok)/1000000;
    v_status := 'priced';
  else
    v_cost := null;
    v_status := 'unknown_price';
  end if;

  if p_reservation_id is not null then
    select * into v_usage from private.llm_usage
    where id=p_reservation_id and organization_id=p_organization_id
      and reserved
    for update;
    if found then
      v_model_policy_status := case
        when v_usage.billing_subscription_id is null then 'not_applicable'
        when cardinality(v_usage.commercial_allowed_models_snapshot)>0
          and v_priced_model=any(v_usage.commercial_allowed_models_snapshot)
          then 'approved'
        else 'unapproved_model'
      end;
      v_pricing_mode_status := case
        when v_usage.billing_subscription_id is null then 'not_applicable'
        when v_service_tier is null then 'missing_tier'
        when v_service_tier='default' then 'approved'
        else 'nonstandard_tier'
      end;
      if v_usage.billing_subscription_id is not null
        and (
          v_pricing_mode_status<>'approved'
          or v_terminal_metadata_missing
        ) then
        v_cost := null;
        v_status := 'unknown_price';
        if v_terminal_metadata_missing
          and v_pricing_mode_status='approved' then
          v_pricing_mode_status := 'missing_tier';
        end if;
      end if;
    end if;
    update private.llm_usage set
      fn=coalesce(nullif(btrim(p_fn),''),fn),
      requested_model=coalesce(requested_model,model),
      model=v_actual_model,priced_model=v_priced_model,
      prompt_tokens=v_prompt,completion_tokens=v_completion,reserved=false,
      model_policy_status=v_model_policy_status,
      service_tier=v_service_tier,
      pricing_mode_status=v_pricing_mode_status,
      input_cad_per_mtok=case when v_status='priced'
        then v_price.input_cad_per_mtok else null end,
      output_cad_per_mtok=case when v_status='priced'
        then v_price.output_cad_per_mtok else null end,
      price_effective_date=case when v_status='priced'
        then v_price.effective_date else null end,
      inference_cost_cad=v_cost,cost_status=v_status
    where id=p_reservation_id and organization_id=p_organization_id and reserved;
    if found then return; end if;
  end if;

  select billing_subscription_id into v_billing_subscription_id
  from private.llm_org_quotas where organization_id=p_organization_id;
  if v_billing_subscription_id is null then
    select id into v_billing_subscription_id
    from public.billing_subscriptions
    where organization_id=p_organization_id
      and billing_source='azure_marketplace' and status='active'
      and marketplace_status='Subscribed'
    order by updated_at desc,id
    limit 1;
  end if;
  v_model_policy_status := case
    when v_billing_subscription_id is null then 'not_applicable'
    else 'reservation_missing'
  end;
  v_pricing_mode_status := case
    when v_billing_subscription_id is null then 'not_applicable'
    when v_service_tier is null then 'missing_tier'
    when v_service_tier='default' then 'approved'
    else 'nonstandard_tier'
  end;
  if v_billing_subscription_id is not null
    and (
      v_pricing_mode_status<>'approved'
      or v_terminal_metadata_missing
    ) then
    v_cost := null;
    v_status := 'unknown_price';
    if v_terminal_metadata_missing and v_pricing_mode_status='approved' then
      v_pricing_mode_status := 'missing_tier';
    end if;
  end if;
  insert into private.llm_usage (
    organization_id,fn,model,prompt_tokens,completion_tokens,reserved,
    billing_subscription_id,priced_model,model_policy_status,
    service_tier,pricing_mode_status,
    input_cad_per_mtok,output_cad_per_mtok,price_effective_date,
    inference_cost_cad,cost_status
  ) values (
    p_organization_id,coalesce(nullif(btrim(p_fn),''),'unknown'),
    v_actual_model,v_prompt,v_completion,false,
    v_billing_subscription_id,v_priced_model,v_model_policy_status,
    v_service_tier,v_pricing_mode_status,
    case when v_status='priced' then v_price.input_cad_per_mtok else null end,
    case when v_status='priced' then v_price.output_cad_per_mtok else null end,
    case when v_status='priced' then v_price.effective_date else null end,
    v_cost,v_status
  );
end
$$;

revoke all on function public.record_llm_usage(
  uuid,text,text,integer,integer,bigint,text
) from public,anon,authenticated;
grant execute on function public.record_llm_usage(
  uuid,text,text,integer,integer,bigint,text
) to service_role;

comment on function public.record_llm_usage(
  uuid,text,text,integer,integer,bigint,text
) is 'Settles the canonical reservation with actual tokens and an immutable '
  'snapshot of the exact model price and CAD inference cost. A paid call '
  'missing terminal model or token metadata is unknown_price with '
  'pricing_mode_status missing_tier, not a priced success, and freezes later '
  'commercial-period spend. Provider-returned dated model IDs resolve only to '
  'their exact canonical price alias.';
