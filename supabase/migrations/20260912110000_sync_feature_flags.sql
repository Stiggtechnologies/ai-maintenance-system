-- ============================================================================
-- Tenant-scoped feature flags, created for Sync Phase 0 (spec §39, §37
-- Phase 0/1) — and created, not extended, because the repository has no
-- feature-flag mechanism to extend. That claim was checked, not assumed:
--
--   * grep for "feature_flag" across src/, supabase/migrations/,
--     supabase/functions/, scripts/ returns nothing;
--   * the two near-misses are both legacy-compat shims in
--     00000000000002_legacy_compat.sql keyed on the DEAD tenancy model
--     (tenant_id referencing tenants, not organization_id referencing
--     organizations): tenant_settings (a free-form jsonb read by nothing
--     live) and user_preferences.javis_enabled (read only by the
--     never-imported OverviewDashboard.tsx). Extending either would build
--     Sync's rollout control on the tenancy model the platform migrated
--     away from.
--
-- The spec's own naming note (§39) says to preserve deployed jarvis_* flags
-- rather than strand rollout state — there are none deployed, so the sync_*
-- names ship first-hand with no compatibility layer.
--
-- DEFAULT-OFF IS THE SAFETY PROPERTY, AND IT IS STRUCTURAL. A missing row
-- means DISABLED — the read hook (src/hooks/useFeatureFlag.ts) fails closed
-- on absence, on error, and on timeout. The seeded rows below are therefore
-- not what turns Sync off; they are the visible, auditable catalogue of what
-- CAN be turned on, per organization, one row per flag, all enabled = false.
-- An organization created after this migration has no rows and is exactly as
-- OFF as one that has seven false rows.
--
-- NO CLIENT WRITE PATH, DELIBERATELY. RLS grants SELECT only. Flipping a
-- flag is a rollout act (§40: staged rollout with preserved rollback), not a
-- user preference, and this phase ships no admin UI. Until a governance
-- surface exists (§70 requires new capabilities to expose settings through a
-- consistent policy layer — this table is that seam), the only writers are
-- service-role paths: seeds, migrations, and operators with the service key.
-- When an admin surface arrives it must come as a gated SECURITY DEFINER
-- function in the idiom of screen_maintenance_notification
-- (20260906090000), recording who flipped what and when — the updated_by /
-- updated_at columns exist now so that function has somewhere honest to
-- write.
--
-- Canonical reuse: organizations, app_current_org() (00000000000001), the
-- RLS idiom of 20260904090000. Additive only; no existing object touched.
-- ============================================================================

create table if not exists feature_flags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Logical flag key, e.g. 'sync_global_shell'. Free text rather than an
  -- enum so adding a flag is a seed, not a schema change; the typed hook is
  -- where the known-key contract lives.
  flag_key text not null,
  enabled boolean not null default false,
  -- What turning this on actually does, in words an operator can act on.
  description text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, flag_key)
);

create index if not exists idx_feature_flags_org_key
  on feature_flags (organization_id, flag_key);

alter table feature_flags enable row level security;

drop policy if exists feature_flags_org_read on feature_flags;
create policy feature_flags_org_read on feature_flags
  for select to authenticated
  using (organization_id = app_current_org());

-- No insert/update/delete policy for authenticated: writes are service-side
-- until a governed admin function exists. This is the same posture as
-- stage_gate_reviews and the reliability-by-design tables — SELECT-only RLS
-- with mutation reserved for a future explicit, audited path.

-- ---------------------------------------------------------------------------
-- Seed the §39 sync_* flags, all OFF, for every existing organization.
--
-- Seven flags, exactly the spec's list, none invented. All false: Phase 0
-- changes no production behaviour (§37 Phase 0 acceptance), and every later
-- phase turns on its flag deliberately per tenant (§39 "tenant-level canary
-- rollout"), starting with sync_global_shell in Phase 1.
-- ---------------------------------------------------------------------------
insert into feature_flags (organization_id, flag_key, enabled, description)
select o.id, f.flag_key, false, f.description
from organizations o
cross join (
  values
    ('sync_global_shell',
     'Sync interaction shell mounted at the authenticated app shell (spec §37 Phase 1). Master gate: every other sync_* capability is inert while this is off.'),
    ('sync_voice_input',
     'Speech-to-text input for Sync conversations (spec §37 Phase 2).'),
    ('sync_voice_output',
     'Text-to-speech responses with interruption/barge-in (spec §37 Phase 2).'),
    ('sync_agent_routing',
     'Routing Sync requests to existing specialist agents through the orchestration contract (spec §37 Phase 4).'),
    ('sync_tools',
     'Governed tool proposal and execution from Sync conversations, behind approvals (spec §37 Phase 5).'),
    ('sync_meeting_mode',
     'Meeting and facilitation mode with structured outcomes (spec §37 Phase 6).'),
    ('sync_field_mode',
     'Field-guidance mode: voice-first stepwise procedures with explicit checkpoints (spec §37 Phase 7).')
) as f(flag_key, description)
on conflict (organization_id, flag_key) do nothing;
