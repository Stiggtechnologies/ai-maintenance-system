/**
 * Client preview of the C8.25 rule. The database is the authority.
 * Twenty characters matches the server's substantive-note refusal. It is not
 * an engineering limit, a weight, or a KPI target.
 */
export const SUBSTANTIVE_NOTE_CHARS = 20;

export const SYSTEM_KPI_EFFECTS = [
  "improves",
  "worsens",
  "unchanged",
  "unknown",
] as const;

export type SystemKpiEffect = (typeof SYSTEM_KPI_EFFECTS)[number];

export interface SystemKpiEffectDraft {
  kpiKey: string;
  page: string;
  effect: SystemKpiEffect;
  basis: string;
}

export function systemPageLabel(page: string): string {
  return page
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function missingSystemPages(
  pages: readonly string[],
  focalPage: string,
  effects: readonly { page: string }[],
): string[] {
  const covered = new Set(effects.map((effect) => effect.page));
  return pages.filter((page) => page !== focalPage && !covered.has(page));
}

/**
 * A proposal is single-KPI when it names fewer than two catalog KPIs or
 * leaves any other catalog page without an effect. Effects are never scored.
 */
export function systemOptimizationBlockers(input: {
  pages: readonly string[];
  focalKpiKey: string;
  focalPage: string;
  intent: string;
  effects: readonly SystemKpiEffectDraft[];
}): string[] {
  const blockers: string[] = [];
  if (input.intent.trim().length < SUBSTANTIVE_NOTE_CHARS) {
    blockers.push("Describe the optimization before judging one KPI.");
  }
  const focal = input.effects.find(
    (effect) => effect.kpiKey === input.focalKpiKey,
  );
  if (!input.focalKpiKey || !focal || focal.effect !== "improves") {
    blockers.push("The focal KPI must be judged improves.");
  }
  const keys = input.effects.map((effect) => effect.kpiKey).filter(Boolean);
  if (new Set(keys).size !== keys.length) {
    blockers.push("Each KPI is recorded once. Effects are not overwritten.");
  }
  if (new Set(keys).size < 2) {
    blockers.push("A single KPI is not a system optimization.");
  }
  const missing = missingSystemPages(
    input.pages,
    input.focalPage,
    input.effects,
  );
  if (missing.length > 0) {
    blockers.push(
      `Single-KPI optimization refused until every other catalog page has an effect: ${missing
        .map(systemPageLabel)
        .join(", ")}.`,
    );
  }
  if (
    input.effects.some(
      (effect) => effect.basis.trim().length < SUBSTANTIVE_NOTE_CHARS,
    )
  ) {
    blockers.push("Each effect needs a substantive basis, including unknown.");
  }
  return blockers;
}
