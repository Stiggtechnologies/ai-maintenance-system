-- ============================================================================
-- Correct the asset classes the numbering rules disagreed with.
--
-- apply_unit_numbering() REPORTS class disagreements and never corrects them,
-- because the rule may be incomplete or the class may be wrong and only a
-- person knows which. Here a person has said which.
--
-- The asset owner confirmed on 2026-08-10, after this platform raised the
-- discrepancy, that:
--
--   63xx, 64xx  are EXCAVATORS, not shovels
--   67xx        are CATERPILLAR LARGE WHEEL LOADERS, not shovels
--
-- The platform's evidence agreed in advance: 63 and 64 show heavy undercarriage
-- with boom/stick/bucket and zero tires, transmission, differential or
-- steering; 67 shows 38 transmission, 9 differential and 9 tires events across
-- 5 units with ZERO undercarriage. Thirteen of the fourteen assets labelled
-- "Shovel" were mislabelled; only 6601 keeps the label, and it has 21 work
-- orders — too few to say anything about.
--
-- THE OLD VALUE IS RECORDED. Every correction writes the superseded class into
-- derived_asset_attributes, so this is reversible and auditable rather than a
-- silent overwrite of the operator's own data.
-- ============================================================================

do $$
declare
  v_org uuid := '5e08b0a4-bb63-43d6-90f8-e42d532f65fd';
  r record;
  v_n int := 0;
begin
  if not exists (select 1 from organizations where id = v_org) then return; end if;

  for r in
    select a.id, a.name, a.asset_class old_class, ru.expected_class new_class,
           ru.number_prefix, ru.source
    from assets a
    join lateral (
      select * from unit_numbering_rules u
      where u.organization_id = a.organization_id
        and u.expected_class is not null
        and (regexp_match(a.name, '([0-9]{3,6})'))[1] like u.number_prefix || '%'
      order by length(u.number_prefix) desc, u.effective_from desc
      limit 1
    ) ru on true
    where a.organization_id = v_org
      and a.asset_class is not null
      and lower(a.asset_class) <> lower(ru.expected_class)
  loop
    -- Record what it was BEFORE changing it.
    insert into derived_asset_attributes (organization_id, asset_id, attribute,
      value, derived_from)
    values (v_org, r.id, 'asset_class:superseded', r.old_class,
            'Superseded on owner confirmation 2026-08-10 after the platform flagged that the '
            || 'recorded class disagreed with unit-numbering prefix ' || r.number_prefix
            || '. Previous value retained here so the change is reversible.');

    update assets set asset_class = r.new_class where id = r.id;

    insert into derived_asset_attributes (organization_id, asset_id, attribute,
      value, derived_from)
    values (v_org, r.id, 'asset_class', r.new_class,
            'Corrected from "' || r.old_class || '" on owner confirmation 2026-08-10. '
            || 'Rule source: ' || r.source);
    v_n := v_n + 1;
  end loop;

  raise notice 'Corrected % asset class(es).', v_n;
end $$;
