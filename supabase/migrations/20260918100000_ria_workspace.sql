-- SyncAI Reliability Intelligence Assessment workspace
-- Software-native delivery boundary for the paid fixed-scope assessment.
-- Authenticated customers receive tenant-scoped reads. Direct writes are
-- deliberately narrow: source-file metadata may be inserted by a tenant user;
-- engineering publishing/approval transitions go through guarded RPCs.

create table if not exists public.ria_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null default 'Reliability Intelligence Assessment',
  scope_label text not null,
  status text not null default 'active' check (status in ('active','analysis','customer_review','verification','complete','closed')),
  commercial_model text not null default 'Standard - US$35,000 fixed fee',
  sponsor_user_id uuid references public.user_profiles(id) on delete set null,
  started_on date default current_date,
  target_end_on date,
  source_retention_until date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ria_data_sources (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.ria_assessments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category text not null,
  file_name text not null,
  object_path text not null,
  mime_type text,
  size_bytes bigint,
  record_count bigint,
  status text not null default 'uploaded' check (status in ('requested','uploaded','profiled','accepted','rejected')),
  quality_grade text not null default 'unreviewed' check (quality_grade in ('unreviewed','supported','partial','unsupported','conflict')),
  notes text,
  uploaded_by uuid references public.user_profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.ria_baseline_metrics (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.ria_assessments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  metric_key text not null,
  label text not null,
  value_text text,
  unit text,
  method text,
  evidence_grade text not null default 'unsupported' check (evidence_grade in ('supported','partially_supported','unsupported')),
  evidence_refs uuid[] not null default '{}',
  reviewer_id uuid references public.user_profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (assessment_id, metric_key)
);

create table if not exists public.ria_criticality_items (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.ria_assessments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_ref text,
  asset_name text not null,
  criticality text not null check (criticality in ('critical','high','medium','low')),
  rationale text not null,
  review_state text not null default 'draft' check (review_state in ('draft','approved','changes_requested')),
  approved_by uuid references public.user_profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ria_findings (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.ria_assessments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  statement text not null,
  severity text not null default 'moderate' check (severity in ('critical','high','moderate','low')),
  confidence text not null default 'medium' check (confidence in ('high','medium','low')),
  evidence_grade text not null check (evidence_grade in ('supported','partially_supported','unsupported')),
  decision_boundary text not null,
  evidence_refs uuid[] not null default '{}',
  review_state text not null default 'draft' check (review_state in ('draft','reviewed','published','rejected')),
  reviewer_id uuid references public.user_profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ria_opportunities (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.ria_assessments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  priority text not null default 'medium' check (priority in ('critical','high','medium','low')),
  rationale text not null,
  method text,
  value_low numeric,
  value_high numeric,
  value_currency text default 'USD',
  confidence text not null default 'low' check (confidence in ('high','medium','low')),
  owner text,
  status text not null default 'candidate' check (status in ('candidate','accepted','deferred','rejected','verified')),
  created_at timestamptz not null default now()
);

create table if not exists public.ria_decisions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.ria_assessments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  decision_required text not null,
  recommendation text not null,
  evidence_summary text not null,
  uncertainty text,
  authority_role text not null,
  boundary text not null,
  verification text not null,
  due_on date,
  status text not null default 'pending' check (status in ('pending','approved','changes_requested','rejected','deferred')),
  approver_id uuid references public.user_profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.ria_actions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.ria_assessments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  horizon text not null check (horizon in ('day_30','day_60','day_90')),
  action text not null,
  owner text,
  due_on date,
  verification_metric text,
  status text not null default 'not_started' check (status in ('not_started','in_progress','blocked','complete','cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists public.ria_verifications (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.ria_assessments(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  checkpoint text not null check (checkpoint in ('day_30','day_60','day_90')),
  metric text not null,
  baseline text,
  observed text,
  method text not null,
  evidence_refs uuid[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','supported','partially_supported','unsupported')),
  verified_by uuid references public.user_profiles(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ria_assessments_org_idx on public.ria_assessments (organization_id, created_at desc);
create index if not exists ria_data_sources_assessment_idx on public.ria_data_sources (assessment_id, created_at desc);
create index if not exists ria_findings_assessment_idx on public.ria_findings (assessment_id, review_state);
create index if not exists ria_decisions_assessment_idx on public.ria_decisions (assessment_id, status);
create index if not exists ria_actions_assessment_idx on public.ria_actions (assessment_id, horizon);

alter table public.ria_assessments enable row level security;
alter table public.ria_data_sources enable row level security;
alter table public.ria_baseline_metrics enable row level security;
alter table public.ria_criticality_items enable row level security;
alter table public.ria_findings enable row level security;
alter table public.ria_opportunities enable row level security;
alter table public.ria_decisions enable row level security;
alter table public.ria_actions enable row level security;
alter table public.ria_verifications enable row level security;

-- Read visibility: every assessment surface is scoped to the caller's org.
drop policy if exists ria_assessments_org_read on public.ria_assessments;
create policy ria_assessments_org_read on public.ria_assessments for select to authenticated
using (organization_id = public.app_current_org());

drop policy if exists ria_data_sources_org_read on public.ria_data_sources;
create policy ria_data_sources_org_read on public.ria_data_sources for select to authenticated
using (organization_id = public.app_current_org());

drop policy if exists ria_baseline_metrics_org_read on public.ria_baseline_metrics;
create policy ria_baseline_metrics_org_read on public.ria_baseline_metrics for select to authenticated
using (organization_id = public.app_current_org());

drop policy if exists ria_criticality_items_org_read on public.ria_criticality_items;
create policy ria_criticality_items_org_read on public.ria_criticality_items for select to authenticated
using (organization_id = public.app_current_org());

drop policy if exists ria_findings_org_read on public.ria_findings;
create policy ria_findings_org_read on public.ria_findings for select to authenticated
using (organization_id = public.app_current_org());

drop policy if exists ria_opportunities_org_read on public.ria_opportunities;
create policy ria_opportunities_org_read on public.ria_opportunities for select to authenticated
using (organization_id = public.app_current_org());

drop policy if exists ria_decisions_org_read on public.ria_decisions;
create policy ria_decisions_org_read on public.ria_decisions for select to authenticated
using (organization_id = public.app_current_org());

drop policy if exists ria_actions_org_read on public.ria_actions;
create policy ria_actions_org_read on public.ria_actions for select to authenticated
using (organization_id = public.app_current_org());

drop policy if exists ria_verifications_org_read on public.ria_verifications;
create policy ria_verifications_org_read on public.ria_verifications for select to authenticated
using (organization_id = public.app_current_org());

-- Customer-authorized export intake is the one direct assessment-table write.
-- The assessment parent must itself belong to the same current organization.
drop policy if exists ria_data_sources_org_insert on public.ria_data_sources;
create policy ria_data_sources_org_insert on public.ria_data_sources for insert to authenticated
with check (
  organization_id = public.app_current_org()
  and exists (
    select 1 from public.ria_assessments a
    where a.id = assessment_id and a.organization_id = public.app_current_org()
  )
);

-- Findings cannot become customer-published without a named human reviewer.
create or replace function public.publish_ria_finding(p_finding_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
begin
  select role into v_role from public.user_profiles where id = auth.uid();
  if v_org is null or v_role not in ('admin','ai_admin','reliability_engineer') then
    raise exception 'Reliability Engineer or administrator authority required';
  end if;

  update public.ria_findings
     set review_state = 'published', reviewer_id = auth.uid(), reviewed_at = now()
   where id = p_finding_id and organization_id = v_org;

  if not found then raise exception 'Finding not found in current organization'; end if;
end;
$$;
revoke all on function public.publish_ria_finding(uuid) from public;
grant execute on function public.publish_ria_finding(uuid) to authenticated;

create or replace function public.approve_ria_criticality_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.app_current_org();
  v_role text;
begin
  select role into v_role from public.user_profiles where id = auth.uid();
  if v_org is null or v_role not in ('admin','ai_admin','reliability_engineer','maintenance_manager') then
    raise exception 'Authorized engineering or maintenance reviewer required';
  end if;

  update public.ria_criticality_items
     set review_state = 'approved', approved_by = auth.uid(), approved_at = now()
   where id = p_item_id and organization_id = v_org;

  if not found then raise exception 'Criticality item not found in current organization'; end if;
end;
$$;
revoke all on function public.approve_ria_criticality_item(uuid) from public;
grant execute on function public.approve_ria_criticality_item(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('ria-source-files', 'ria-source-files', false, 104857600)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Storage keys begin with organization_id / assessment_id / generated-file-name.
drop policy if exists ria_source_files_read on storage.objects;
create policy ria_source_files_read on storage.objects for select to authenticated
using (
  bucket_id = 'ria-source-files'
  and (storage.foldername(name))[1] = public.app_current_org()::text
);

drop policy if exists ria_source_files_insert on storage.objects;
create policy ria_source_files_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'ria-source-files'
  and (storage.foldername(name))[1] = public.app_current_org()::text
);

drop policy if exists ria_source_files_delete on storage.objects;
create policy ria_source_files_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'ria-source-files'
  and (storage.foldername(name))[1] = public.app_current_org()::text
);
