#!/usr/bin/env node
/**
 * Transfer embedded KB chunks from one Supabase project to another without
 * re-embedding (free-tier embedding quotas make re-runs expensive).
 *
 * Usage:
 *   node scripts/transfer_kb_to_cloud.mjs <SRC_URL> <SRC_SERVICE_KEY> <DST_URL> <DST_SERVICE_KEY>
 */
const [, , srcUrl, srcKey, dstUrl, dstKey] = process.argv;
if (!srcUrl || !srcKey || !dstUrl || !dstKey) {
  console.error("usage: transfer_kb_to_cloud.mjs <SRC_URL> <SRC_KEY> <DST_URL> <DST_KEY>");
  process.exit(1);
}

const PAGE = 50;
let offset = 0;
let total = 0;

// Clean citation titles at transfer time.
const TITLE_MAP = [
  [/DoD_Reliability|RAM.*Guide|RAM_Guide/i, "DoD RAM Guide"],
  [/MIL-?HDBK-?338/i, "MIL-HDBK-338B"],
  [/RADC-?TR-?85-?194/i, "RADC-TR-85-194"],
  [/failure-?investigation|tc-?oil/i, "Failure Investigation Report (TC Oil, 2017)"],
];
const cleanTitle = (t) => {
  for (const [re, name] of TITLE_MAP) if (re.test(t)) return name;
  return t;
};

for (;;) {
  const res = await fetch(
    `${srcUrl}/rest/v1/reliability_kb_chunks?select=*&order=chunk_id&limit=${PAGE}&offset=${offset}`,
    { headers: { apikey: srcKey, Authorization: `Bearer ${srcKey}` } },
  );
  if (!res.ok) throw new Error(`read failed: ${res.status}`);
  const rows = await res.json();
  if (rows.length === 0) break;

  const cleaned = rows.map(({ id, created_at, ...r }) => ({ ...r, title: cleanTitle(r.title) }));
  const up = await fetch(`${dstUrl}/rest/v1/reliability_kb_chunks?on_conflict=chunk_id`, {
    method: "POST",
    headers: {
      apikey: dstKey,
      Authorization: `Bearer ${dstKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(cleaned),
  });
  if (!up.ok) throw new Error(`upsert failed: ${up.status} ${(await up.text()).slice(0, 200)}`);
  total += rows.length;
  offset += PAGE;
  console.log(`transferred ${total}`);
}
console.log(`done: ${total} chunks`);
