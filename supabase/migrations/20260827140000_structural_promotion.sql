-- ============================================================================
-- Promotion path for the structural lane: reviewed contributions into the
-- shared twin library (register U3 ontology, E12 master data, U19 AI governance).
--
-- THE GAP THIS CLOSES.
--
-- knowledge_contributions could accept a structural artefact — a component
-- breakdown, a failure-mode taxonomy — and route it through engineering review,
-- and then nothing happened. There was no path into asset_twin_templates, which
-- is the library those artefacts exist to fill. The whole lane stopped one step
-- short of being useful, and it is the lane carrying the actual value: the
-- operator fleet reads 95.1% nominal twin coverage and 13.9% meaningful,
-- because MIN-DOZER and MIN-GRADER carry no components and cover 117 of 144
-- machines.
--
-- WHY THIS LANE NEEDS NO k-ANONYMITY.
--
-- "A large track dozer has a final drive, and it fails by bearing spalling and
-- seal loss" is true whoever owns the machine. Pooling more contributors would
-- not make it safer because there is nothing to protect — no rate, no cost, no
-- fleet. What it needs instead is an engineer willing to sign that it is
-- correct, which is why review_state does the work here that thresholds do in
-- the statistical lane.
--
-- ATTRIBUTION IS DELIBERATELY WITHHELD.
--
-- The published template records that it came from a reviewed contribution and
-- does NOT name the contributor. This follows how equipment-reliability
-- consortia publish: the pooled library is attributed to the consortium, not to
-- the member who supplied a given entry. Naming them would disclose which
-- operator runs which machines and which of them is sharing knowledge — both
-- commercially sensitive, and neither necessary for the template to be
-- credible. The link is kept internally, because revocation needs it.
--
-- WITHDRAWAL, CONSISTENT WITH THE STATISTICAL LANE.
--
-- A reviewed and published template stands. An engineer signed it, and at that
-- point it is engineering knowledge rather than the contributor's data. The
-- provenance row is marked withdrawn so the position is auditable, and the
-- contributor is excluded from anything published afterwards.
--
-- Canonical reuse: asset_twin_templates and its maturity ladder from
-- 00000000000019, knowledge_contributions. Additive.
-- ============================================================================

-- Internal link between a published template and the contribution behind it.
-- No tenant-facing read policy: this is the attribution that is deliberately
-- not published, and a tenant reading it would learn exactly what withholding
-- attribution exists to prevent.
create table if not exists template_provenance (
  id bigserial primary key,
  template_id uuid not null references asset_twin_templates(id) on delete cascade,
  contribution_id bigint not null references knowledge_contributions(id),
  promoted_by uuid references auth.users(id),
  promoted_at timestamptz not null default now(),
  contribution_withdrawn_at timestamptz,
  note text,
  unique(template_id, contribution_id)
);

alter table template_provenance enable row level security;
-- No policy is created on purpose. Service-role only.

comment on table template_provenance is
  'Which contribution produced which published template. Intentionally has NO '
  'RLS read policy: attribution is withheld from the published library on the '
  'consortium model, and a tenant able to read this table would recover exactly '
  'what withholding it prevents. Kept because revocation needs the link.';

-- ---------------------------------------------------------------------------
-- Promote. Refuses far more often than it accepts.
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
  v_consent boolean;
  v_terms text;
  v_policy_terms text;
  v_existing asset_twin_templates%rowtype;
  v_new_id uuid;
  v_components int;
begin
  select * into k from knowledge_contributions where id = p_contribution_id;
  if not found then
    return query select 'error'::text, null::uuid, null::text, 'No such contribution.'::text;
    return;
  end if;

  if k.lane <> 'structural' then
    return query select 'refused'::text, null::uuid, null::text, format(
      'Contribution is in the %s lane. Only structural artefacts promote into the '
      || 'twin library; a fitted statistic belongs in a benchmark, where k-anonymity '
      || 'applies to it.', k.lane);
    return;
  end if;

  if k.withdrawn_at is not null then
    return query select 'refused'::text, null::uuid, null::text,
      'Contribution has been withdrawn.'::text;
    return;
  end if;

  -- Engineering review is this lane's entire gate. Without it a contributed
  -- breakdown would enter the shared library on the say-so of whoever uploaded
  -- it, and every tenant would inherit it.
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
      'Consent was given under terms "%s" and current terms are "%s". Consent does '
      || 'not carry across a terms change.', coalesce(v_terms,'(none)'), v_policy_terms);
    return;
  end if;

  -- A template with no components is the thing this whole lane exists to fix.
  -- Promoting one would add a shell to the library and count as progress.
  v_components := coalesce(jsonb_array_length(k.payload->'components'), 0);
  if v_components = 0 then
    return query select 'refused'::text, null::uuid, null::text,
      'The payload carries no components. A template without components is the '
      || 'shell this lane exists to replace, and publishing one would register as '
      || 'coverage while adding nothing to reason about.'::text;
    return;
  end if;

  select * into v_existing from asset_twin_templates
  where template_key = p_template_key
  order by created_at desc limit 1;

  insert into asset_twin_templates (
    template_key, version, asset_family, asset_class, title, description,
    maturity, template, evidence, supersedes_id, published_at
  ) values (
    p_template_key, p_version,
    coalesce(k.payload->>'family', 'unclassified'),
    coalesce(k.payload->>'name', p_template_key),
    coalesce(p_title, k.payload->>'name', p_template_key),
    k.payload->>'description',
    -- Never higher than the review it actually received. field_validated and
    -- approved mean something else and are not a migration's to grant.
    'engineer_reviewed',
    k.payload,
    jsonb_build_array(jsonb_build_object(
      'source', 'Contributed by a participating organization and engineer-reviewed',
      'title', 'Structural contribution, attribution withheld',
      'retrievedAt', now(),
      'confidence', 'engineer_reviewed',
      -- No organization is named. See the table comment on template_provenance.
      'note', 'Attribution is withheld on the consortium model: the shared library '
              || 'is credited to the programme, not to the member who supplied a '
              || 'given entry. The link is retained internally for revocation.'
    )),
    v_existing.id,
    now()
  )
  on conflict (template_key, version) do update set
    template = excluded.template,
    maturity = excluded.maturity,
    updated_at = now()
  returning id into v_new_id;

  insert into template_provenance (template_id, contribution_id, promoted_by)
  values (v_new_id, p_contribution_id, auth.uid())
  on conflict (template_id, contribution_id) do nothing;

  return query select 'promoted'::text, v_new_id,
    case when v_existing.id is not null
      then v_existing.template_key || ' ' || v_existing.version else null end,
    format(
      'Published %s %s at maturity engineer_reviewed with %s component(s)%s. '
      || 'Attribution is withheld: the library is credited to the programme, not to '
      || 'the contributor. Nothing here promotes further up the ladder — '
      || 'field_validated means somebody checked it against a real machine, and no '
      || 'function grants that.',
      p_template_key, p_version, v_components,
      case when v_existing.id is not null
        then format(', superseding %s', v_existing.version) else '' end);
end;
$$;

grant execute on function promote_structural_contribution(bigint, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Withdrawal of a structural contribution.
--
-- Consistent with the statistical lane and with the standard position: a
-- reviewed, published template stands. An engineer signed it, and a component
-- breakdown for a machine type is engineering knowledge rather than the
-- contributor's data. The provenance row records the withdrawal so the
-- position is auditable rather than assumed.
-- ---------------------------------------------------------------------------
create or replace function mark_structural_provenance_withdrawn()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.withdrawn_at is not null and old.withdrawn_at is null
     and new.lane = 'structural' then
    update template_provenance
      set contribution_withdrawn_at = now(),
          note = 'Contribution withdrawn after publication. The template stands: it '
                 || 'was engineer-reviewed before publication and describes a machine '
                 || 'type rather than the contributor''s operation. The contributor is '
                 || 'excluded from anything published subsequently.'
      where contribution_id = new.id and contribution_withdrawn_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_structural_withdrawal on knowledge_contributions;
create trigger trg_structural_withdrawal
  after update of withdrawn_at on knowledge_contributions
  for each row execute function mark_structural_provenance_withdrawn();

-- What is waiting for review or promotion, for the operator running the
-- programme. Counts only, no payloads — a queue view should not become a way to
-- read every tenant's contributions.
drop function if exists get_structural_pipeline();
create or replace function get_structural_pipeline()
returns table (
  "reviewState" text,
  contributions bigint,
  "readyToPromote" bigint,
  "alreadyPublished" bigint
)
language sql stable security definer set search_path = public as $$
  select k.review_state, count(*),
    count(*) filter (
      where k.review_state = 'engineer_reviewed'
        and k.withdrawn_at is null
        and not exists (select 1 from template_provenance tp where tp.contribution_id = k.id)),
    count(*) filter (
      where exists (select 1 from template_provenance tp where tp.contribution_id = k.id))
  from knowledge_contributions k
  where k.lane = 'structural'
    and k.organization_id = app_current_org()
  group by k.review_state
  order by 1;
$$;

grant execute on function get_structural_pipeline() to authenticated;

notify pgrst, 'reload schema';
