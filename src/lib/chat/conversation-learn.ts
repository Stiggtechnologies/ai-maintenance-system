import type { OpenVerification } from "../../services/operatingLoopService";

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
