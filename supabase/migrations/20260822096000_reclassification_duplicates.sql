-- ============================================================================
-- Record the ten reclassification splits as duplicate CANDIDATES (E12.12).
--
-- Ten unit numbers appear twice in the auxiliary fleet, once as "Dozer NNNN"
-- and once as "Support Dozer NNNN". Their work histories do not overlap by a
-- single day: every "Dozer" record ends between 3 and 18 April 2012 and every
-- "Support Dozer" record begins between 20 April and 14 May 2012.
--
-- Two machines sharing a unit number would run concurrently. A clean handover
-- across a two-week window, ten times, is one machine RECLASSIFIED — and the
-- import created a second asset record for each, splitting ten failure
-- histories in half at an arbitrary date. Half a history fits a Weibull
-- perfectly well while being wrong.
--
-- THESE ARE CANDIDATES, NOT MERGES. Merging is a judgement about the operator's
-- own fleet and belongs to the operator. The evidence is recorded so the
-- decision can be made on facts rather than on a hunch.
--
-- WHY THE DUPLICATE DETECTOR MISSED THEM. detectDuplicates excludes pairs whose
-- asset_class differs, to stop a "Pump 1" and a "Compressor 1" matching. That
-- exclusion is right in general and suppresses exactly this case. The rule
-- below — same unit number, non-overlapping history — is the one that catches
-- a reclassification, and it is why these are inserted explicitly rather than
-- waiting for the generic detector to find them.
-- ============================================================================

-- Note on ordering: pairs are keyed a.id < b.id by UUID, which says nothing
-- about which record came first in time. The non-overlap test therefore
-- compares the EARLIER-ending against the LATER-starting record rather than
-- assuming a is the earlier one — an earlier version of this insert assumed it
-- and silently found only four of the ten.
insert into duplicate_asset_candidates (organization_id, asset_a, asset_b,
  confidence, basis)
select a.organization_id, a.id, b.id, 'probable',
  'Same unit number ' || (regexp_match(a.name, '([0-9]{3,6})'))[1]
  || ' with NON-OVERLAPPING work history: "'
  || case when ah.last_wo < bh.first_wo then a.name else b.name end || '" ran to '
  || to_char(least(ah.last_wo, bh.last_wo), 'YYYY-MM-DD') || ' and "'
  || case when ah.last_wo < bh.first_wo then b.name else a.name end || '" began '
  || to_char(greatest(ah.first_wo, bh.first_wo), 'YYYY-MM-DD')
  || '. Two machines sharing a number would run concurrently; a clean handover '
  || 'is one machine reclassified, and the split leaves ' || ah.wos || ' and '
  || bh.wos || ' work orders on what may be a single history.'
from assets a
join assets b
  on b.organization_id = a.organization_id
 and (regexp_match(a.name, '([0-9]{3,6})'))[1] = (regexp_match(b.name, '([0-9]{3,6})'))[1]
 and a.id < b.id
join lateral (select count(*) wos, min(created_at)::date first_wo, max(created_at)::date last_wo
              from work_orders w where w.asset_id = a.id) ah on true
join lateral (select count(*) wos, min(created_at)::date first_wo, max(created_at)::date last_wo
              from work_orders w where w.asset_id = b.id) bh on true
where a.organization_id = '5e08b0a4-bb63-43d6-90f8-e42d532f65fd'
  and ah.wos > 0 and bh.wos > 0
  -- The defining evidence: no overlap, in whichever direction it runs.
  and (ah.last_wo < bh.first_wo or bh.last_wo < ah.first_wo)
on conflict (organization_id, asset_a, asset_b) do nothing;
