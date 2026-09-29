-- D9.06: an observation is learning, not a new execution engine or a failure.
-- This migration defines the subject only. The governed recorder follows;
-- until then INSERT is deliberately refused for every caller.
alter table public.learning_events
  add column standard_procedure_id bigint references public.procedure_translations(id) on delete restrict,
  add column standard_execution_work_order_id uuid references public.work_orders(id) on delete restrict,
  add column standard_execution_evidence_id uuid references public.evidence_items(id) on delete restrict,
  add column standard_execution_observed_at timestamptz,
  add column standard_execution_recorded_by uuid references auth.users(id) on delete restrict,
  add column standard_execution_description text,
  add column standard_variation_kind text,
  add column standard_variation_basis text,
  add column standard_outcome_description text,
  add column standard_outcome_evidence_id uuid references public.evidence_items(id) on delete restrict;

alter table public.learning_events add constraint standard_work_observation_complete check (
  case when event_type='standard_work_observation' then
    standard_procedure_id is not null and standard_execution_work_order_id is not null
    and standard_execution_evidence_id is not null and standard_execution_observed_at is not null
    and standard_execution_recorded_by is not null
    and coalesce(length(btrim(standard_execution_description)) between 10 and 10000,false)
    and coalesce(standard_variation_kind in ('conforming','varied','undetermined'),false)
    and coalesce(length(btrim(standard_variation_basis)) between 10 and 10000,false)
    and coalesce(length(btrim(standard_outcome_description)) between 10 and 10000,false)
    and standard_outcome_evidence_id is not null
    and coalesce(length(btrim(title)) between 3 and 500,false)
    and coalesce(length(btrim(detail)) between 10 and 10000,false)
    and coalesce(length(btrim(applicability)) between 10 and 10000,false)
    and failure_mode_key is null and cause is null and corrective_action is null
    and expected_value is null and verified_value is null and model_confidence is null
  else
    standard_procedure_id is null and standard_execution_work_order_id is null
    and standard_execution_evidence_id is null and standard_execution_observed_at is null
    and standard_execution_recorded_by is null and standard_execution_description is null
    and standard_variation_kind is null and standard_variation_basis is null
    and standard_outcome_description is null and standard_outcome_evidence_id is null
  end
);

-- Preserve ordinary failure lessons and the existing project-outcome subtype.
-- The additional exception has its own complete subject constraint above.
alter table public.learning_events drop constraint learning_events_case_lesson_complete;
alter table public.learning_events add constraint learning_events_case_lesson_complete check (
  development_case_id is null or event_type in ('project_outcome','standard_work_observation') or (
    failure_mode_key is not null and failure_mode_key=any(public.sync_delivery_failure_types())
    and cause is not null and btrim(cause)<>''
    and corrective_action is not null and btrim(corrective_action)<>''
    and applicability is not null and btrim(applicability)<>''
  )
);

create or replace function public.guard_standard_work_observation()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op in ('UPDATE','DELETE') and old.event_type='standard_work_observation' then
    raise exception 'standard-work observations are immutable; retain corrections as new evidence';
  end if;
  if tg_op<>'DELETE' and new.event_type='standard_work_observation' then
    raise exception 'standard-work observations require the governed recorder; capture is not yet enabled';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger standard_work_observation_guard before insert or update or delete
  on public.learning_events for each row execute function public.guard_standard_work_observation();

comment on column public.learning_events.standard_variation_kind is
  'Explicit observation: conforming, varied, or undetermined. Not proof of improvement or authorization to execute.';

-- Observation history points to exact procedure content, not a mutable label.
-- A later recorder must lock the standard and procedure while taking references.
create or replace function public.guard_observed_standard_history()
returns trigger language plpgsql security definer set search_path=public as $$
declare referenced boolean;
begin
  if tg_table_name='procedure_translations' then
    select exists(select 1 from public.learning_events l
      where l.standard_procedure_id=old.id) into referenced;
  else
    select exists(select 1 from public.learning_events l
      join public.procedure_translations p on p.id=l.standard_procedure_id
      where p.standard_work_id=old.id) into referenced;
  end if;
  if referenced and (tg_op='DELETE' or to_jsonb(new) is distinct from to_jsonb(old)) then
    raise exception 'Observed standard/procedure history is immutable; create a new version';
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger observed_procedure_history_guard before update or delete on public.procedure_translations
  for each row execute function public.guard_observed_standard_history();
create trigger observed_standard_history_guard before update or delete on public.standard_work
  for each row execute function public.guard_observed_standard_history();
revoke all on function public.guard_observed_standard_history() from public;
