-- ============================================================================
-- Indexes for the operating loop's sensors scans.
--
-- public.sensors (00000000000001_operating_loop_baseline.sql:102-114) shipped
-- with no index beyond its primary key, and three hot paths scan it:
--   * run_agent_loop (00000000000007_continuous_agent_loop.sql:39) —
--       where se.organization_id = :org and se.status in ('alarm','warning')
--     every 5 minutes, once per organization;
--   * simulate_telemetry_tick (00000000000013_realtime_operating_picture.sql:46)
--     runs every minute and correlates per organization_id;
--   * asset detail surfaces join sensors on asset_id.
--
-- One index per scanned column. run_agent_loop's two-column predicate is
-- served by a bitmap-AND of the organization_id and status indexes; separate
-- single-column indexes also keep each one useful alone (org-wide listings,
-- asset joins) instead of only as a composite prefix.
-- ============================================================================

create index if not exists idx_sensors_organization_id
  on public.sensors (organization_id);

create index if not exists idx_sensors_asset_id
  on public.sensors (asset_id);

create index if not exists idx_sensors_status
  on public.sensors (status);
