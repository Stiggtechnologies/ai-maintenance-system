-- ============================================================================
-- The auxiliary-fleet operator's unit-numbering scheme.
--
-- Stated by the asset owner on 2026-08-10 and recorded here verbatim in the
-- `source` column, because a numbering rule with no source is folklore.
--
--   5     dozers and wheel dozers
--   53    Caterpillar D8
--   55    Caterpillar D10
--   56    Caterpillar D11
--   6     backhoes, excavators and shovels — Komatsu, Hitachi AND Caterpillar
--   7     Caterpillar graders
--   72    Caterpillar 16H / 16M
--   73    Caterpillar 24H / 24M
--
-- THE 6-SERIES RULE CARRIES NO MANUFACTURER ON PURPOSE. The owner named three
-- possible makes for it, so the rule identifies the family and stops there.
-- Deriving one of the three would be worse than leaving it blank: a blank is
-- visibly missing, and a wrong make quietly poisons the shared-design
-- common-cause analysis in U3 and the sole-source analysis in E7.
--
-- The 20xx series (Transporter, Water Truck) has no rule because none was
-- given, and it is reported as unmatched rather than guessed at.
-- ============================================================================

do $$
declare
  v_org uuid := '5e08b0a4-bb63-43d6-90f8-e42d532f65fd';
  v_src text := 'Asset owner, stated 2026-08-10: "5 is dozer/wheel dozers, 53 Caterpillar D8, '
             || '55 Caterpillar D10, 56 cat D11; 6 is backhoes and excavators/shovels (Komatsu, '
             || 'Hitachi and Caterpillar); 7 is Caterpillar grader, 72 cat 16H/Ms, 73 is Cat 24H&Ms."';
begin
  if not exists (select 1 from organizations where id = v_org) then return; end if;

  insert into unit_numbering_rules (organization_id, number_prefix, expected_class,
    manufacturer, model, ambiguity_note, source)
  values
    -- Specific prefixes first; the resolver takes the longest match.
    (v_org, '53', null, 'Caterpillar', 'D8',  null, v_src),
    (v_org, '55', null, 'Caterpillar', 'D10', null, v_src),
    (v_org, '56', null, 'Caterpillar', 'D11', null, v_src),
    (v_org, '72', 'Grader', 'Caterpillar', '16H/16M', null, v_src),
    (v_org, '73', 'Grader', 'Caterpillar', '24H/24M', null, v_src),
    -- Family-level rules. The 6-series deliberately names no manufacturer.
    (v_org, '5',  null, null, null,
     'Dozers and wheel dozers. Make and model come from the two-digit prefix, not this rule.', v_src),
    (v_org, '6',  null, null, null,
     'Backhoes, excavators and shovels. The owner named Komatsu, Hitachi AND Caterpillar for this '
     || 'series, so no manufacturer can be derived from the number alone. Left blank deliberately: '
     || 'a blank is visibly missing, a wrong make is not.', v_src),
    (v_org, '7',  'Grader', 'Caterpillar', null,
     'Caterpillar graders. Model comes from the two-digit prefix.', v_src)
  on conflict (organization_id, number_prefix, effective_from) do update set
    expected_class = excluded.expected_class,
    manufacturer = excluded.manufacturer,
    model = excluded.model,
    ambiguity_note = excluded.ambiguity_note,
    source = excluded.source;
end $$;
