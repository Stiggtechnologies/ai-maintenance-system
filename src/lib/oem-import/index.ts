/**
 * Matching an OEM component hierarchy onto a derived component breakdown.
 *
 * WHAT THIS IS FOR.
 *
 * The drafts derived from work-order history have flat components: one entry
 * called "UNDERCARRIAGE" standing for the whole system, because that is the
 * granularity the register codes at. An OEM parts hierarchy has the real
 * maintainable items underneath — rollers, idlers, sprockets, chain, guards —
 * and that depth is what turns a 18-line breakdown into something an engineer
 * can actually work against.
 *
 * THE HARD PART IS NOT THE MERGE, IT IS THE MATCH.
 *
 * The operator codes "UNDERCARRIAGE". The OEM calls it "Undercarriage Group",
 * or "Track Roller Frame Gp", or splits it across three groups. Nothing
 * guarantees a name in one vocabulary corresponds to a name in the other, and a
 * matcher that always produces an answer will produce wrong ones silently —
 * attaching a transmission's parts under the engine and looking entirely
 * plausible in a tree view.
 *
 * So this scores, thresholds, and REPORTS WHAT IT COULD NOT MATCH. An unmatched
 * OEM group is listed rather than forced somewhere, and an ambiguous one (two
 * candidates within a whisker of each other) is refused rather than resolved by
 * whichever happened to sort first.
 *
 * WHAT THE MERGE MUST NOT DO.
 *
 * It must not touch the consequence ranking. That ranking comes from the
 * operator's own downtime and is the most valuable thing on the draft — an OEM
 * hierarchy knows what parts exist and nothing whatever about which of them
 * costs this fleet its availability.
 *
 * Pure functions. No database, no network.
 */

export interface OemGroup {
  /** OEM group identifier, e.g. a Cat media/group number. */
  oemCode: string;
  name: string;
  /** Parent OEM group, for hierarchies more than one level deep. */
  parentOemCode?: string | null;
  /** Maintainable items directly under this group. */
  items: Array<{ partNumber?: string | null; name: string }>;
}

export interface DerivedComponentRef {
  code: string;
  name: string;
}

export type MatchVerdict = "matched" | "ambiguous" | "unmatched";

export interface GroupMatch {
  oemCode: string;
  oemName: string;
  verdict: MatchVerdict;
  /** Component code matched to, when the verdict is "matched". */
  componentCode: string | null;
  score: number;
  runnerUp: { componentCode: string; score: number } | null;
  reason: string;
}

/** Below this a match is a coincidence of common words. */
const MATCH_THRESHOLD = 0.5;
/** Two candidates closer than this apart cannot be told apart honestly. */
const AMBIGUITY_MARGIN = 0.12;

/** Words that appear everywhere and carry no discriminating power. */
const STOPWORDS = new Set([
  "group",
  "gp",
  "system",
  "sys",
  "assembly",
  "assy",
  "and",
  "the",
  "of",
  "for",
  "machine",
  "arrangement",
  "ar",
]);

function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}

/** Jaccard over meaningful tokens. Symmetric, and unimpressed by long names. */
function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  const union = ta.size + tb.size - shared;
  return union === 0 ? 0 : shared / union;
}

export function matchGroups(
  oemGroups: OemGroup[],
  components: DerivedComponentRef[],
): GroupMatch[] {
  return oemGroups.map((g) => {
    const scored = components
      .map((c) => ({
        componentCode: c.code,
        score: Math.max(similarity(g.name, c.name), similarity(g.name, c.code)),
      }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    const second = scored[1] ?? null;

    if (!best || best.score < MATCH_THRESHOLD) {
      return {
        oemCode: g.oemCode,
        oemName: g.name,
        verdict: "unmatched" as const,
        componentCode: null,
        score: best?.score ?? 0,
        runnerUp: null,
        reason: `No derived component scores above ${MATCH_THRESHOLD} against "${g.name}"${best ? ` (best was ${best.componentCode} at ${best.score.toFixed(2)})` : ""}. Listed rather than attached: this group is either a system the register never codes, or it is coded under a name that shares no words with the OEM's. Both need a person, and neither is served by a guess.`,
      };
    }

    if (second && best.score - second.score < AMBIGUITY_MARGIN) {
      return {
        oemCode: g.oemCode,
        oemName: g.name,
        verdict: "ambiguous" as const,
        componentCode: null,
        score: best.score,
        runnerUp: { componentCode: second.componentCode, score: second.score },
        reason: `"${g.name}" scores ${best.score.toFixed(2)} against ${best.componentCode} and ${second.score.toFixed(2)} against ${second.componentCode} — closer together than ${AMBIGUITY_MARGIN}. Attaching it to the higher one would be resolving a tie by rounding, and the parts would look correctly placed either way.`,
      };
    }

    return {
      oemCode: g.oemCode,
      oemName: g.name,
      verdict: "matched" as const,
      componentCode: best.componentCode,
      score: best.score,
      runnerUp: second
        ? { componentCode: second.componentCode, score: second.score }
        : null,
      reason: `"${g.name}" matched to ${best.componentCode} at ${best.score.toFixed(2)}${second ? `, clear of ${second.componentCode} at ${second.score.toFixed(2)}` : ""}.`,
    };
  });
}

export interface MergeResult {
  /** Component code -> maintainable items to add beneath it. */
  additions: Array<{
    componentCode: string;
    items: Array<{
      partNumber?: string | null;
      name: string;
      oemGroup: string;
    }>;
  }>;
  matched: number;
  ambiguous: GroupMatch[];
  unmatched: GroupMatch[];
  /** Derived components no OEM group matched. */
  componentsNotDeepened: string[];
  reason: string;
}

export function mergeHierarchy(
  oemGroups: OemGroup[],
  components: DerivedComponentRef[],
): MergeResult {
  const matches = matchGroups(oemGroups, components);
  const byComponent = new Map<
    string,
    Array<{ partNumber?: string | null; name: string; oemGroup: string }>
  >();

  for (const m of matches) {
    if (m.verdict !== "matched" || !m.componentCode) continue;
    const group = oemGroups.find((g) => g.oemCode === m.oemCode)!;
    const list = byComponent.get(m.componentCode) ?? [];
    for (const item of group.items) {
      list.push({
        partNumber: item.partNumber,
        name: item.name,
        oemGroup: group.name,
      });
    }
    byComponent.set(m.componentCode, list);
  }

  const ambiguous = matches.filter((m) => m.verdict === "ambiguous");
  const unmatched = matches.filter((m) => m.verdict === "unmatched");
  const notDeepened = components
    .filter((c) => !byComponent.has(c.code))
    .map((c) => c.name);

  const totalItems = [...byComponent.values()].reduce(
    (n, l) => n + l.length,
    0,
  );

  return {
    additions: [...byComponent.entries()].map(([componentCode, items]) => ({
      componentCode,
      items,
    })),
    matched: matches.filter((m) => m.verdict === "matched").length,
    ambiguous,
    unmatched,
    componentsNotDeepened: notDeepened,
    reason:
      `${matches.filter((m) => m.verdict === "matched").length} of ${oemGroups.length} OEM group(s) matched a derived component, adding ${totalItems} maintainable item(s). ` +
      (ambiguous.length > 0
        ? `${ambiguous.length} were ambiguous and attached to nothing — ${ambiguous.map((a) => a.oemName).join(", ")}. `
        : "") +
      (unmatched.length > 0
        ? `${unmatched.length} matched nothing and are listed for a person. `
        : "") +
      (notDeepened.length > 0
        ? `${notDeepened.length} derived component(s) gained no depth: ${notDeepened.slice(0, 5).join(", ")}${notDeepened.length > 5 ? ", …" : ""}. `
        : "") +
      `Consequence ranking is untouched — it comes from this fleet's downtime, and a parts hierarchy knows what exists without knowing what costs.`,
  };
}
