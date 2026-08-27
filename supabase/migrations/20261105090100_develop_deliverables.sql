-- ============================================================================
-- Sync Develop Slice 1 — Deliverables (D3.26, spec §8).
--
-- THE ONE NEW OBJECT of this slice band: a register row linking a gate
-- requirement to a real document. Everything it touches is a reuse:
--
--   * requirement_id  → stage_gate_criteria — the ONE requirement store
--                       (overlap-map ruling on D3.25; no parallel table);
--   * document_id     → kb_intake_documents — the ONE document intake rail
--                       (C2.15 ✅, 20261027090010). There is NO second upload
--                       path: a deliverable is SUBMITTED by attaching a
--                       document already ingested through kb_ingest_document,
--                       and the register row records the linkage;
--   * development_case_id → development_cases (D1.04).
--
-- Spec §8 fields carried: development_case_id, requirement_id, type, owner_id,
-- revision, status, required_date, accepted_date (as accepted_at, beside the
-- accepted_by the "who accepted, when" contract demands), source_system,
-- document_id. `title` is added beyond the spec minimum because a deliverable
-- register whose rows have no name is unusable as a register.
--
-- ACCEPTANCE IS A GOVERNED TRANSITION. Who accepted and when are structural:
-- the (status='accepted') ⇔ (accepted_at present) check is the same shape as
-- the sanction record on development_cases. The provenance trigger follows
-- the post-fix #282 idiom exactly (20261005090300 lineage): SECURITY INVOKER,
-- transaction-local marker set only by accept_deliverable, NULL-safe, no
-- silent overwrite (a terminal acceptance/rejection is immutable through the
-- RPC), service path admitted AND audited for insert, update and delete, and
-- BEFORE DELETE returns OLD so cascades and deliberate service deletes
-- proceed — audited, never silently cancelled.
--
-- Slice-1 segregation minimum: the deliverable's OWNER cannot accept their
-- own deliverable (spec §42, REQUESTER ≠ FINAL APPROVER applied at the
-- smallest honest scope). ai_admin is refused by name — acceptance feeds gate
-- readiness, and readiness inputs are human determinations.
--
-- An ACCEPTED deliverable's linkage feeds gate readiness: the workspace read
-- (20261105090500) rolls deliverables up per gate criterion, so a criterion
-- whose deliverable is accepted renders that state beside the finding — the
-- readiness rollup consumes it without inventing a number.
-- ============================================================================

create table if not exists public.develop_deliverables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  development_case_id uuid not null references development_cases(id) on delete cascade,
  -- A gate criterion of the case's framework, when the deliverable answers
  -- one; a case-level deliverable (null) is legitimate.
  requirement_id bigint references stage_gate_criteria(id) on delete set null,
  title text not null check (btrim(title) <> ''),
  type text not null check (btrim(type) <> ''),
  owner_id uuid not null references auth.users(id),
  revision text not null default 'A',
  status text not null default 'planned'
    check (status in ('planned','submitted','accepted','rejected')),
  required_date date,
  -- The governed acceptance record: who, when. Present exactly when accepted.
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  review_note text,
  source_system text,
  document_id uuid references kb_intake_documents(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deliverable_acceptance_recorded check (
    ((status = 'accepted') = (accepted_at is not null))
    and (status <> 'accepted' or accepted_by is not null)
  )
);

create index if not exists idx_deliverables_case
  on develop_deliverables(organization_id, development_case_id, status);
create index if not exists idx_deliverables_requirement
  on develop_deliverables(requirement_id) where requirement_id is not null;
create index if not exists idx_deliverables_due
  on develop_deliverables(organization_id, required_date)
  where status in ('planned','submitted','rejected');

alter table public.develop_deliverables enable row level security;
drop policy if exists develop_deliverables_read on public.develop_deliverables;
create policy develop_deliverables_read on public.develop_deliverables
  for select to authenticated using (organization_id = app_current_org());

-- ---------------------------------------------------------------------------
-- Acceptance provenance (the §70-idiom trigger, day one). SECURITY INVOKER on
-- purpose (20261005090100's argument, kept).
-- ---------------------------------------------------------------------------
create or replace function public.enforce_deliverable_acceptance_provenance()
returns trigger
language plpgsql
as $$
declare
  v_marker text := coalesce(current_setting('app.deliverable_review_write', true), '');
  v_client boolean := auth.uid() is not null;
  v_changed boolean;
  v_org uuid := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
begin
  if tg_op = 'INSERT' then
    v_changed := new.status in ('accepted','rejected')
              or new.accepted_by is not null
              or new.accepted_at is not null
              or nullif(btrim(coalesce(new.review_note, '')), '') is not null;
  elsif tg_op = 'DELETE' then
    -- Deleting an accepted deliverable erases the record of the acceptance.
    v_changed := old.status = 'accepted' or old.accepted_at is not null;
  else
    v_changed := (new.status is distinct from old.status
                  and (new.status in ('accepted','rejected')
                       or old.status in ('accepted','rejected')))
              or new.accepted_by is distinct from old.accepted_by
              or new.accepted_at is distinct from old.accepted_at
              or new.review_note is distinct from old.review_note;
  end if;

  if not v_changed then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Audited service path — admitted and audited for EVERY operation
  -- (20261005090300 §1). Org-exists guard for organization teardown.
  if not v_client and current_user not in ('authenticated', 'anon') then
    if exists (select 1 from organizations where id = v_org) then
      insert into security_events
        (organization_id, actor_id, actor_label, event_type, severity, detail)
      values
        (v_org, null, 'service (' || current_user || ')',
         'admin_action', 'warning',
         case tg_op
           when 'INSERT' then
             'Deliverable ' || new.id::text
               || ' inserted already carrying a review record by a service caller, '
               || 'bypassing accept_deliverable(). Status ' || coalesce(new.status, 'none') || '.'
           when 'DELETE' then
             'Accepted deliverable ' || old.id::text
               || ' deleted by a service caller — the acceptance record it carried is erased.'
           else
             'Review state on deliverable ' || new.id::text
               || ' written by a service caller, bypassing accept_deliverable(). Was '
               || coalesce(old.status, 'none') || ', now ' || coalesce(new.status, 'none') || '.'
         end);
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_marker <> 'granted' or current_user in ('authenticated', 'anon') then
    raise exception
      'Deliverable acceptance is a recorded human determination that feeds gate '
      'readiness. It cannot be written directly: call accept_deliverable(deliverable_id, '
      'decision, note), which verifies the reviewer''s role, refuses the deliverable''s '
      'own owner (segregation of duties), and records who accepted and when.'
      using errcode = 'insufficient_privilege';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists trg_deliverable_acceptance_provenance on public.develop_deliverables;
create trigger trg_deliverable_acceptance_provenance
  before insert or update or delete on public.develop_deliverables
  for each row execute function public.enforce_deliverable_acceptance_provenance();

revoke all on function public.enforce_deliverable_acceptance_provenance() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Register a deliverable on a case. Planning act — same role set as
-- create_development_case (ai_admin admitted: registration is preparation,
-- not determination).
-- ---------------------------------------------------------------------------
create or replace function public.create_case_deliverable(
  p_case_id uuid,
  p_title text,
  p_type text,
  p_owner_id uuid,
  p_requirement_id bigint default null,
  p_required_date date default null,
  p_source_system text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  c development_cases%rowtype;
  r stage_gate_criteria%rowtype;
  v_id uuid;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner') then
    return jsonb_build_object('error', 'registering a deliverable requires a planning, engineering or governance role');
  end if;
  select * into c from development_cases where id = p_case_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'development case not found');
  end if;
  if c.status not in ('active','on_hold','sanctioned') then
    return jsonb_build_object('error', 'deliverables are not registrable on a ' || c.status || ' case');
  end if;
  if coalesce(length(btrim(p_title)), 0) < 3 then
    return jsonb_build_object('error', 'a deliverable needs a title (3 characters minimum)');
  end if;
  if coalesce(btrim(p_type), '') = '' then
    return jsonb_build_object('error', 'state the deliverable type (report, drawing, study, plan, ...)');
  end if;
  if p_owner_id is null or not exists
     (select 1 from user_profiles where id = p_owner_id and organization_id = v_org) then
    return jsonb_build_object('error', 'the deliverable owner must be a member of this organization');
  end if;
  if p_requirement_id is not null then
    select * into r from stage_gate_criteria
    where id = p_requirement_id and organization_id = v_org;
    if not found then
      return jsonb_build_object('error', 'gate requirement not found in this organization');
    end if;
    -- A gate-scoped criterion must belong to THIS case's governing framework;
    -- linking another framework's requirement would feed the wrong gate.
    if r.gate_id is not null and (c.framework_id is null or not exists (
      select 1 from stage_gates g
      where g.id = r.gate_id and g.framework_id = c.framework_id
    )) then
      return jsonb_build_object('error',
        'that requirement belongs to a gate outside this case''s governing framework');
    end if;
  end if;

  insert into develop_deliverables
    (organization_id, development_case_id, requirement_id, title, type,
     owner_id, required_date, source_system, created_by)
  values
    (v_org, c.id, p_requirement_id, btrim(p_title), btrim(p_type),
     p_owner_id, p_required_date,
     nullif(btrim(coalesce(p_source_system, '')), ''), auth.uid())
  returning id into v_id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'case_deliverable', coalesce(v_role, 'unknown'),
    jsonb_build_object('deliverable_id', v_id, 'case_id', c.id,
      'action', 'registered', 'requirement_id', p_requirement_id,
      'type', btrim(p_type)));

  return jsonb_build_object('deliverable_id', v_id, 'case_id', c.id, 'status', 'planned');
end
$$;

revoke all on function public.create_case_deliverable(uuid, text, text, uuid, bigint, date, text) from public, anon;
grant execute on function public.create_case_deliverable(uuid, text, text, uuid, bigint, date, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Submit: attach an INGESTED document and move to 'submitted'. The document
-- must already exist in the tenant's kb_intake_documents register — the
-- C2.15 rail is the only door; this function refuses to be a second one.
-- The owner may submit their own deliverable whatever their role.
-- ---------------------------------------------------------------------------
create or replace function public.submit_deliverable(
  p_deliverable_id uuid,
  p_document_id uuid,
  p_revision text default null,
  p_source_system text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  d develop_deliverables%rowtype;
  doc kb_intake_documents%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  select * into d from develop_deliverables
  where id = p_deliverable_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'deliverable not found');
  end if;
  if coalesce(v_role, '') not in
     ('admin','ai_admin','executive','maintenance_manager','reliability_engineer','planner')
     and auth.uid() is distinct from d.owner_id then
    return jsonb_build_object('error',
      'submitting this deliverable requires a planning, engineering or governance role — or being its owner');
  end if;
  if d.status = 'accepted' then
    return jsonb_build_object('error',
      'an accepted deliverable is a record — it cannot be resubmitted; register a new deliverable for new content');
  end if;
  if p_document_id is null then
    return jsonb_build_object('error',
      'a submission attaches the document — ingest it through the knowledge-base intake (kb_ingest_document) and pass its id');
  end if;
  select * into doc from kb_intake_documents
  where id = p_document_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error',
      'document not found in this organization''s intake register — the KB intake (C2.15) is the one document rail');
  end if;

  update develop_deliverables
  set status = 'submitted',
      document_id = doc.id,
      revision = coalesce(nullif(btrim(coalesce(p_revision, '')), ''), revision),
      source_system = coalesce(nullif(btrim(coalesce(p_source_system, '')), ''), source_system, 'kb_document_intake'),
      updated_at = now()
  where id = d.id;

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'case_deliverable', coalesce(v_role, 'unknown'),
    jsonb_build_object('deliverable_id', d.id, 'case_id', d.development_case_id,
      'action', 'submitted', 'document_id', doc.id, 'document_title', doc.title,
      'revision', coalesce(nullif(btrim(coalesce(p_revision, '')), ''), d.revision)));

  return jsonb_build_object('deliverable_id', d.id, 'status', 'submitted',
    'document_id', doc.id, 'document_title', doc.title);
end
$$;

revoke all on function public.submit_deliverable(uuid, uuid, text, text) from public, anon;
grant execute on function public.submit_deliverable(uuid, uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The governed transition: accept or reject a SUBMITTED deliverable.
-- Roles: governance/engineering. ai_admin refused by name. Owner refused
-- (segregation of duties, slice-1 minimum). Terminal states immutable here —
-- a rejected deliverable is resubmitted (new revision), never re-reviewed in
-- place; an accepted one is never overwritten.
-- ---------------------------------------------------------------------------
create or replace function public.accept_deliverable(
  p_deliverable_id uuid,
  p_decision text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := app_current_org();
  v_role text;
  d develop_deliverables%rowtype;
begin
  if v_org is null then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select role into v_role from user_profiles where id = auth.uid();
  if coalesce(v_role, '') not in ('admin','executive','maintenance_manager','reliability_engineer') then
    if coalesce(v_role, '') = 'ai_admin' then
      return jsonb_build_object('error',
        'deliverable acceptance feeds gate readiness and is a human determination — the AI-operator identity cannot record one');
    end if;
    return jsonb_build_object('error', 'accepting a deliverable requires a governance or engineering role');
  end if;
  select * into d from develop_deliverables
  where id = p_deliverable_id and organization_id = v_org;
  if not found then
    return jsonb_build_object('error', 'deliverable not found');
  end if;
  if d.status <> 'submitted' then
    return jsonb_build_object('error',
      format('only a submitted deliverable can be reviewed — this one is %s%s', d.status,
        case when d.status = 'accepted' then ' and an acceptance is not overwritable' else '' end));
  end if;
  if d.document_id is null then
    return jsonb_build_object('error',
      'this deliverable has no attached document — acceptance is a judgement on submitted content, not on a status');
  end if;
  if auth.uid() = d.owner_id then
    return jsonb_build_object('error',
      'the deliverable''s owner cannot accept their own deliverable (segregation of duties)');
  end if;
  if p_decision not in ('accepted','rejected') then
    return jsonb_build_object('error', 'decision must be accepted or rejected');
  end if;
  if p_decision = 'rejected' and coalesce(length(btrim(p_note)), 0) < 10 then
    return jsonb_build_object('error',
      'a rejection states what is missing or wrong (10 characters minimum)');
  end if;

  -- The sanctioned write. Local marker: cannot outlive this transaction.
  perform set_config('app.deliverable_review_write', 'granted', true);

  update develop_deliverables
  set status = p_decision,
      accepted_by = case when p_decision = 'accepted' then auth.uid() else null end,
      accepted_at = case when p_decision = 'accepted' then now() else null end,
      review_note = nullif(btrim(coalesce(p_note, '')), ''),
      updated_at = now()
  where id = d.id;

  perform set_config('app.deliverable_review_write', '', true);

  insert into audit_events (organization_id, entity_type, actor, event_data)
  values (v_org, 'case_deliverable', coalesce(v_role, 'unknown'),
    jsonb_build_object('deliverable_id', d.id, 'case_id', d.development_case_id,
      'action', p_decision, 'requirement_id', d.requirement_id,
      'document_id', d.document_id, 'note', nullif(btrim(coalesce(p_note, '')), '')));

  insert into security_events
    (organization_id, actor_id, actor_label, event_type, severity, detail)
  values
    (v_org, auth.uid(),
     (select coalesce(p.full_name, u.email) from auth.users u
        left join user_profiles p on p.id = u.id where u.id = auth.uid()),
     'admin_action', 'notice',
     format('Deliverable "%s" %s by role %s on case %s.',
            d.title, p_decision, coalesce(v_role, 'none'), d.development_case_id));

  return jsonb_build_object('deliverable_id', d.id, 'status', p_decision,
    'accepted_by', case when p_decision = 'accepted' then auth.uid() else null end);
end
$$;

revoke all on function public.accept_deliverable(uuid, text, text) from public, anon;
grant execute on function public.accept_deliverable(uuid, text, text) to authenticated;

notify pgrst, 'reload schema';
