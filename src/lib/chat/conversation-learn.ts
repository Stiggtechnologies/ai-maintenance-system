import type { OpenVerification } from "../../services/operatingLoopService";

/** Bound recommendation id if a case JSON already carries one. Do not add this to DecisionCase — that file is RE-protected. */
export function optionalRecommendationId(caseLike: object): string | null {
  if (!("recommendationId" in caseLike)) return null;
  const value = (caseLike as { recommendationId?: unknown }).recommendationId;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Maintenance-loop LEARN records recommendation-scoped obligations only. */
export function recommendationScopedOpen(
  rows: OpenVerification[],
): OpenVerification[] {
  return rows.filter(
    (row) => (row.subjectKind ?? "recommendation") === "recommendation",
  );
}

export function findOpenVerification(
  rows: OpenVerification[],
  obligationId: string,
): OpenVerification | undefined {
  return rows.find((row) => row.obligationId === obligationId);
}
