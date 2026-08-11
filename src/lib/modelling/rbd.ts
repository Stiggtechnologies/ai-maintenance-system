/**
 * Reliability block diagrams (capability register C7.02).
 *
 * An RBD answers one question: given how the plant is wired together, what does
 * a component's reliability do to the system's? The wiring already exists in
 * this platform — `asset_dependencies` records who supplies whom, which
 * redundancy group each supplier sits in, and how many of that group are needed.
 * So this module does NOT invent a topology. It compiles the recorded graph
 * into a block diagram and evaluates it.
 *
 * WHAT THIS DELIBERATELY REFUSES.
 *
 * Two things make an RBD dishonest, and both are refused rather than
 * approximated:
 *
 *   1. Blocks with no reliability figure. A missing R is not R = 1. Treating it
 *      as 1 makes the system look better for every gap in the data, which is
 *      the exact opposite of what a reliability model is for. Any block without
 *      a figure makes the result `computable: false`.
 *
 *   2. Non-independent blocks. Series/parallel formulas assume independence. If
 *      two blocks share a common-cause group, multiplying their unreliabilities
 *      understates the risk — often by a lot. Common cause is applied explicitly
 *      via a beta factor where a group is recorded, and where it is recorded
 *      WITHOUT a beta the result says so instead of silently assuming zero.
 *
 * Pure functions. No database, no network, no randomness.
 */

export interface RbdBlock {
  id: string;
  label: string;
  /** Reliability at the mission time, or availability. Null means unknown. */
  reliability: number | null;
  /**
   * Redundancy group this block belongs to, from asset_dependencies. Blocks in
   * the same group are parallel to each other; different groups are in series
   * (power AND cooling, not power OR cooling).
   */
  group: string;
  /** Common-cause group, if this block shares a failure mechanism with others. */
  commonCauseGroup?: string | null;
}

export interface RbdGroupSpec {
  group: string;
  /** k in k-out-of-n. 1 = pure parallel, n = pure series within the group. */
  minRequired: number;
  /**
   * Beta factor for common cause within this group (IEC 61508 style): the
   * fraction of failures that take the whole group at once. Null means no
   * common-cause assessment has been done — which is reported, not assumed 0.
   */
  betaFactor?: number | null;
}

export interface RbdGroupResult {
  group: string;
  n: number;
  minRequired: number;
  /** Reliability of this group as a single equivalent block. */
  reliability: number | null;
  /** Reliability ignoring common cause, kept so the effect is visible. */
  reliabilityIndependent: number | null;
  betaFactor: number | null;
  reason: string;
}

export interface RbdResult {
  systemReliability: number | null;
  /**
   * False whenever any block lacks a figure. The caller must not render a
   * number when this is false — there isn't one.
   */
  computable: boolean;
  groups: RbdGroupResult[];
  blocksMissingReliability: string[];
  /** Groups with a recorded common-cause group but no beta factor. */
  groupsWithUnquantifiedCommonCause: string[];
  reason: string;
}

/**
 * Exact k-out-of-n reliability for identical-or-not blocks, by summing over the
 * subsets that succeed. n is small in practice (a redundancy group is rarely
 * more than a handful), so exactness costs nothing and avoids the binomial
 * approximation's assumption that all blocks are identical.
 */
function kOutOfN(reliabilities: number[], k: number): number {
  const n = reliabilities.length;
  if (k <= 0) return 1;
  if (k > n) return 0;
  // dp[j] = probability exactly j of the blocks processed so far succeed.
  let dp = [1];
  for (const r of reliabilities) {
    const next = new Array(dp.length + 1).fill(0);
    for (let j = 0; j < dp.length; j++) {
      next[j] += dp[j] * (1 - r);
      next[j + 1] += dp[j] * r;
    }
    dp = next;
  }
  return dp.slice(k).reduce((s, p) => s + p, 0);
}

export function evaluateRbd(
  blocks: RbdBlock[],
  groupSpecs: RbdGroupSpec[],
): RbdResult {
  // Deduplicated by block id: one asset can supply two dependents and so appear
  // as two blocks. That is correct for the arithmetic — the same machine really
  // is required in both places — but listing it twice reads as two problems.
  const missing = [
    ...new Map(
      blocks
        .filter(
          (b) => b.reliability === null || !Number.isFinite(b.reliability),
        )
        .map((b) => [b.id, b.label]),
    ).values(),
  ];

  const specByGroup = new Map(groupSpecs.map((g) => [g.group, g]));
  const byGroup = new Map<string, RbdBlock[]>();
  for (const b of blocks) {
    const list = byGroup.get(b.group);
    if (list) list.push(b);
    else byGroup.set(b.group, [b]);
  }

  const unquantifiedCc: string[] = [];
  const groups: RbdGroupResult[] = [];

  for (const [group, members] of byGroup) {
    const spec = specByGroup.get(group) ?? { group, minRequired: 1 };
    const k = Math.max(1, Math.min(spec.minRequired, members.length));
    const rs = members.map((m) => m.reliability);
    const anyMissing = rs.some((r) => r === null || !Number.isFinite(r));

    if (anyMissing) {
      groups.push({
        group,
        n: members.length,
        minRequired: k,
        reliability: null,
        reliabilityIndependent: null,
        betaFactor: spec.betaFactor ?? null,
        reason: `${members.filter((m) => m.reliability === null).length} of ${members.length} block(s) in this group have no reliability figure. A missing figure is not 1.0 — the group is not evaluated.`,
      });
      continue;
    }

    const values = rs as number[];
    const independent = kOutOfN(values, k);

    const hasCcGroup = members.some(
      (m) => m.commonCauseGroup != null && m.commonCauseGroup !== "",
    );
    const beta = spec.betaFactor ?? null;

    let reliability = independent;
    let reason: string;

    if (members.length === 1 || k === members.length) {
      // No redundancy to defeat — common cause has nothing to act on.
      reason =
        k === members.length && members.length > 1
          ? `All ${members.length} block(s) required: series within the group, so redundancy contributes nothing and common cause has no redundancy to defeat.`
          : `Single block; nothing to reduce.`;
    } else if (hasCcGroup && beta !== null) {
      // IEC 61508 beta model: split each block's unreliability into an
      // independent part and a common part that fails the whole group at once.
      // Group succeeds = (no common-cause event) AND (k-of-n on independent
      // parts).
      const indepParts = values.map((r) => 1 - (1 - r) * (1 - beta));
      const commonFail =
        values.reduce((s, r) => s + (1 - r) * beta, 0) / values.length;
      reliability = (1 - commonFail) * kOutOfN(indepParts, k);
      reason = `${k}-out-of-${members.length} with a beta factor of ${(beta * 100).toFixed(1)}%. Redundancy alone would give ${(independent * 100).toFixed(3)}%; the shared failure mechanism takes it to ${(reliability * 100).toFixed(3)}%. That gap is what common cause costs.`;
    } else if (hasCcGroup) {
      unquantifiedCc.push(group);
      reliability = independent;
      reason = `${k}-out-of-${members.length}, computed assuming independence. These blocks are recorded as sharing a common-cause group but no beta factor has been assessed, so this figure is an UPPER bound on the real reliability, not an estimate of it.`;
    } else {
      reason = `${k}-out-of-${members.length} redundancy, blocks assumed independent — no common-cause group is recorded for them.`;
    }

    groups.push({
      group,
      n: members.length,
      minRequired: k,
      reliability,
      reliabilityIndependent: independent,
      betaFactor: beta,
      reason,
    });
  }

  groups.sort((a, b) => a.group.localeCompare(b.group));

  const computable = missing.length === 0 && groups.length > 0;
  // Groups are conjunctive: the system needs every group, so they multiply.
  const systemReliability = computable
    ? groups.reduce((p, g) => p * (g.reliability ?? 0), 1)
    : null;

  return {
    systemReliability,
    computable,
    groups,
    blocksMissingReliability: missing,
    groupsWithUnquantifiedCommonCause: unquantifiedCc,
    reason:
      blocks.length === 0
        ? "No blocks. Nothing to evaluate — this is an empty model, not a reliable system."
        : !computable
          ? // Both counts are of DISTINCT assets. Comparing a deduplicated
            // numerator against a raw block count reads as "one of them is fine"
            // when the truth is that none are.
            `${missing.length} of ${new Set(blocks.map((b) => b.id)).size} distinct asset(s) have no reliability figure: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}. No system figure is produced. Treating a missing figure as 1.0 would make the system look better the less is known about it.`
          : `System reliability ${(systemReliability! * 100).toFixed(3)}% across ${groups.length} series group(s). Groups are conjunctive — every one is required — so they multiply.` +
            (unquantifiedCc.length > 0
              ? ` ${unquantifiedCc.length} group(s) share a common-cause mechanism with no beta factor assessed, so this is an upper bound.`
              : ""),
  };
}

/**
 * Birnbaum importance for each block: how much the system reliability moves
 * per unit change in that block's reliability. This is what tells you where
 * effort pays, and it is not the same ranking as "least reliable block" — a bad
 * block inside deep redundancy can matter less than a good one in series.
 */
export interface BlockImportance {
  blockId: string;
  label: string;
  birnbaum: number;
  /** System reliability if this block were perfect. */
  systemIfPerfect: number;
  /** System reliability if this block had failed. */
  systemIfFailed: number;
  reason: string;
}

export function blockImportance(
  blocks: RbdBlock[],
  groupSpecs: RbdGroupSpec[],
): BlockImportance[] {
  const base = evaluateRbd(blocks, groupSpecs);
  if (!base.computable) return [];

  // One row per physical asset, not per block. Perturbing a shared asset
  // perturbs every copy of it, which is the right physics — but it also means
  // two copies produce two identical rows, so the duplicates are dropped.
  const uniqueBlocks = [...new Map(blocks.map((b) => [b.id, b])).values()];

  return uniqueBlocks
    .map((b) => {
      const perfect = evaluateRbd(
        blocks.map((x) => (x.id === b.id ? { ...x, reliability: 1 } : x)),
        groupSpecs,
      ).systemReliability!;
      const failed = evaluateRbd(
        blocks.map((x) => (x.id === b.id ? { ...x, reliability: 0 } : x)),
        groupSpecs,
      ).systemReliability!;
      const birnbaum = perfect - failed;
      return {
        blockId: b.id,
        label: b.label,
        birnbaum,
        systemIfPerfect: perfect,
        systemIfFailed: failed,
        reason:
          birnbaum < 1e-9
            ? `Improving ${b.label} moves system reliability by less than 1e-9. It sits behind enough redundancy that its own condition is almost irrelevant to the system — spend the effort elsewhere.`
            : `A one-point gain in ${b.label} moves the system by ${(birnbaum * 100).toFixed(3)} points. If it failed outright the system would sit at ${(failed * 100).toFixed(3)}%.`,
      };
    })
    .sort((a, b) => b.birnbaum - a.birnbaum);
}
