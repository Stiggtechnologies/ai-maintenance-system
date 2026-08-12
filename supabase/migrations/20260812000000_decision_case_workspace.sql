alter table public.cowork_workspaces
  add column if not exists case_number text,
  add column if not exists case_state jsonb not null default '{}'::jsonb,
  add column if not exists source_intake_id uuid references public.pilot_intake_requests(id) on delete set null,
  add column if not exists usage_tokens integer not null default 0;

alter table public.cowork_workspaces
  drop constraint if exists cowork_workspaces_usage_tokens_nonnegative;

alter table public.cowork_workspaces
  add constraint cowork_workspaces_usage_tokens_nonnegative
  check (usage_tokens >= 0);

create unique index if not exists cowork_workspaces_org_case_number_uidx
  on public.cowork_workspaces (organization_id, case_number)
  where case_number is not null;

create index if not exists cowork_workspaces_source_intake_idx
  on public.cowork_workspaces (source_intake_id)
  where source_intake_id is not null;
