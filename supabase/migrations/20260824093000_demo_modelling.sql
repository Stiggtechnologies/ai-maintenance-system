-- ============================================================================
-- Demo fixtures for the modelling family (C7.02, C7.05, C7.10, C7.12, C7.13).
--
-- Each fixture is built to exercise a REFUSAL as well as a result, because a
-- model that only ever succeeds proves nothing about whether its guards work.
-- Specifically:
--
--   * the fault tree contains a single point of failure AND a basic event with
--     no assessed probability, so the panel must show the cut sets and refuse
--     the top-event arithmetic at the same time;
--   * the shutdown schedule contains a task with generous float and a wide
--     duration range, which is the case a bar chart hides;
--   * asset_economics is populated for SOME assets only, so the cost proxy has
--     to report its own coverage rather than quietly costing a subset.
--
-- Demo organization only.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Economics. The table was entirely empty platform-wide, which meant the cost
-- proxy evaluated to zero for every asset and would have rendered as "no cost"
-- rather than "no data". Populated for the mining fleet only; the fixed plant
-- is deliberately left out, so 30 of 37 assets carry economics and the posture
-- figure shows a real gap rather than a clean 100%.
-- ---------------------------------------------------------------------------
insert into asset_economics (
  organization_id, asset_id, asset_class, replacement_value_usd,
  annual_maintenance_cost_usd, downtime_cost_per_hour_usd,
  expected_repair_cost_usd, expected_repair_hours, basis, register_ref
)
select a.organization_id, a.id, a.asset_class,
       case a.asset_class
         when 'Electric Rope Shovel' then 28000000
         when 'Hydraulic Mining Shovel' then 9000000
         when 'Autonomous Haul Truck (AHS)' then 6500000
         when 'Ultra-Class Haul Truck' then 5500000
         else 1200000 end,
       case a.asset_class
         when 'Electric Rope Shovel' then 2400000
         when 'Hydraulic Mining Shovel' then 900000
         else 550000 end,
       -- Downtime cost per hour reflects what the machine holds up, not what
       -- it costs to fix. A shovel stops a whole loading face; one truck of
       -- twenty-two does not.
       case a.asset_class
         when 'Electric Rope Shovel' then 18000
         when 'Hydraulic Mining Shovel' then 11000
         when 'Autonomous Haul Truck (AHS)' then 1400
         when 'Ultra-Class Haul Truck' then 1400
         else 3200 end,
       case a.asset_class
         when 'Electric Rope Shovel' then 85000
         when 'Hydraulic Mining Shovel' then 42000
         else 18000 end,
       12,
       'Demo fixture. Order-of-magnitude figures for a large surface mining '
       || 'operation; not this operator''s actual economics and not to be used '
       || 'for a real business case.',
       'C7.12'
from assets a
where a.organization_id = '11111111-1111-1111-1111-111111111111'
  and a.asset_class in ('Electric Rope Shovel','Hydraulic Mining Shovel',
                        'Autonomous Haul Truck (AHS)','Ultra-Class Haul Truck')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Fault tree: loss of the primary crushing circuit.
-- ---------------------------------------------------------------------------
insert into fault_trees (organization_id, tree_key, title, top_event, scope_note, basis)
values (
  '11111111-1111-1111-1111-111111111111','FT-CRUSH-01',
  'Loss of primary crushing',
  'Primary crushing circuit unable to accept feed for more than 4 hours',
  'Bounded at the crusher discharge. Downstream conveying is a separate tree.',
  'Demo fixture built to exercise the analysis, including its refusals. Basic-'
  || 'event probabilities are illustrative order-of-magnitude figures, and one '
  || 'is deliberately left unassessed to show that the top-event arithmetic '
  || 'refuses rather than defaulting it to zero.'
)
on conflict (organization_id, tree_key) do nothing;

insert into fault_tree_nodes
  (tree_id, node_key, label, gate, vote_threshold, parent_key, probability, probability_basis)
select t.id, v.node_key, v.label, v.gate, v.vote, v.parent, v.prob, v.pbasis
from fault_trees t,
(values
  ('TOP','Primary crushing unavailable >4h','OR',null,null,null::numeric,null),
  ('G_MECH','Crusher mechanically down','OR',null,'TOP',null,null),
  ('G_POWER','Loss of drive power','AND',null,'TOP',null,null),
  ('G_FEED','No feed presented','VOTE',2,'TOP',null,null),

  ('e_mantle','Mantle or concave failure',null,null,'G_MECH',0.02,
   'Illustrative. Roughly one event per 50 operating periods.'),
  ('e_lube','Lube system trip',null,null,'G_MECH',0.03,
   'Illustrative.'),
  ('e_spider','Spider bushing seizure',null,null,'G_MECH',null,
   'NOT ASSESSED. Left null deliberately: the analysis must refuse a top-event '
   || 'probability rather than treat an unassessed event as impossible.'),

  ('e_sub_a','Substation A unavailable',null,null,'G_POWER',0.005,'Illustrative.'),
  ('e_sub_b','Substation B unavailable',null,null,'G_POWER',0.005,'Illustrative.'),

  ('e_ap1','Apron feeder 1 down',null,null,'G_FEED',0.04,'Illustrative.'),
  ('e_ap2','Apron feeder 2 down',null,null,'G_FEED',0.04,'Illustrative.'),
  ('e_ap3','Apron feeder 3 down',null,null,'G_FEED',0.04,'Illustrative.')
) as v(node_key,label,gate,vote,parent,prob,pbasis)
where t.tree_key = 'FT-CRUSH-01'
  and t.organization_id = '11111111-1111-1111-1111-111111111111'
on conflict (tree_id, node_key) do nothing;

-- A second tree that IS fully assessed, so the panel shows both a refusal and
-- a computed result side by side. Without this, "refuses" is indistinguishable
-- from "does not work".
insert into fault_trees (organization_id, tree_key, title, top_event, scope_note, basis)
values (
  '11111111-1111-1111-1111-111111111111','FT-HOIST-01',
  'Uncontrolled hoist lowering',
  'Shovel hoist drum lowers under load without operator command',
  'Hoist drive, brakes and the 2oo3 overspeed trip only.',
  'Demo fixture. Every basic event is assessed so the top-event probability '
  || 'and the Fussell-Vesely ranking are computable end to end.'
)
on conflict (organization_id, tree_key) do nothing;

insert into fault_tree_nodes
  (tree_id, node_key, label, gate, vote_threshold, parent_key, probability, probability_basis)
select t.id, v.node_key, v.label, v.gate, v.vote, v.parent, v.prob, v.pbasis
from fault_trees t,
(values
  ('TOP','Uncontrolled lowering','AND',null,null,null::numeric,null),
  ('G_BRAKE','Both service brakes fail','AND',null,'TOP',null,null),
  ('G_TRIP','Overspeed trip fails to act','VOTE',2,'TOP',null,null),

  ('e_brk_a','Brake A fails to hold',null,null,'G_BRAKE',0.01,'Illustrative.'),
  ('e_brk_b','Brake B fails to hold',null,null,'G_BRAKE',0.01,'Illustrative.'),
  ('e_sen_1','Overspeed sensor 1 fails',null,null,'G_TRIP',0.02,'Illustrative.'),
  ('e_sen_2','Overspeed sensor 2 fails',null,null,'G_TRIP',0.02,'Illustrative.'),
  ('e_sen_3','Overspeed sensor 3 fails',null,null,'G_TRIP',0.02,'Illustrative.')
) as v(node_key,label,gate,vote,parent,prob,pbasis)
where t.tree_key = 'FT-HOIST-01'
  and t.organization_id = '11111111-1111-1111-1111-111111111111'
on conflict (tree_id, node_key) do nothing;

-- ---------------------------------------------------------------------------
-- Shutdown schedule.
--
-- SCAFFOLD carries 44 hours of float and a duration ranging from 12 to 96, so
-- it is the task a bar chart would call safe. The simulation puts it on the
-- critical path in about 4% of runs — real, but correctly below the threshold
-- for a flagged hidden risk, because the competing STRIP-INSPECT-MACHINE chain
-- stretches too. That is the honest outcome and the panel shows the 4% rather
-- than only the tasks that cross the flag.
-- ---------------------------------------------------------------------------
insert into shutdown_events
  (organization_id, event_key, title, planned_start, planned_duration_hours, status)
values (
  '11111111-1111-1111-1111-111111111111','SD-2026-CRUSH',
  'Primary crusher major shutdown', '2026-09-14T06:00:00Z', null, 'planning'
)
on conflict (organization_id, event_key) do nothing;

insert into shutdown_tasks
  (event_id, task_key, label, duration_hours, optimistic_hours, pessimistic_hours)
select e.id, v.k, v.l, v.d, v.o, v.p
from shutdown_events e,
(values
  ('ISOLATE','Isolate and de-energise',           8,   6,  14),
  ('SCAFFOLD','Erect access scaffold',           24,  12,  96),
  ('STRIP','Strip mantle and concave',           36,  30,  60),
  ('INSPECT','Inspect spider and main shaft',    12,   8,  40),
  ('MACHINE','Machine seat faces',               20,  16,  30),
  ('REBUILD','Install new mantle and concave',   40,  34,  56),
  ('LUBE','Recommission lube system',            10,   8,  24),
  ('COMMISSION','No-load run and handover',      12,  10,  20)
) as v(k,l,d,o,p)
where e.event_key = 'SD-2026-CRUSH'
  and e.organization_id = '11111111-1111-1111-1111-111111111111'
on conflict (event_id, task_key) do nothing;

insert into shutdown_task_dependencies (event_id, task_key, predecessor_key)
select e.id, v.t, v.pre
from shutdown_events e,
(values
  ('SCAFFOLD','ISOLATE'),
  ('STRIP','ISOLATE'),
  ('INSPECT','STRIP'),
  ('MACHINE','INSPECT'),
  ('REBUILD','MACHINE'),
  ('REBUILD','SCAFFOLD'),
  ('LUBE','ISOLATE'),
  ('COMMISSION','REBUILD'),
  ('COMMISSION','LUBE')
) as v(t,pre)
where e.event_key = 'SD-2026-CRUSH'
  and e.organization_id = '11111111-1111-1111-1111-111111111111'
on conflict (event_id, task_key, predecessor_key) do nothing;

notify pgrst, 'reload schema';
