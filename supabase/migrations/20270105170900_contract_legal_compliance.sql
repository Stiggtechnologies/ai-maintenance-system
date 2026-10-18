-- ============================================================================
-- Sync Develop D11.24 — close the seventh deterministic §70 determination:
-- "contract legally compliant".
--
-- CANONICAL DECISION
--   * contract_packages remains the Contract. No contracts or awards table is
--     introduced.
--   * evidence_items remains the evidence model. A legal determination must
--     cite one VERIFIED, DOCUMENTED item on the same development case.
--   * audit_events remains the audit ledger.
--   * the only new relation is immutable attestation HISTORY beneath the
--     canonical contract. A new version references the exact version it
--     supersedes; no legal conclusion is overwritten in place.
--
-- AUTHORITY
-- The model may prepare or summarize evidence. It never records this
-- determination. A same-tenant human in the existing contract-award role set
-- records it under a verified factor and an AAL2 session. The table trigger
-- independently refuses AI/system attribution for every writer.
-- ============================================================================

create table if not exists public.contract_legal_compliance_attestations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  package_id bigint not null references public.contract_packages(id) on delete cascade,
  version integer not null check (version > 0),
  determination text not null check (determination in ('compliant','not_compliant')),
  jurisdiction text not null check (length(btrim(jurisdiction)) >= 2),
  legal_scope text not null check (length(btrim(legal_scope)) >= 20),
  evidence_item_id uuid not null references public.evidence_items(id) on delete restrict,
  basis text not null check (length(btrim(basis)) >= 30),
  valid_until date not null,
  attested_by uuid not null references auth.users(id) on delete restrict,
  attested_at timestamptz not null default now(),
  supersedes_id uuid references public.contract_legal_compliance_attestations(id) on delete restrict,
  supersession_reason text,
  unique (package_id, version),
  unique (supersedes_id),
  constraint contract_legal_first_version check (
    (version = 1 and supersedes_id is null and supersession_reason is null)
    or
    (version > 1 and supersedes_id is not null
      and length(btrim(coalesce(supersession_reason,''))) >= 20)
  )
);

create index if not exists idx_contract_legal_attestations_current
  on public.contract_legal_compliance_attestations(organization_id,package_id,version desc);
create index if not exists idx_contract_legal_attestations_evidence
  on public.contract_legal_compliance_attestations(organization_id,evidence_item_id);

alter table public.contract_legal_compliance_attestations enable row level security;
drop policy if exists contract_legal_attestations_read
  on public.contract_legal_compliance_attestations;
create policy contract_legal_attestations_read
  on public.contract_legal_compliance_attestations
  for select to authenticated
  using (organization_id=public.app_current_org());

revoke all on table public.contract_legal_compliance_attestations
  from public,anon,authenticated,service_role;
grant select on table public.contract_legal_compliance_attestations to authenticated;

comment on table public.contract_legal_compliance_attestations is
  'D11.24 / spec §70: immutable, human-attributed legal-compliance determinations beneath the canonical contract_packages row. Each version cites verified documented evidence on the same case; absence and expiry refuse rather than defaulting to compliant. AI may prepare evidence and cannot attest.';

-- Direct writes fail closed. UPDATE has no governed branch because history is
-- immutable; supersession is a new INSERT. Cascades may remove the child only
-- after its canonical parent or organization has already gone.
create or replace function public.guard_contract_legal_attestation_write()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if tg_op='TRUNCATE' then
    raise exception 'Contract legal-compliance attestations are immutable evidence and cannot be truncated'
      using errcode='insufficient_privilege';
  end if;
  if tg_op='DELETE' then
    if not exists(select 1 from public.organizations where id=old.organization_id)
       or not exists(select 1 from public.contract_packages where id=old.package_id) then
      return old;
    end if;
    raise exception 'Contract legal-compliance attestations are immutable; supersede the current version through the governed human attestation workflow'
      using errcode='insufficient_privilege';
  end if;
  if tg_op='UPDATE' then
    raise exception 'Contract legal-compliance attestations are immutable; record a new version that references the version it supersedes'
      using errcode='insufficient_privilege';
  end if;
  if coalesce(current_setting('app.contract_legal_writer',true),'')<>'governed' then
    raise exception 'Contract legal-compliance attestations require the governed named-human workflow'
      using errcode='insufficient_privilege';
  end if;
  return new;
end
$$;

revoke all on function public.guard_contract_legal_attestation_write()
  from public,anon,authenticated,service_role;

drop trigger if exists trg_00_guard_contract_legal_attestation_write
  on public.contract_legal_compliance_attestations;
create trigger trg_00_guard_contract_legal_attestation_write
  before insert or update or delete
  on public.contract_legal_compliance_attestations
  for each row
  execute function public.guard_contract_legal_attestation_write();
drop trigger if exists trg_00_guard_contract_legal_attestation_truncate
  on public.contract_legal_compliance_attestations;
create trigger trg_00_guard_contract_legal_attestation_truncate
  before truncate on public.contract_legal_compliance_attestations
  for each statement
  execute function public.guard_contract_legal_attestation_write();

-- The statement trigger above cannot inspect row identity. This unconditional
-- row wall proves the actor is a resolvable member of the row's own tenant and
-- is not the AI operator, regardless of caller or service credentials.
create or replace function public.enforce_contract_legal_attestor_is_human()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare v_role text;
begin
  select up.role into v_role
  from public.user_profiles up
  where up.id=new.attested_by and up.organization_id=new.organization_id;
  if v_role is null then
    raise exception 'The contract legal-compliance attestor must be a named member of the organization that owns the contract'
      using errcode='check_violation';
  end if;
  if v_role='ai_admin' then
    raise exception 'The AI-operator identity cannot attest that a contract is legally compliant (spec §70). AI may prepare evidence; an authorized named human makes the determination.'
      using errcode='check_violation';
  end if;
  return new;
end
$$;

revoke all on function public.enforce_contract_legal_attestor_is_human()
  from public,anon,authenticated,service_role;

drop trigger if exists trg_contract_legal_attestor_is_human
  on public.contract_legal_compliance_attestations;
create trigger trg_contract_legal_attestor_is_human
  before insert on public.contract_legal_compliance_attestations
  for each row execute function public.enforce_contract_legal_attestor_is_human();

-- Cross-row invariants cannot be CHECK constraints: contract/evidence tenant,
-- case binding, verified/documented evidence and exact supersession all live
-- on referenced rows. Enforce them at the persistence boundary too.
create or replace function public.enforce_contract_legal_attestation_integrity()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  p public.contract_packages%rowtype;
  e public.evidence_items%rowtype;
  prior public.contract_legal_compliance_attestations%rowtype;
begin
  select * into p from public.contract_packages where id=new.package_id;
  if not found or p.organization_id<>new.organization_id then
    raise exception 'The legal-compliance determination and contract must belong to the same organization'
      using errcode='check_violation';
  end if;
  if p.awarded_at is null then
    raise exception 'Legal compliance is determined against an awarded contract; this procurement package has no contract award'
      using errcode='check_violation';
  end if;

  select * into e from public.evidence_items where id=new.evidence_item_id;
  if not found or e.organization_id<>new.organization_id then
    raise exception 'The cited legal evidence must belong to the organization that owns the contract'
      using errcode='check_violation';
  end if;
  if e.development_case_id is distinct from p.development_case_id then
    raise exception 'The cited legal evidence must be recorded on the same development case as the contract'
      using errcode='check_violation';
  end if;
  if e.verification_status<>'verified' or e.evidence_class<>'DOCUMENTED' then
    raise exception 'Contract legal compliance requires a VERIFIED DOCUMENTED evidence item; an unverified, rejected, inferred or differently classed item cannot carry the determination'
      using errcode='check_violation';
  end if;
  if new.valid_until<current_date then
    raise exception 'A new legal-compliance determination cannot already be expired'
      using errcode='check_violation';
  end if;

  if new.version=1 then
    if exists(select 1 from public.contract_legal_compliance_attestations a
              where a.package_id=new.package_id) then
      raise exception 'This contract already has legal-compliance history; the next determination must supersede its current version'
        using errcode='check_violation';
    end if;
  else
    select * into prior
    from public.contract_legal_compliance_attestations
    where id=new.supersedes_id;
    if not found
       or prior.organization_id<>new.organization_id
       or prior.package_id<>new.package_id
       or new.version<>prior.version+1 then
      raise exception 'A legal-compliance revision must reference the immediately preceding version on the same contract and tenant'
        using errcode='check_violation';
    end if;
    if exists(select 1 from public.contract_legal_compliance_attestations s
              where s.supersedes_id=prior.id) then
      raise exception 'That legal-compliance version has already been superseded; branch histories are refused'
        using errcode='check_violation';
    end if;
  end if;
  return new;
end
$$;

revoke all on function public.enforce_contract_legal_attestation_integrity()
  from public,anon,authenticated,service_role;

drop trigger if exists trg_contract_legal_attestation_integrity
  on public.contract_legal_compliance_attestations;
create trigger trg_contract_legal_attestation_integrity
  before insert on public.contract_legal_compliance_attestations
  for each row execute function public.enforce_contract_legal_attestation_integrity();

create or replace function public.contract_legal_compliance_position(p_package_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid:=public.app_current_org();
  p public.contract_packages%rowtype;
  a public.contract_legal_compliance_attestations%rowtype;
  e public.evidence_items%rowtype;
  v_attestor text;
  v_verifier text;
begin
  if v_org is null then return jsonb_build_object('error','forbidden'); end if;
  select * into p from public.contract_packages
  where id=p_package_id and organization_id=v_org;
  if not found then return jsonb_build_object('error','contract not found'); end if;
  if p.awarded_at is null then
    return jsonb_build_object('packageId',p.id,'answered',false,'status','not_a_contract',
      'refusal','Legal compliance is determined against an awarded contract; this procurement package has no contract award.');
  end if;

  select x.* into a
  from public.contract_legal_compliance_attestations x
  where x.package_id=p.id and x.organization_id=v_org
    and not exists(select 1 from public.contract_legal_compliance_attestations s
                   where s.supersedes_id=x.id)
  order by x.version desc limit 1;
  if not found then
    return jsonb_build_object('packageId',p.id,'answered',false,'status','unassessed',
      'refusal','No legal-compliance determination has been recorded for this contract. Absence is not compliance.');
  end if;

  select * into e from public.evidence_items where id=a.evidence_item_id;
  select coalesce(nullif(up.full_name,''),up.email) into v_attestor
    from public.user_profiles up where up.id=a.attested_by and up.organization_id=v_org;
  select coalesce(nullif(up.full_name,''),up.email) into v_verifier
    from public.user_profiles up where up.id=e.verified_by and up.organization_id=v_org;

  if a.valid_until<current_date then
    return jsonb_build_object('packageId',p.id,'answered',false,'status','expired',
      'compliant',false,'determination',a.determination,'version',a.version,
      'jurisdiction',a.jurisdiction,'legalScope',a.legal_scope,'basis',a.basis,
      'attestedBy',v_attestor,'attestedAt',a.attested_at,'validUntil',a.valid_until,
      'evidence',jsonb_build_object('id',e.id,'description',e.description,
        'revision',e.revision,'verifiedAt',e.verified_at,'verifiedBy',v_verifier),
      'refusal',format('The current legal-compliance determination expired on %s. Expired legal review is not compliance; record a new evidenced human determination.',a.valid_until));
  end if;

  return jsonb_build_object('packageId',p.id,'answered',true,
    'status',a.determination,'compliant',a.determination='compliant',
    'determination',a.determination,'version',a.version,
    'jurisdiction',a.jurisdiction,'legalScope',a.legal_scope,'basis',a.basis,
    'attestedBy',v_attestor,'attestedAt',a.attested_at,'validUntil',a.valid_until,
    'evidence',jsonb_build_object('id',e.id,'description',e.description,
      'revision',e.revision,'verifiedAt',e.verified_at,'verifiedBy',v_verifier));
end
$$;

revoke all on function public.contract_legal_compliance_position(bigint)
  from public,anon,service_role;
grant execute on function public.contract_legal_compliance_position(bigint) to authenticated;

create or replace function public.record_contract_legal_compliance(
  p_package_id bigint,
  p_attestation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_org uuid:=public.app_current_org();
  v_uid uuid:=auth.uid();
  v_role text;
  p public.contract_packages%rowtype;
  current_row public.contract_legal_compliance_attestations%rowtype;
  v_determination text:=lower(nullif(btrim(coalesce(p_attestation->>'determination','')),''));
  v_jurisdiction text:=nullif(btrim(coalesce(p_attestation->>'jurisdiction','')),'');
  v_scope text:=nullif(btrim(coalesce(p_attestation->>'legal_scope','')),'');
  v_basis text:=nullif(btrim(coalesce(p_attestation->>'basis','')),'');
  v_evidence uuid:=public.sync_text_as_uuid(nullif(btrim(coalesce(p_attestation->>'evidence_item_id','')),''));
  v_until_raw text:=nullif(btrim(coalesce(p_attestation->>'valid_until','')),'');
  v_until date:=public.sync_text_as_date(v_until_raw);
  v_supersession_reason text:=nullif(btrim(coalesce(p_attestation->>'supersession_reason','')),'');
  v_id uuid;
  v_version integer;
begin
  if v_org is null or v_uid is null then return jsonb_build_object('error','forbidden'); end if;
  select up.role into v_role from public.user_profiles up
  where up.id=v_uid and up.organization_id=v_org;
  if coalesce(v_role,'')='ai_admin' then
    return jsonb_build_object('error','The AI-operator identity cannot attest that a contract is legally compliant. AI may prepare evidence; an authorized named human makes the determination.');
  end if;
  if coalesce(v_role,'') not in ('admin','executive','maintenance_manager') then
    return jsonb_build_object('error','Contract legal-compliance attestation requires an administrator, executive or maintenance manager acting as the accountable contract authority.');
  end if;
  if not public.app_actor_has_verified_mfa(v_uid) then
    return jsonb_build_object('error','A verified MFA factor is required to record a contract legal-compliance determination.');
  end if;
  if public.app_current_aal()<>'aal2' then
    return jsonb_build_object('error','An AAL2 session is required to record a contract legal-compliance determination.');
  end if;

  select * into p from public.contract_packages
  where id=p_package_id and organization_id=v_org for update;
  if not found then return jsonb_build_object('error','Contract not found in this tenant.'); end if;
  if p.awarded_at is null then
    return jsonb_build_object('error','Legal compliance is determined against an awarded contract; this procurement package has no contract award.');
  end if;
  if v_determination not in ('compliant','not_compliant') then
    return jsonb_build_object('error','determination must be compliant or not_compliant');
  end if;
  if v_jurisdiction is null or length(v_jurisdiction)<2 then
    return jsonb_build_object('error','State the jurisdiction for this legal determination.');
  end if;
  if v_scope is null or length(v_scope)<20 then
    return jsonb_build_object('error','State the legal review scope (20 characters minimum).');
  end if;
  if v_basis is null or length(v_basis)<30 then
    return jsonb_build_object('error','State the legal basis for this determination (30 characters minimum).');
  end if;
  if v_evidence is null then
    return jsonb_build_object('error','Select the verified documented evidence item that supports this determination.');
  end if;
  if v_until_raw is null or v_until is null then
    return jsonb_build_object('error','valid_until must be a real date; legal review with no reassessment boundary is not current forever.');
  end if;
  if v_until<current_date then
    return jsonb_build_object('error','A new legal-compliance determination cannot already be expired.');
  end if;

  -- Lock the current leaf so two concurrent revisions cannot branch. The
  -- unique supersedes_id index is the second, persistence-level backstop.
  select x.* into current_row
  from public.contract_legal_compliance_attestations x
  where x.package_id=p.id and x.organization_id=v_org
    and not exists(select 1 from public.contract_legal_compliance_attestations s
                   where s.supersedes_id=x.id)
  order by x.version desc limit 1 for update;
  if found and (v_supersession_reason is null or length(v_supersession_reason)<20) then
    return jsonb_build_object('error','A revised legal determination must state why it supersedes the current version (20 characters minimum).');
  end if;
  v_version:=coalesce(current_row.version,0)+1;

  perform set_config('app.contract_legal_writer','governed',true);
  begin
    insert into public.contract_legal_compliance_attestations(
      organization_id,package_id,version,determination,jurisdiction,legal_scope,
      evidence_item_id,basis,valid_until,attested_by,supersedes_id,supersession_reason)
    values(v_org,p.id,v_version,v_determination,v_jurisdiction,v_scope,
      v_evidence,v_basis,v_until,v_uid,current_row.id,
      case when current_row.id is null then null else v_supersession_reason end)
    returning id into v_id;
  exception when others then
    perform set_config('app.contract_legal_writer','',true);
    raise;
  end;
  perform set_config('app.contract_legal_writer','',true);

  insert into public.audit_events(organization_id,entity_type,actor,event_data,
    previous_state,new_state)
  values(v_org,'contract_legal_compliance',coalesce(v_role,'unknown'),
    jsonb_build_object('package_id',p.id,'package_code',p.package_code,
      'attestation_id',v_id,'evidence_item_id',v_evidence),
    case when current_row.id is null then null else jsonb_build_object(
      'attestation_id',current_row.id,'version',current_row.version,
      'determination',current_row.determination,'valid_until',current_row.valid_until) end,
    jsonb_build_object('attestation_id',v_id,'version',v_version,
      'determination',v_determination,'jurisdiction',v_jurisdiction,
      'legal_scope',v_scope,'valid_until',v_until,'attested_by',v_uid,
      'supersedes_id',current_row.id));

  return jsonb_build_object('attestationId',v_id,'version',v_version,
    'determination',v_determination,'validUntil',v_until,
    'position',public.contract_legal_compliance_position(p.id));
end
$$;

revoke all on function public.record_contract_legal_compliance(bigint,jsonb)
  from public,anon,service_role;
grant execute on function public.record_contract_legal_compliance(bigint,jsonb)
  to authenticated;

comment on function public.record_contract_legal_compliance(bigint,jsonb) is
  'D11.24 / spec §70 seventh determination: a same-tenant named human with a verified factor and AAL2 records an immutable legal-compliance version against one awarded canonical contract and one verified documented case evidence item. The AI/system identity is refused at the RPC and table boundary; direct writes fail closed; every version is audited.';

-- Extend the commercial read already used by the product. Transform its live
-- definition rather than copying a long body and silently reverting repairs.
do $commercial$
declare
  v_def text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_contract_commercial'
    and pg_get_function_identity_arguments(p.oid)='p_package_id bigint';
  if v_def is null then
    raise exception 'get_contract_commercial(bigint) does not exist'
      using errcode='check_violation';
  end if;
  if position('contract_legal_compliance_position' in v_def)>0 then return; end if;
  v_new:=replace(v_def,
    $old$    'summary', v_summary,$old$,
    $new$    'summary', v_summary,
    'legalCompliance', public.contract_legal_compliance_position(p.id),$new$);
  if v_new=v_def then
    raise exception 'get_contract_commercial summary anchor changed; re-derive the legal-compliance extension against the live function'
      using errcode='check_violation';
  end if;
  execute v_new;
end
$commercial$;

comment on function public.get_contract_commercial(bigint) is
  'D6.06/D11.24: one contract commercial position, now including the current immutable human legal-compliance determination from contract_legal_compliance_position. Absence and expiry are refusals, never inferred compliance.';

notify pgrst,'reload schema';
