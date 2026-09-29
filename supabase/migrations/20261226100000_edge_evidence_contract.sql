-- ============================================================================
-- Hardware-neutral Edge Evidence Contract.
--
-- This is the governed seam between a low-power inference device (including a
-- future Coral NPU implementation) and SyncAI.  It deliberately does not make
-- the device an autonomous actor.  A valid signature admits an observation as
-- UNVERIFIED AI_INFERENCE evidence; it cannot verify evidence, create a
-- recommendation, approve work, change an operating limit, or authorize an
-- operational action.
--
-- Canonical reuse:
--   * assets / sensors are the observed subject identities;
--   * model_register is the exact, independently approved model version;
--   * evidence_items is the ONE evidence store;
--   * approvals is the ONE approval record;
--   * audit_events is the ONE audit ledger.
--
-- The archived edge_nodes schema and edge-node-manager function are not
-- revived.  They accepted a generic bearer token, had no device signature,
-- replay wall, independent enrollment approval, governed model binding, or
-- canonical evidence path.  This migration creates the production contract
-- with explicit tenant and human-control boundaries.
-- ============================================================================

create or replace function public.edge_public_jwk_valid(p_jwk jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select jsonb_typeof(p_jwk) = 'object'
    and p_jwk->>'kty' = 'OKP'
    and p_jwk->>'crv' = 'Ed25519'
    and coalesce(p_jwk->>'x','') ~ '^[A-Za-z0-9_-]{43}$'
    and not (p_jwk ? 'd')
$$;

create or replace function public.edge_public_key_fingerprint(p_jwk jsonb)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(p_jwk::text, 'sha256'), 'hex')
$$;

create table if not exists public.edge_nodes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  site_id uuid references public.sites(id) on delete restrict,
  node_name text not null,
  hardware_family text not null,
  runtime_name text not null,
  runtime_version text,
  firmware_version text,
  status text not null default 'pending_review'
    check (status in ('pending_review','active','rejected','suspended','revoked','decommissioned')),
  current_key_id text not null,
  current_public_key_jwk jsonb not null,
  pending_key_id text,
  pending_public_key_jwk jsonb,
  key_rotation_requested_by uuid references auth.users(id) on delete set null,
  key_rotation_requested_at timestamptz,
  key_rotation_basis text,
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  last_seen_at timestamptz,
  last_payload_sha256 text,
  enrollment_basis text not null,
  registered_by uuid not null references auth.users(id) on delete restrict,
  registered_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete restrict,
  reviewed_at timestamptz,
  review_basis text,
  approval_id uuid references public.approvals(id) on delete restrict,
  state_changed_at timestamptz,
  state_change_basis text,
  unique (organization_id, node_name),
  unique (id, organization_id),
  check (length(btrim(node_name)) >= 3),
  check (length(btrim(hardware_family)) >= 2),
  check (length(btrim(runtime_name)) >= 2),
  check (length(btrim(current_key_id)) >= 8),
  check (public.edge_public_jwk_valid(current_public_key_jwk)),
  check (
    (pending_key_id is null and pending_public_key_jwk is null
      and key_rotation_requested_by is null and key_rotation_requested_at is null
      and key_rotation_basis is null)
    or
    (length(btrim(coalesce(pending_key_id,''))) >= 8
      and public.edge_public_jwk_valid(pending_public_key_jwk)
      and key_rotation_requested_by is not null
      and key_rotation_requested_at is not null
      and length(btrim(coalesce(key_rotation_basis,''))) >= 30)
  ),
  check (
    status <> 'active'
    or (reviewed_by is not null and reviewed_at is not null
      and approval_id is not null and length(btrim(coalesce(review_basis,''))) >= 30)
  )
);

create index if not exists idx_edge_nodes_org_status
  on public.edge_nodes(organization_id, status, registered_at desc);
create index if not exists idx_edge_nodes_last_seen
  on public.edge_nodes(organization_id, last_seen_at desc)
  where status = 'active';

alter table public.edge_nodes enable row level security;
drop policy if exists edge_nodes_org_read on public.edge_nodes;
create policy edge_nodes_org_read on public.edge_nodes
  for select to authenticated
  using (organization_id = public.app_current_org());

-- Device inference extends the canonical evidence row.  There is no parallel
-- edge-observation store.  The signed envelope and provenance remain attached
-- to the evidence item that downstream controls already understand.
alter table public.evidence_items
  add column if not exists edge_node_id uuid references public.edge_nodes(id) on delete restrict,
  add column if not exists edge_sensor_id uuid references public.sensors(id) on delete restrict,
  add column if not exists edge_model_register_id bigint references public.model_register(id) on delete restrict,
  add column if not exists edge_observation_id text,
  add column if not exists edge_sequence bigint,
  add column if not exists edge_payload_sha256 text,
  add column if not exists edge_signature_key_id text,
  add column if not exists edge_signature_verified_at timestamptz,
  add column if not exists edge_observation jsonb;

alter table public.evidence_items
  drop constraint if exists evidence_edge_contract_complete;
alter table public.evidence_items
  add constraint evidence_edge_contract_complete check (
    (
      edge_node_id is null
      and edge_sensor_id is null
      and edge_model_register_id is null
      and edge_observation_id is null
      and edge_sequence is null
      and edge_payload_sha256 is null
      and edge_signature_key_id is null
      and edge_signature_verified_at is null
      and edge_observation is null
    )
    or (
      edge_model_register_id is not null
      and asset_id is not null
      and length(btrim(coalesce(edge_observation_id,''))) >= 8
      and edge_sequence > 0
      and edge_payload_sha256 ~ '^[0-9a-f]{64}$'
      and length(btrim(coalesce(edge_signature_key_id,''))) >= 8
      and edge_signature_verified_at is not null
      and jsonb_typeof(edge_observation) = 'object'
      and evidence_class = 'AI_INFERENCE'
    )
  );

create unique index if not exists idx_evidence_edge_observation
  on public.evidence_items(edge_node_id, edge_observation_id)
  where edge_node_id is not null;
drop index if exists public.idx_evidence_edge_sequence;
create unique index idx_evidence_edge_sequence
  on public.evidence_items(edge_node_id, edge_signature_key_id, edge_sequence)
  where edge_node_id is not null;

-- Only the governed functions below may create or mutate node credentials.
-- DELETE is intentionally not trigger-blocked so organization retirement can
-- cascade; no client DELETE policy exists and DML grants are revoked below.
create or replace function public.enforce_edge_node_governed_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.edge_node_governed_write', true),'') <> 'granted' then
    raise exception 'edge-node enrollment, credentials and state move only through governed edge-node functions';
  end if;
  return new;
end
$$;

drop trigger if exists trg_edge_node_governed_write on public.edge_nodes;
create trigger trg_edge_node_governed_write
  before insert or update on public.edge_nodes
  for each row execute function public.enforce_edge_node_governed_write();

-- An authenticated application user cannot forge device-origin provenance on
-- an ordinary evidence row.  Verification may later change the canonical
-- verification fields, but the signed envelope itself is immutable.
create or replace function public.enforce_edge_evidence_provenance()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.edge_node_id is not null
     and coalesce(current_setting('app.edge_evidence_ingest', true),'') <> 'granted' then
    raise exception 'edge evidence may only be inserted after device-signature verification';
  end if;
  if tg_op = 'UPDATE' and (old.edge_node_id is not null or new.edge_node_id is not null) then
    if (to_jsonb(old) - array[
          'verification_status','verified_by','verified_at',
          'verification_method','verification_note'
        ]) is distinct from
       (to_jsonb(new) - array[
          'verification_status','verified_by','verified_at',
          'verification_method','verification_note'
        ]) then
      raise exception 'signed edge evidence is immutable except for recorded human verification; record a new observation';
    end if;
  end if;
  if tg_op = 'DELETE' and old.edge_node_id is not null
     and coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'signed edge evidence cannot be deleted by an application user';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists trg_edge_evidence_provenance on public.evidence_items;
create trigger trg_edge_evidence_provenance
  before insert or update or delete on public.evidence_items
  for each row execute function public.enforce_edge_evidence_provenance();

create or replace function public.request_edge_node_enrollment(
  p_node_name text,
  p_hardware_family text,
  p_runtime_name text,
  p_runtime_version text,
  p_firmware_version text,
  p_key_id text,
  p_public_key_jwk jsonb,
  p_site_id uuid,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_id uuid;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error','authenticated organization administrator required');
  end if;
  select role into v_role from public.user_profiles
   where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role,'') <> 'admin' then
    return jsonb_build_object('error','edge-node enrollment requires a human administrator');
  end if;
  if length(btrim(coalesce(p_node_name,''))) < 3
     or length(btrim(coalesce(p_hardware_family,''))) < 2
     or length(btrim(coalesce(p_runtime_name,''))) < 2
     or length(btrim(coalesce(p_key_id,''))) < 8 then
    return jsonb_build_object('error','node name, hardware family, runtime and stable key ID are required');
  end if;
  if length(btrim(coalesce(p_basis,''))) < 30 then
    return jsonb_build_object('error','enrollment basis requires at least 30 characters');
  end if;
  if not coalesce(public.edge_public_jwk_valid(p_public_key_jwk),false) then
    return jsonb_build_object('error','public key must be a public-only Ed25519 JWK');
  end if;
  if p_site_id is not null and not exists (
    select 1 from public.sites where id = p_site_id and organization_id = v_org
  ) then
    return jsonb_build_object('error','site not found in this organization');
  end if;
  if exists (
    select 1 from public.edge_nodes where organization_id = v_org
      and node_name = btrim(p_node_name)
  ) then
    return jsonb_build_object('error','an edge node with this name already exists in this organization');
  end if;

  perform set_config('app.edge_node_governed_write','granted',true);
  insert into public.edge_nodes(
    organization_id,site_id,node_name,hardware_family,runtime_name,
    runtime_version,firmware_version,current_key_id,current_public_key_jwk,
    enrollment_basis,registered_by
  ) values (
    v_org,p_site_id,btrim(p_node_name),btrim(p_hardware_family),btrim(p_runtime_name),
    nullif(btrim(coalesce(p_runtime_version,'')),''),
    nullif(btrim(coalesce(p_firmware_version,'')),''),
    btrim(p_key_id),p_public_key_jwk,btrim(p_basis),auth.uid()
  ) returning id into v_id;
  perform set_config('app.edge_node_governed_write','',true);

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'edge_node_enrollment_requested',v_role,jsonb_build_object(
    'edgeNodeId',v_id,'nodeName',btrim(p_node_name),'hardwareFamily',btrim(p_hardware_family),
    'keyId',btrim(p_key_id),'siteId',p_site_id,'operationalAuthorization',false));
  return jsonb_build_object('edgeNodeId',v_id,'status','pending_review',
    'operationalAuthorization',false);
exception when others then
  perform set_config('app.edge_node_governed_write','',true);
  raise;
end
$$;

create or replace function public.review_edge_node_enrollment(
  p_edge_node_id uuid,
  p_decision text,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_node public.edge_nodes%rowtype;
  v_approval uuid;
  v_status text;
begin
  if auth.uid() is null or v_org is null then
    return jsonb_build_object('error','authenticated organization reviewer required');
  end if;
  select role into v_role from public.user_profiles
   where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role,'') not in ('admin','executive') then
    return jsonb_build_object('error','edge-node review requires a human administrator or executive');
  end if;
  if p_decision is null or p_decision not in ('approved','rejected') then
    return jsonb_build_object('error','decision must be approved or rejected');
  end if;
  if length(btrim(coalesce(p_basis,''))) < 30 then
    return jsonb_build_object('error','independent review basis requires at least 30 characters');
  end if;
  select * into v_node from public.edge_nodes
   where id = p_edge_node_id and organization_id = v_org for update;
  if not found then return jsonb_build_object('error','edge node not found in this organization'); end if;
  if v_node.status <> 'pending_review' then
    return jsonb_build_object('error','edge node is not awaiting enrollment review');
  end if;
  if v_node.registered_by = auth.uid() then
    return jsonb_build_object('error','edge-node requester cannot independently review enrollment');
  end if;

  v_status := case when p_decision = 'approved' then 'active' else 'rejected' end;
  insert into public.approvals(
    organization_id,status,owner_role,approver,reason,consequence_of_wrong,
    required_validation,decided_at,approver_user_id,approval_scope
  ) values (
    v_org,p_decision,v_role,v_role,btrim(p_basis),
    'An untrusted or mis-bound edge device could forge industrial evidence across an asset decision chain.',
    'Independent human review of tenant, site, device identity and public-key fingerprint.',
    now(),auth.uid(),jsonb_build_object(
      'kind','edge_node_enrollment','edgeNodeId',v_node.id,'keyId',v_node.current_key_id,
      'keyFingerprint',public.edge_public_key_fingerprint(v_node.current_public_key_jwk),
      'operationalAuthorization',false)
  ) returning id into v_approval;

  perform set_config('app.edge_node_governed_write','granted',true);
  update public.edge_nodes set status = v_status, reviewed_by = auth.uid(),
    reviewed_at = now(), review_basis = btrim(p_basis), approval_id = v_approval,
    state_changed_at = now(), state_change_basis = btrim(p_basis)
  where id = v_node.id;
  perform set_config('app.edge_node_governed_write','',true);

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'edge_node_enrollment_reviewed',v_role,jsonb_build_object(
    'edgeNodeId',v_node.id,'decision',p_decision,'approvalId',v_approval,
    'keyId',v_node.current_key_id,
    'keyFingerprint',public.edge_public_key_fingerprint(v_node.current_public_key_jwk),
    'operationalAuthorization',false));
  return jsonb_build_object('edgeNodeId',v_node.id,'status',v_status,
    'approvalId',v_approval,'operationalAuthorization',false);
exception when others then
  perform set_config('app.edge_node_governed_write','',true);
  raise;
end
$$;

create or replace function public.request_edge_node_key_rotation(
  p_edge_node_id uuid,
  p_new_key_id text,
  p_new_public_key_jwk jsonb,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_node public.edge_nodes%rowtype;
begin
  if auth.uid() is null or v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from public.user_profiles
   where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role,'') <> 'admin' then
    return jsonb_build_object('error','edge-node key rotation requires a human administrator');
  end if;
  if length(btrim(coalesce(p_new_key_id,''))) < 8
     or not coalesce(public.edge_public_jwk_valid(p_new_public_key_jwk),false) then
    return jsonb_build_object('error','a distinct key ID and public-only Ed25519 JWK are required');
  end if;
  if length(btrim(coalesce(p_basis,''))) < 30 then
    return jsonb_build_object('error','key-rotation basis requires at least 30 characters');
  end if;
  select * into v_node from public.edge_nodes
   where id = p_edge_node_id and organization_id = v_org for update;
  if not found then return jsonb_build_object('error','edge node not found in this organization'); end if;
  if v_node.status <> 'active' then return jsonb_build_object('error','only an active edge node can rotate its key'); end if;
  if v_node.pending_key_id is not null then return jsonb_build_object('error','a key rotation is already awaiting review'); end if;
  if v_node.current_key_id = btrim(p_new_key_id) then return jsonb_build_object('error','new key ID must differ from the current key'); end if;
  if v_node.current_public_key_jwk = p_new_public_key_jwk then
    return jsonb_build_object('error','new public key must differ from the current key');
  end if;
  if exists (
    select 1 from public.approvals a
    where a.organization_id=v_org
      and a.approval_scope->>'kind' in ('edge_node_enrollment','edge_node_key_rotation')
      and a.approval_scope->>'edgeNodeId'=v_node.id::text
      and (
        a.approval_scope->>'keyId'=btrim(p_new_key_id)
        or a.approval_scope->>'oldKeyId'=btrim(p_new_key_id)
        or a.approval_scope->>'newKeyId'=btrim(p_new_key_id)
        or a.approval_scope->>'keyFingerprint'=public.edge_public_key_fingerprint(p_new_public_key_jwk)
        or a.approval_scope->>'oldKeyFingerprint'=public.edge_public_key_fingerprint(p_new_public_key_jwk)
        or a.approval_scope->>'newKeyFingerprint'=public.edge_public_key_fingerprint(p_new_public_key_jwk)
      )
  ) then
    return jsonb_build_object('error','edge key IDs and public keys cannot be reused');
  end if;

  perform set_config('app.edge_node_governed_write','granted',true);
  update public.edge_nodes set pending_key_id=btrim(p_new_key_id),
    pending_public_key_jwk=p_new_public_key_jwk,
    key_rotation_requested_by=auth.uid(),key_rotation_requested_at=now(),
    key_rotation_basis=btrim(p_basis)
  where id=v_node.id;
  perform set_config('app.edge_node_governed_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'edge_node_key_rotation_requested',v_role,jsonb_build_object(
    'edgeNodeId',v_node.id,'oldKeyId',v_node.current_key_id,
    'newKeyId',btrim(p_new_key_id),
    'oldKeyFingerprint',public.edge_public_key_fingerprint(v_node.current_public_key_jwk),
    'newKeyFingerprint',public.edge_public_key_fingerprint(p_new_public_key_jwk),
    'operationalAuthorization',false));
  return jsonb_build_object('edgeNodeId',v_node.id,'status','pending_key_review',
    'operationalAuthorization',false);
exception when others then
  perform set_config('app.edge_node_governed_write','',true);
  raise;
end
$$;

create or replace function public.review_edge_node_key_rotation(
  p_edge_node_id uuid,
  p_decision text,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_node public.edge_nodes%rowtype;
  v_approval uuid;
  v_new_key text;
begin
  if auth.uid() is null or v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from public.user_profiles
   where id = auth.uid() and organization_id = v_org;
  if coalesce(v_role,'') not in ('admin','executive') then
    return jsonb_build_object('error','edge-node key review requires a human administrator or executive');
  end if;
  if p_decision is null or p_decision not in ('approved','rejected') then return jsonb_build_object('error','decision must be approved or rejected'); end if;
  if length(btrim(coalesce(p_basis,''))) < 30 then
    return jsonb_build_object('error','independent review basis requires at least 30 characters');
  end if;
  select * into v_node from public.edge_nodes
   where id=p_edge_node_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','edge node not found in this organization'); end if;
  if v_node.pending_key_id is null then return jsonb_build_object('error','no key rotation is awaiting review'); end if;
  if v_node.key_rotation_requested_by=auth.uid() then
    return jsonb_build_object('error','key-rotation requester cannot independently review it');
  end if;

  v_new_key := v_node.pending_key_id;
  insert into public.approvals(
    organization_id,status,owner_role,approver,reason,consequence_of_wrong,
    required_validation,decided_at,approver_user_id,approval_scope
  ) values (
    v_org,p_decision,v_role,v_role,btrim(p_basis),
    'An incorrectly rotated device key can either admit forged evidence or strand a field device.',
    'Independent human comparison of node identity, old key and new public-key fingerprint.',
    now(),auth.uid(),jsonb_build_object(
      'kind','edge_node_key_rotation','edgeNodeId',v_node.id,
      'oldKeyId',v_node.current_key_id,'newKeyId',v_node.pending_key_id,
      'oldKeyFingerprint',public.edge_public_key_fingerprint(v_node.current_public_key_jwk),
      'newKeyFingerprint',public.edge_public_key_fingerprint(v_node.pending_public_key_jwk),
      'operationalAuthorization',false)
  ) returning id into v_approval;

  perform set_config('app.edge_node_governed_write','granted',true);
  update public.edge_nodes set
    current_key_id=case when p_decision='approved' then pending_key_id else current_key_id end,
    current_public_key_jwk=case when p_decision='approved' then pending_public_key_jwk else current_public_key_jwk end,
    last_sequence=case when p_decision='approved' then 0 else last_sequence end,
    pending_key_id=null,pending_public_key_jwk=null,key_rotation_requested_by=null,
    key_rotation_requested_at=null,key_rotation_basis=null
  where id=v_node.id;
  perform set_config('app.edge_node_governed_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'edge_node_key_rotation_reviewed',v_role,jsonb_build_object(
    'edgeNodeId',v_node.id,'decision',p_decision,'approvalId',v_approval,
    'oldKeyId',v_node.current_key_id,'newKeyId',v_new_key,
    'oldKeyFingerprint',public.edge_public_key_fingerprint(v_node.current_public_key_jwk),
    'newKeyFingerprint',public.edge_public_key_fingerprint(v_node.pending_public_key_jwk),
    'operationalAuthorization',false));
  return jsonb_build_object('edgeNodeId',v_node.id,'decision',p_decision,
    'activeKeyId',case when p_decision='approved' then v_new_key else v_node.current_key_id end,
    'approvalId',v_approval,'operationalAuthorization',false);
exception when others then
  perform set_config('app.edge_node_governed_write','',true);
  raise;
end
$$;

create or replace function public.restrict_edge_node(
  p_edge_node_id uuid,
  p_state text,
  p_basis text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
  v_node public.edge_nodes%rowtype;
begin
  if auth.uid() is null or v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select role into v_role from public.user_profiles
   where id=auth.uid() and organization_id=v_org;
  if coalesce(v_role,'') not in ('admin','executive') then
    return jsonb_build_object('error','edge-node restriction requires a human administrator or executive');
  end if;
  if p_state is null or p_state not in ('suspended','revoked','decommissioned') then
    return jsonb_build_object('error','state must be suspended, revoked or decommissioned; activation requires independent enrollment review');
  end if;
  if length(btrim(coalesce(p_basis,'')))<30 then
    return jsonb_build_object('error','state-change basis requires at least 30 characters');
  end if;
  select * into v_node from public.edge_nodes
   where id=p_edge_node_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','edge node not found in this organization'); end if;
  if v_node.status in ('rejected','revoked','decommissioned') then
    return jsonb_build_object('error','terminal edge-node state cannot be overwritten');
  end if;
  perform set_config('app.edge_node_governed_write','granted',true);
  update public.edge_nodes set status=p_state,state_changed_at=now(),
    state_change_basis=btrim(p_basis),pending_key_id=null,pending_public_key_jwk=null,
    key_rotation_requested_by=null,key_rotation_requested_at=null,key_rotation_basis=null
  where id=v_node.id;
  perform set_config('app.edge_node_governed_write','',true);
  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_org,'edge_node_restricted',v_role,jsonb_build_object(
    'edgeNodeId',v_node.id,'priorState',v_node.status,'newState',p_state,
    'keyId',v_node.current_key_id,'operationalAuthorization',false));
  return jsonb_build_object('edgeNodeId',v_node.id,'status',p_state,
    'operationalAuthorization',false);
exception when others then
  perform set_config('app.edge_node_governed_write','',true);
  raise;
end
$$;

-- Called only after edge-evidence-ingest verifies the exact body signature.
-- Replay ordering and every same-tenant/model invariant are rechecked inside a
-- single database transaction before the canonical evidence row is appended.
create or replace function public.ingest_verified_edge_evidence(
  p_edge_node_id uuid,
  p_key_id text,
  p_sequence bigint,
  p_observation_id text,
  p_captured_at timestamptz,
  p_asset_id uuid,
  p_sensor_id uuid,
  p_model_register_id bigint,
  p_confidence numeric,
  p_payload_sha256 text,
  p_observation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_node public.edge_nodes%rowtype;
  v_model public.model_register%rowtype;
  v_sensor public.sensors%rowtype;
  v_evidence uuid;
  v_summary text;
  v_quality text;
begin
  if auth.role() <> 'service_role' then
    return jsonb_build_object('error','device-signature verification service required');
  end if;
  select * into v_node from public.edge_nodes where id=p_edge_node_id for update;
  if not found or v_node.status <> 'active' then return jsonb_build_object('error','edge node unavailable'); end if;
  if v_node.current_key_id <> p_key_id then return jsonb_build_object('error','edge key unavailable'); end if;
  if p_sequence is null or p_sequence <= v_node.last_sequence then
    return jsonb_build_object('error','replayed or out-of-order edge sequence');
  end if;
  if length(btrim(coalesce(p_observation_id,''))) < 8 then return jsonb_build_object('error','stable observation ID required'); end if;
  if p_captured_at is null or p_captured_at > now() + interval '5 minutes' then
    return jsonb_build_object('error','captured timestamp is invalid');
  end if;
  if p_payload_sha256 is null or p_payload_sha256 !~ '^[0-9a-f]{64}$' then return jsonb_build_object('error','payload digest is invalid'); end if;
  if p_confidence is null or p_confidence < 0 or p_confidence > 1 then return jsonb_build_object('error','confidence must be between zero and one'); end if;
  if p_observation is null or jsonb_typeof(p_observation) <> 'object' or octet_length(p_observation::text) > 262144 then
    return jsonb_build_object('error','observation must be a JSON object no larger than 256 KiB');
  end if;
  v_summary := btrim(coalesce(p_observation->>'summary',''));
  if length(v_summary) < 10 or length(v_summary) > 500 then
    return jsonb_build_object('error','observation summary must contain 10 to 500 characters');
  end if;
  if not exists(select 1 from public.assets where id=p_asset_id and organization_id=v_node.organization_id) then
    return jsonb_build_object('error','asset is not bound to this edge node tenant');
  end if;
  if p_sensor_id is not null then
    select * into v_sensor from public.sensors
     where id=p_sensor_id and organization_id=v_node.organization_id;
    if not found or v_sensor.asset_id is distinct from p_asset_id then
      return jsonb_build_object('error','sensor is not bound to the same tenant and asset');
    end if;
  end if;
  select * into v_model from public.model_register
   where id=p_model_register_id and organization_id=v_node.organization_id;
  if not found or v_model.approval_status <> 'approved'
     or not v_model.current_for_decisions or v_model.approved_on is null
     or v_model.submitted_by is null or v_model.approved_by is null
     or v_model.submitted_by=v_model.approved_by
     or v_model.approval_evidence_item_id is null
     or not exists (
       select 1 from public.evidence_items e
       where e.id=v_model.approval_evidence_item_id
         and e.organization_id=v_node.organization_id
         and e.verification_status='verified'
     ) then
    return jsonb_build_object('error','exact edge model version is not independently approved and current');
  end if;
  if exists(select 1 from public.evidence_items
    where edge_node_id=v_node.id and edge_observation_id=p_observation_id) then
    return jsonb_build_object('error','edge observation already recorded');
  end if;

  v_quality := case when p_observation->>'dataQuality' in ('good','suspect','bad','unknown')
    then p_observation->>'dataQuality' else 'unknown' end;
  perform set_config('app.edge_evidence_ingest','granted',true);
  insert into public.evidence_items(
    organization_id,asset_id,source_system,evidence_type,description,
    confidence_contribution,data_quality,ts,signal_kind,source_reference,provenance,
    evidence_class,verification_status,edge_node_id,edge_sensor_id,
    edge_model_register_id,edge_observation_id,edge_sequence,edge_payload_sha256,
    edge_signature_key_id,edge_signature_verified_at,edge_observation
  ) values (
    v_node.organization_id,p_asset_id,'edge:'||lower(v_node.hardware_family),
    'edge_inference',v_summary,round(p_confidence*100)::int,v_quality,p_captured_at,
    'edge_observation',btrim(p_observation_id),jsonb_build_object(
      'edgeNodeId',v_node.id,'edgeNodeName',v_node.node_name,
      'hardwareFamily',v_node.hardware_family,'runtime',v_node.runtime_name,
      'runtimeVersion',v_node.runtime_version,'firmwareVersion',v_node.firmware_version,
      'modelRegisterId',v_model.id,'modelKey',v_model.model_key,'modelVersion',v_model.version,
      'sensorId',p_sensor_id,'sequence',p_sequence,'payloadSha256',p_payload_sha256,
      'signatureKeyId',p_key_id,'signatureVerified',true,
      'operationalAuthorization',false),
    'AI_INFERENCE','unverified',v_node.id,p_sensor_id,v_model.id,
    btrim(p_observation_id),p_sequence,p_payload_sha256,p_key_id,now(),p_observation
  ) returning id into v_evidence;
  perform set_config('app.edge_evidence_ingest','',true);

  perform set_config('app.edge_node_governed_write','granted',true);
  update public.edge_nodes set last_sequence=p_sequence,last_seen_at=now(),
    last_payload_sha256=p_payload_sha256 where id=v_node.id;
  perform set_config('app.edge_node_governed_write','',true);

  insert into public.audit_events(organization_id,entity_type,actor,event_data)
  values(v_node.organization_id,'edge_evidence_ingested','edge_device',jsonb_build_object(
    'edgeNodeId',v_node.id,'evidenceItemId',v_evidence,'assetId',p_asset_id,
    'sensorId',p_sensor_id,'modelRegisterId',v_model.id,
    'observationId',btrim(p_observation_id),'sequence',p_sequence,
    'verificationStatus','unverified','operationalAuthorization',false));
  return jsonb_build_object('evidenceItemId',v_evidence,'verificationStatus','unverified',
    'evidenceClass','AI_INFERENCE','operationalAuthorization',false,
    'note','A valid device signature admits evidence only; a named human must verify it before governed decisions can rely on it.');
exception when unique_violation then
  perform set_config('app.edge_evidence_ingest','',true);
  perform set_config('app.edge_node_governed_write','',true);
  return jsonb_build_object('error','edge observation or sequence already recorded');
when others then
  perform set_config('app.edge_evidence_ingest','',true);
  perform set_config('app.edge_node_governed_write','',true);
  raise;
end
$$;

revoke all on table public.edge_nodes from public, anon;
revoke insert, update, delete on table public.edge_nodes from authenticated;
grant select on table public.edge_nodes to authenticated;
grant select on table public.edge_nodes to service_role;

revoke all on function public.edge_public_jwk_valid(jsonb) from public,anon,authenticated;
revoke all on function public.edge_public_key_fingerprint(jsonb) from public,anon,authenticated;
revoke all on function public.enforce_edge_node_governed_write() from public,anon,authenticated;
revoke all on function public.enforce_edge_evidence_provenance() from public,anon,authenticated;
revoke all on function public.request_edge_node_enrollment(text,text,text,text,text,text,jsonb,uuid,text) from public,anon;
revoke all on function public.review_edge_node_enrollment(uuid,text,text) from public,anon;
revoke all on function public.request_edge_node_key_rotation(uuid,text,jsonb,text) from public,anon;
revoke all on function public.review_edge_node_key_rotation(uuid,text,text) from public,anon;
revoke all on function public.restrict_edge_node(uuid,text,text) from public,anon;
revoke all on function public.ingest_verified_edge_evidence(uuid,text,bigint,text,timestamptz,uuid,uuid,bigint,numeric,text,jsonb) from public,anon,authenticated;

grant execute on function public.request_edge_node_enrollment(text,text,text,text,text,text,jsonb,uuid,text) to authenticated;
grant execute on function public.review_edge_node_enrollment(uuid,text,text) to authenticated;
grant execute on function public.request_edge_node_key_rotation(uuid,text,jsonb,text) to authenticated;
grant execute on function public.review_edge_node_key_rotation(uuid,text,text) to authenticated;
grant execute on function public.restrict_edge_node(uuid,text,text) to authenticated;
grant execute on function public.ingest_verified_edge_evidence(uuid,text,bigint,text,timestamptz,uuid,uuid,bigint,numeric,text,jsonb) to service_role;

comment on function public.ingest_verified_edge_evidence(uuid,text,bigint,text,timestamptz,uuid,uuid,bigint,numeric,text,jsonb) is
  'Hardware-neutral Edge Evidence Contract. Service-role only after Ed25519 verification. Appends unverified AI_INFERENCE to canonical evidence_items and grants no operational authority.';

notify pgrst,'reload schema';
