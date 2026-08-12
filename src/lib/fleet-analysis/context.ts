/**
 * Turns scoping findings into copilot context.
 *
 * The copilot grounds every answer in live org KPIs. That is right for an
 * onboarded tenant and useless for a prospect who has uploaded a file and
 * onboarded nothing — the findings sit in browser state the copilot cannot
 * see, so it would answer questions about someone else's fleet.
 *
 * This renders the findings as the same kind of compact grounding block, so
 * the agents can be worked with over an ad-hoc dataset. It is deliberately a
 * SUMMARY, not the rows: the point of the scoping path is that the data does
 * not leave the browser, and shipping 21,450 events into a prompt would
 * quietly undo that.
 */
import type { ScopingFindings } from "./index";

export function findingsAsContext(
  f: ScopingFindings,
  sourceName: string,
): string {
  const parts: string[] = [];
  parts.push(
    `UPLOADED DATASET (not onboarded, nothing stored): "${sourceName}" — ` +
      `${f.events.toLocaleString()} down events across ${f.assets} assets over ${f.spanDays} days, ` +
      `${f.totalDownHours.toLocaleString()} total down hours.`,
  );
  parts.push(
    `Split: ${f.correctiveEvents.toLocaleString()} corrective, ` +
      `${f.plannedEvents.toLocaleString()} planned activity, ` +
      `${f.delayEvents.toLocaleString()} delay events ` +
      `(${f.delayHours.toLocaleString()} h = ${f.delaySharePct}% of all downtime spent waiting).`,
  );
  if (f.byHours.length > 0)
    parts.push(
      "BIGGEST LOSSES BY HOURS: " +
        f.byHours
          .slice(0, 6)
          .map(
            (p) =>
              `${p.label} ${p.hours.toLocaleString()}h/${p.events}ev (${p.meanHours}h each)`,
          )
          .join("; "),
    );
  if (f.rankingInverts)
    parts.push(
      `NOTE: ranking by event count puts ${f.byCount[0].label} first while hours puts ${f.byHours[0].label} first — different problems.`,
    );
  if (f.worstAssets.length > 0)
    parts.push(
      "WORST ASSETS: " +
        f.worstAssets
          .slice(0, 6)
          .map(
            (a) =>
              `${a.asset} ${a.downtimeHours.toLocaleString()}h/${a.failures} failures`,
          )
          .join("; "),
    );
  if (f.dataQuality.length > 0)
    parts.push(
      "DATA QUALITY: " +
        f.dataQuality
          .map((q) => `${q.kind} (${q.count}, ${q.severity})`)
          .join("; "),
    );
  // The caveats travel with the numbers. An agent that quotes the availability
  // figure without the basis is doing the thing the caveats exist to prevent.
  parts.push(
    "CAVEATS THAT MUST TRAVEL WITH ANY FIGURE QUOTED: " + f.caveats.join(" "),
  );
  return parts.join("\n").slice(0, 2400);
}
