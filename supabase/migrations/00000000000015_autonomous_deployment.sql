-- ============================================================================
-- Autonomous system deployment — the fulfillment engine behind /deployments.
--
-- Before: the deployment configurator wrote a deployment_instances row with
-- status 'pending' and nothing ever processed it. Now provision_deployment()
-- materializes the workspace in one call:
--
--   1. Creates the site (if a new one was configured)
--   2. Creates an industry starter asset pack (clearly labelled, area
--      "Starter Pack") with live monitored points — the migration-11 trigger
--      AUTO-ONBOARDS every asset (RAM checklist + FMEA from the 45-class
--      library), the telemetry simulator starts walking the new sensors
--      within a minute, and the operating loop monitors them within five.
--   3. Opens a Cowork workspace for the rollout, notifies the org, and logs
--      the provisioning decision for the audit trail
--   4. Flips the instance to 'active'
--
-- One click → a living, self-onboarded, agent-monitored workspace.
-- ============================================================================

create or replace function public.provision_deployment(p_instance_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inst deployment_instances%rowtype;
  tpl deployment_templates%rowtype;
  v_org uuid;
  v_site uuid;
  v_site_name text;
  v_family text;
  starter record;
  v_asset uuid;
  v_tag text;
  v_suffix int;
  v_assets int := 0;
  v_sensors int := 0;
begin
  select * into inst from deployment_instances where id = p_instance_id;
  if inst.id is null then
    return jsonb_build_object('error', 'instance_not_found');
  end if;
  if auth.uid() is not null and inst.organization_id <> app_current_org() then
    return jsonb_build_object('error', 'forbidden');
  end if;
  if inst.status = 'active' then
    return jsonb_build_object('error', 'already_provisioned');
  end if;
  v_org := inst.organization_id;

  select * into tpl from deployment_templates where id = inst.template_id;
  v_family := coalesce(tpl.master_family, 'generic');

  -- ---- 1. Site ---------------------------------------------------------------
  if inst.site_id is not null then
    v_site := inst.site_id;
    select name into v_site_name from sites where id = v_site;
  else
    v_site_name := coalesce(nullif(trim(inst.site_name), ''), inst.name, 'New Site');
    insert into sites (organization_id, name, code)
    values (v_org, v_site_name,
            upper(left(regexp_replace(v_site_name, '[^A-Za-z]', '', 'g'), 3)) || '-' ||
            to_char((select count(*) + 1 from sites where organization_id = v_org), 'FM00'))
    returning id into v_site;
  end if;

  -- ---- 2. Industry starter pack (self-onboards via the assets trigger) --------
  for starter in
    select * from (values
      -- oil & gas / petrochemical
      ('oil_gas', 'P',  'Centrifugal Pump',        'Centrifugal Pump',        'high',
        'pressure', 'bar', 5.2, 7.0, 'vibration', 'mm/s', 3.4, 8.0),
      ('oil_gas', 'K',  'Process Gas Compressor',  'Centrifugal Compressor',  'critical',
        'temperature', 'degC', 92.0, 120.0, 'vibration', 'mm/s', 5.1, 9.0),
      ('oil_gas', 'HX', 'Feed/Effluent Exchanger', 'Shell & Tube Exchanger',  'medium',
        'temperature', 'degC', 141.0, 180.0, 'pressure', 'bar', 11.2, 16.0),
      -- mining
      ('mining', 'HT', 'Haul Truck',               'Ultra-Class Haul Truck',  'critical',
        'temperature', 'degC', 88.0, 110.0, 'pressure', 'bar', 6.1, 9.0),
      ('mining', 'C',  'Overland Conveyor',        'Belt Conveyor — Overland','critical',
        'vibration', 'mm/s', 6.2, 10.0, 'speed', 'm/s', 4.1, 4.5),
      ('mining', 'SH', 'Electric Rope Shovel',     'Electric Rope Shovel',    'critical',
        'temperature', 'degC', 71.0, 95.0, 'vibration', 'mm/s', 5.5, 9.5),
      -- manufacturing
      ('manufacturing', 'M',   'Line Drive Motor',  'Electric Motor',          'high',
        'temperature', 'degC', 68.0, 90.0, 'current', 'A', 61.0, 80.0),
      ('manufacturing', 'RB',  'Packaging Robot',   'Packaging Line Robot',    'medium',
        'vibration', 'mm/s', 2.1, 6.0, 'temperature', 'degC', 44.0, 65.0),
      ('manufacturing', 'CH',  'Process Chiller',   'HVAC Chiller',            'high',
        'temperature', 'degC', 7.2, 12.0, 'pressure', 'bar', 8.4, 12.0),
      -- power / utilities
      ('power', 'ST', 'Steam Turbine',              'Steam Turbine',           'critical',
        'vibration', 'mm/s', 4.2, 9.0, 'temperature', 'degC', 462.0, 540.0),
      ('power', 'TR', 'Main Transformer',           'Power Transformer',       'critical',
        'temperature', 'degC', 63.0, 95.0, 'current', 'A', 410.0, 600.0),
      ('power', 'G',  'Standby Generator',          'Diesel Generator',        'high',
        'temperature', 'degC', 76.0, 105.0, 'pressure', 'bar', 4.1, 6.0),
      -- data centers
      ('data_centers', 'DC',  'Compute Rack Row',   'Data Center Rack',        'critical',
        'temperature', 'degC', 24.1, 32.0, 'current', 'A', 28.0, 40.0),
      ('data_centers', 'UPS', 'UPS String',         'UPS System',              'critical',
        'temperature', 'degC', 27.0, 40.0, 'current', 'A', 55.0, 90.0),
      ('data_centers', 'CH',  'CRAH Chiller',       'HVAC Chiller',            'high',
        'temperature', 'degC', 8.1, 14.0, 'pressure', 'bar', 7.2, 11.0),
      -- generic fallback
      ('generic', 'P',   'Utility Pump',            'Centrifugal Pump',        'high',
        'pressure', 'bar', 4.8, 7.0, 'vibration', 'mm/s', 3.1, 8.0),
      ('generic', 'M',   'Drive Motor',             'Electric Motor',          'medium',
        'temperature', 'degC', 64.0, 90.0, 'current', 'A', 44.0, 70.0),
      ('generic', 'PLC', 'Process Controller',      'PLC Control System',      'high',
        'temperature', 'degC', 38.0, 55.0, 'current', 'A', 3.2, 6.0)
    ) as t(family, prefix, label, klass, crit, sig1, unit1, val1, thr1, sig2, unit2, val2, thr2)
    where t.family = case when v_family in ('oil_gas','mining','manufacturing','power','data_centers')
                          then v_family else 'generic' end
  loop
    -- Unique tag within the org (PREFIX-001, bumping if taken).
    v_suffix := 1;
    loop
      v_tag := starter.prefix || '-' || to_char(v_suffix, 'FM000');
      exit when not exists (select 1 from assets a where a.organization_id = v_org and a.tag = v_tag);
      v_suffix := v_suffix + 1;
    end loop;

    insert into assets (organization_id, site_id, tag, name, asset_class, criticality,
      status, health_score, risk_score, area, system, lifecycle_status)
    values (v_org, v_site, v_tag, starter.label || ' ' || v_tag, starter.klass, starter.crit,
      'healthy', 90, 20, 'Starter Pack', coalesce(tpl.name, 'Deployment Template'), 'new')
    returning id into v_asset;
    v_assets := v_assets + 1;

    insert into sensors (organization_id, asset_id, name, signal_type, unit, last_value, threshold, status, trend) values
      (v_org, v_asset, initcap(starter.sig1) || ' — ' || v_tag, starter.sig1, starter.unit1, starter.val1, starter.thr1, 'normal', 'stable'),
      (v_org, v_asset, initcap(starter.sig2) || ' — ' || v_tag, starter.sig2, starter.unit2, starter.val2, starter.thr2, 'normal', 'stable');
    v_sensors := v_sensors + 2;
  end loop;

  -- ---- 3. Workspace, notification, audit trail --------------------------------
  insert into cowork_workspaces (organization_id, title, objective, status, agents, progress, next_action, created_by)
  values (v_org,
    'Deployment — ' || coalesce(inst.name, v_site_name),
    'Stand up ' || coalesce(tpl.name, 'the new workspace') || ' at ' || v_site_name ||
    ': replace starter assets with the real register, connect the historian/CMMS, and take assets through go-live.',
    'active', array['Asset Management','Reliability Engineering','Planning & Scheduling'], 5,
    'Review the self-onboarded starter assets on the Asset Onboarding hub', inst.created_by);

  insert into notifications (organization_id, site_id, title, message)
  values (v_org, v_site, 'Workspace provisioned — ' || v_site_name,
    v_assets || ' starter assets are self-onboarding now; telemetry and the agent loop are already monitoring them.');

  insert into decisions (organization_id, decision_type, action_taken, approval_status,
    autonomy_mode, confidence_score, human_actor, rationale, outcome_status)
  values (v_org, 'deployment',
    'Provisioned ' || coalesce(tpl.name, 'workspace') || ' at ' || v_site_name ||
    ' (' || v_assets || ' assets, ' || v_sensors || ' monitored points)',
    'approved', coalesce(inst.autonomy_mode, 'advisory'), 95,
    (select coalesce(p.full_name, u.email) from auth.users u
      left join user_profiles p on p.id = u.id where u.id = inst.created_by),
    'Autonomous deployment from template: site created, starter pack materialized, every asset auto-onboarded through the RAM checklist engine.',
    'executed');

  insert into learning_events (organization_id, event_type, title, detail)
  values (v_org, 'lesson_learned', 'Workspace provisioned — ' || v_site_name,
    'Template ' || coalesce(tpl.name, '?') || ': ' || v_assets ||
    ' assets created and self-onboarded; live monitoring active.');

  -- ---- 4. Activate --------------------------------------------------------------
  update deployment_instances
  set status = 'active', site_id = v_site
  where id = p_instance_id;

  return jsonb_build_object(
    'provisioned', true,
    'site_id', v_site,
    'site', v_site_name,
    'assets_created', v_assets,
    'sensors_created', v_sensors,
    'template', tpl.name
  );
end
$$;

grant execute on function public.provision_deployment(uuid) to authenticated, service_role;
