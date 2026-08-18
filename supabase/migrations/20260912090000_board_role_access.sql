-- ============================================================================
-- Board seat — the two server filters that excluded the 'board' role.
--
-- navigation-lifecycle-ia.md §3 recorded the state honestly: "A `board` role
-- today would see fewer KPIs than an executive and an empty board pack.
-- Adding it to those arrays is an authorization change, not nav wiring."
-- The owner has now approved that authorization change (§5 Step 8's named
-- customer decision), and this migration is exactly the two edits the IA
-- named — nothing more:
--
--   1. The four Board-accountable KPI rows (00000000000017_kpi_service.sql
--      :82-89 — asset_value_realization, strategic_asset_alignment,
--      am_maturity_index, stakeholder_value_index) gain 'board' in their
--      audience arrays, so get_kpi_dashboard / get_accountability_cascade
--      (which filter on `v_role = any(c.audience)`) return them to the role
--      that is ACCOUNTABLE for them in the catalogue's own RACI.
--   2. board_packs_read (20260808210000_accountability_cascade.sql:311-318)
--      admits 'board', so the board can read the packs prepared FOR it.
--
-- What this deliberately does NOT do:
--   * no approval authority — app_role_has_approval_authority (migration 22)
--     is untouched and continues to exclude 'board';
--   * no decision_rights rows, no authority_limits row, no write path of any
--     kind — the board surface is read-only end to end;
--   * no change to generate_board_pack's gate — preparing a pack remains an
--     executive/admin act; the board reads what was prepared and attested.
--
-- The honest state, carried to the screen: three of the four Board KPIs are
-- seeded computable=false (strategy register, ISO 55001 maturity assessment,
-- stakeholder scoring — each row's source_note names its missing input).
-- Granting the board its KPIs grants it one live number and three named
-- gaps, and the KPI screen now says so in words (ExecutiveIntelligence).
-- ============================================================================

-- 1. The four Board-accountable KPI audiences. Idempotent: append only where
--    'board' is not already present, and only to the four rows the catalogue
--    marks Board-accountable. Rows whose audience is NULL (visible to all
--    roles) are untouched — NULL already includes the board.
update kpi_catalog
set audience = audience || array['board']
where kpi_key in (
    'asset_value_realization',
    'strategic_asset_alignment',
    'am_maturity_index',
    'stakeholder_value_index'
  )
  and accountable = 'Board'
  and audience is not null
  and not ('board' = any (audience));

-- 2. Board packs are board-tier material: the board may now read its own
--    packs. Same shape as the original policy with one role added; still
--    SELECT-only — pack preparation and attestation gates are unchanged.
drop policy if exists board_packs_read on board_packs;
create policy board_packs_read on board_packs
  for select to authenticated using (
    organization_id = app_current_org()
    and exists (
      select 1 from user_profiles p
      where p.id = auth.uid()
        and p.role in ('board', 'executive', 'admin', 'ai_admin')
    )
  );
