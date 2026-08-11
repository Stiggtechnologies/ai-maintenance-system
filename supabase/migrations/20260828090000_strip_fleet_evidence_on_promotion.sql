-- ============================================================================
-- Strip fleet measurements from a structural payload before it is published.
--
-- THE LEAK.
--
-- promote_structural_contribution() copied knowledge_contributions.payload
-- verbatim into asset_twin_templates.template, which carries RLS `using (true)`
-- and is read by every tenant. A template derived from work-order history
-- carries per-component evidence — event counts, downtime hours, downtime share
-- — and those are measurements of the contributing operation, not facts about
-- the machine type.
--
-- The first real draft made this obvious: promoting it would have published
-- "Undercarriage: 382 events, 29,822.4 downtime hours, 43.2% of downtime" to
-- every customer. No organization is named, but that is a fleet's availability
-- profile, it is commercially sensitive, and in a market with a handful of
-- operators it is a quasi-identifier. It is precisely the class of number the
-- statistical lane demands k-anonymity for — it simply arrived inside a
-- structural payload, where no threshold was watching.
--
-- THE DISTINCTION BEING DRAWN.
--
--   "A large track dozer has an undercarriage, and it is typically the largest
--    single contributor to downtime on the machine."   -> machine-type fact,
--    publishable, and genuinely useful to a reviewer.
--
--   "Undercarriage: 29,822.4 hours across 382 events."  -> a measurement of one
--    operator's fleet. Belongs in their tenant.
--
-- So rank ORDER survives promotion and absolute magnitude does not. The
-- contribution keeps its full evidence inside the tenant, where it is exactly
-- what a reviewer needs in order to check the draft.
-- ============================================================================

create or replace function sanitise_structural_payload(p_payload jsonb)
returns jsonb
language sql immutable set search_path = public as $$
  select case
    when p_payload->'components' is null then p_payload
    else jsonb_set(
      p_payload,
      '{components}',
      (
        select coalesce(jsonb_agg(
          -- Drop the evidence object entirely and replace it with the rank the
          -- component held. Rank is ordinal and says which component matters
          -- most; hours and counts are the contributor's operating data.
          (c - 'evidence') || jsonb_build_object(
            'consequenceRank', rn,
            'evidenceNote',
              'Component identified and ranked from the contributing '
              || 'organization''s work-order history. Absolute event counts and '
              || 'downtime hours are withheld: rank order is a property of the '
              || 'machine type, magnitude is a measurement of one fleet.'
          )
          order by rn
        ), '[]'::jsonb)
        from (
          select c, row_number() over (
            order by coalesce((c->'evidence'->>'downtimeHours')::numeric, 0) desc
          ) rn
          from jsonb_array_elements(p_payload->'components') c
        ) ranked
      )
    )
  end;
$$;

comment on function sanitise_structural_payload(jsonb) is
  'Removes per-component fleet measurements before a structural contribution is '
  'published to the shared library, preserving consequence RANK. The tenant''s '
  'own contribution row keeps its full evidence — this only affects what crosses.';

-- ---------------------------------------------------------------------------
-- Rebuild promotion around the sanitiser.
-- ---------------------------------------------------------------------------
drop function if exists promote_structural_contribution(bigint, text, text, text);
create or replace function promote_structural_contribution(
  p_contribution_id bigint,
  p_template_key text,
  p_version text,
  p_title text default null
)
returns table (outcome text, "templateId" uuid, supersedes text, detail text)
language plpgsql security definer set search_path = public as $$
declare
  k knowledge_contributions%rowtype;
  v_consent boolean; v_terms text; v_policy_terms text;
  v_existing asset_twin_templates%rowtype;
  v_new_id uuid;
  v_components int;
  v_clean jsonb;
begin
  select * into k from knowledge_contributions where id = p_contribution_id;
  if not found then
    return query select 'error'::text, null::uuid, null::text, 'No such contribution.'::text;
    return;
  end if;
  if k.lane <> 'structural' then
    return query select 'refused'::text, null::uuid, null::text, format(
      'Contribution is in the %s lane. Only structural artefacts promote into the '
      || 'twin library.', k.lane);
    return;
  end if;
  if k.withdrawn_at is not null then
    return query select 'refused'::text, null::uuid, null::text,
      'Contribution has been withdrawn.'::text;
    return;
  end if;
  if k.review_state <> 'engineer_reviewed' then
    return query select 'refused'::text, null::uuid, null::text, format(
      'Contribution is "%s". A structural artefact carries no k-anonymity '
      || 'requirement precisely because engineering review is what makes it safe '
      || 'to share — so review is not optional here, it is the only gate there is.',
      k.review_state);
    return;
  end if;

  select c.structural_consent, c.terms_version into v_consent, v_terms
  from contribution_consent c where c.organization_id = k.organization_id;
  select terms_version into v_policy_terms
  from contribution_policy where policy_key = 'default';

  if not coalesce(v_consent, false) then
    return query select 'refused'::text, null::uuid, null::text,
      'The contributing organization has not consented to structural contribution.'::text;
    return;
  end if;
  if v_terms is distinct from v_policy_terms then
    return query select 'refused'::text, null::uuid, null::text, format(
      'Consent was given under terms "%s" and current terms are "%s".',
      coalesce(v_terms,'(none)'), v_policy_terms);
    return;
  end if;

  v_components := coalesce(jsonb_array_length(k.payload->'components'), 0);
  if v_components = 0 then
    return query select 'refused'::text, null::uuid, null::text,
      'The payload carries no components. A template without components is the '
      || 'shell this lane exists to replace.'::text;
    return;
  end if;

  -- Sanitise BEFORE anything is written, so there is no window in which the
  -- unsanitised payload exists in a globally-readable table.
  v_clean := sanitise_structural_payload(k.payload);

  select * into v_existing from asset_twin_templates
  where template_key = p_template_key order by created_at desc limit 1;

  insert into asset_twin_templates (
    template_key, version, asset_family, asset_class, title, description,
    maturity, template, evidence, supersedes_id, published_at
  ) values (
    p_template_key, p_version,
    coalesce(k.payload->>'family', 'unclassified'),
    coalesce(k.payload->>'name', p_template_key),
    coalesce(p_title, k.payload->>'name', p_template_key),
    k.payload->>'description',
    'engineer_reviewed',
    v_clean,
    jsonb_build_array(jsonb_build_object(
      'source', 'Contributed by a participating organization and engineer-reviewed',
      'title', 'Structural contribution, attribution withheld',
      'retrievedAt', now(),
      'confidence', 'engineer_reviewed',
      'note', 'Attribution is withheld on the consortium model. Per-component '
              || 'event counts and downtime hours were removed before publication: '
              || 'consequence rank is a property of the machine type, magnitude is '
              || 'a measurement of the contributing fleet.'
    )),
    v_existing.id, now()
  )
  on conflict (template_key, version) do update set
    template = excluded.template, maturity = excluded.maturity, updated_at = now()
  returning id into v_new_id;

  insert into template_provenance (template_id, contribution_id, promoted_by)
  values (v_new_id, p_contribution_id, auth.uid())
  on conflict (template_id, contribution_id) do nothing;

  return query select 'promoted'::text, v_new_id,
    case when v_existing.id is not null
      then v_existing.template_key || ' ' || v_existing.version else null end,
    format(
      'Published %s %s at engineer_reviewed with %s component(s)%s. Fleet '
      || 'measurements stripped — components carry a consequence rank, not hours. '
      || 'Attribution withheld. Nothing promotes past engineer_reviewed.',
      p_template_key, p_version, v_components,
      case when v_existing.id is not null
        then format(', superseding %s', v_existing.version) else '' end);
end;
$$;

grant execute on function promote_structural_contribution(bigint, text, text, text) to authenticated;

notify pgrst, 'reload schema';
