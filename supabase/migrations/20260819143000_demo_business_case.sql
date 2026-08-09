-- ============================================================================
-- Demo business case and capital plan, Fort McMurray demo organization only.
--
-- ILLUSTRATIVE DATA, DEMO-prefixed. The private operator organization gets
-- nothing and its posture line says so.
--
-- The case is built so the arithmetic bites: a refurbishment with a 7-year
-- life against a replacement with a 20-year life. On raw NPV the replacement
-- wins by lasting longer. On equivalent annual value — the correct basis when
-- lives differ — the ranking is genuinely contested, which is the situation
-- the engine exists to make visible rather than resolve by accident.
--
-- The capital plan is built so that ranking by benefit picks one large item
-- and ranking by benefit-per-pound picks two smaller ones worth more together.
-- ============================================================================
do $$
declare
  v_org uuid := '11111111-1111-1111-1111-111111111111';
  v_case bigint; v_proj bigint; v_asset uuid;
begin
  if not exists (select 1 from organizations where id = v_org) then return; end if;
  if exists (select 1 from business_cases where organization_id = v_org) then return; end if;

  select id into v_proj from capital_projects where organization_id = v_org limit 1;
  select id into v_asset from assets where organization_id = v_org and tag = 'C-22' limit 1;

  insert into financial_assumptions (organization_id, assumption_key, label, value, unit,
    source, review_due)
  values
    (v_org, 'discount_rate', 'Corporate real discount rate', 0.08, 'fraction',
     'DEMO — group finance policy 2026', current_date + 300),
    (v_org, 'production_value_per_hour', 'Value of an hour of throughput', 42000, 'USD/h',
     'DEMO — mine plan, average realised margin', current_date + 300),
    (v_org, 'labour_rate', 'Fully burdened maintenance labour rate', 145, 'USD/h',
     'DEMO — 2026 rate card', null);

  insert into business_cases (organization_id, project_id, asset_id, case_ref, title,
    driver, discount_rate, discount_rate_source, status)
  values (v_org, v_proj, v_asset, 'DEMO-BC-01',
          'DEMO — Conveyor CV-01: refurbish or replace',
          'reliability', 0.08, 'DEMO — group finance policy 2026', 'submitted')
  returning id into v_case;

  insert into business_case_options (organization_id, case_id, label, life_periods,
    cash_flows, benefit_probability, is_do_nothing, notes)
  values
    (v_org, v_case, 'Do nothing', 7,
     '[{"period":0,"amount":0},{"period":1,"amount":-850000},{"period":2,"amount":-900000},
       {"period":3,"amount":-950000},{"period":4,"amount":-1050000},{"period":5,"amount":-1150000},
       {"period":6,"amount":-1300000},{"period":7,"amount":-1500000}]'::jsonb,
     1.0, true,
     'DEMO — rising corrective cost and lost throughput as the belt and idlers degrade.'),
    (v_org, v_case, 'Refurbish', 7,
     '[{"period":0,"amount":-2400000},{"period":1,"amount":-300000},{"period":2,"amount":-310000},
       {"period":3,"amount":-330000},{"period":4,"amount":-360000},{"period":5,"amount":-400000},
       {"period":6,"amount":-460000},{"period":7,"amount":-540000}]'::jsonb,
     0.85, false,
     'DEMO — belt, idlers and drive refurbishment. Benefit probability reflects unknown structural condition.'),
    (v_org, v_case, 'Replace', 20,
     '[{"period":0,"amount":-7800000},{"period":1,"amount":-180000},{"period":2,"amount":-185000},
       {"period":3,"amount":-190000},{"period":4,"amount":-195000},{"period":5,"amount":-200000},
       {"period":6,"amount":-210000},{"period":7,"amount":-215000},{"period":8,"amount":-225000},
       {"period":9,"amount":-235000},{"period":10,"amount":-245000},{"period":11,"amount":-255000},
       {"period":12,"amount":-265000},{"period":13,"amount":-280000},{"period":14,"amount":-295000},
       {"period":15,"amount":-310000},{"period":16,"amount":-330000},{"period":17,"amount":-350000},
       {"period":18,"amount":-370000},{"period":19,"amount":-395000},{"period":20,"amount":-420000}]'::jsonb,
     0.95, false,
     'DEMO — full replacement with a wider belt. Twenty-year life, so NOT comparable to the others on NPV.');

  -- A capital plan where benefit-ranking and ratio-ranking disagree.
  insert into capital_plan_items (organization_id, plan_year, case_id, label, cost,
    benefit_present_value, mandatory, mandatory_basis)
  values
    (v_org, 2027, v_case, 'DEMO — Conveyor CV-01 refurbishment', 2400000, 3100000, false, null),
    (v_org, 2027, null, 'DEMO — Crusher liner redesign', 1200000, 2050000, false, null),
    (v_org, 2027, null, 'DEMO — Dust suppression upgrade', 1150000, 1900000, false, null),
    (v_org, 2027, null, 'DEMO — Statutory pressure-vessel recertification', 600000, null, true,
     'DEMO — provincial boiler and pressure vessel regulation; not discretionary.');

  insert into budget_lines (organization_id, budget_year, category, budgeted, committed,
    actual, forecast, forecast_basis)
  values
    (v_org, 2026, 'labour', 4200000, 3100000, 2950000, 4350000,
     'DEMO — run-rate to date plus committed overtime for the shutdown.'),
    (v_org, 2026, 'materials', 2800000, 2400000, 2150000, 3050000,
     'DEMO — includes the long-lead final drive ordered in Q2.'),
    (v_org, 2026, 'contract', 1900000, 1500000, 1420000, null, null);
end $$;
