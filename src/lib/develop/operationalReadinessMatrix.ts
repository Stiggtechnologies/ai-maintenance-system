import type {
  SystemOperationalReadinessItem,
  SystemOperationalReadinessResult,
} from "./index";

export interface OperationalReadinessMatrixCell {
  category: string;
  total: number;
  evidenced: number;
  open: number;
  overdueOpen: number;
  percent: number | null;
  earliestRequiredBefore: string | null;
  owners: string[];
  gaps: Array<{
    itemId: string;
    label: string;
    asset: string;
    owner: string;
    requiredBefore: string;
    overdue: boolean;
  }>;
  recordRefs: string[];
}

export interface OperationalReadinessMatrixRow {
  systemId: number;
  systemRef: string;
  title: string;
  currentState: string | null;
  assetCount: number;
  total: number;
  evidenced: number;
  open: number;
  overdueOpen: number;
  cells: Record<string, OperationalReadinessMatrixCell>;
  recordRefs: string[];
}

export interface OperationalReadinessMatrix {
  caseId: string;
  categories: string[];
  rows: OperationalReadinessMatrixRow[];
  emptyState: string | null;
  readinessStore: "asset_onboarding_items";
  decisionBoundary: string;
  interpretationLimits: string[];
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function buildCell(
  category: string,
  items: SystemOperationalReadinessItem[],
): OperationalReadinessMatrixCell {
  const evidenced = items.filter((item) => item.evidenceReady).length;
  const openItems = items.filter((item) => !item.evidenceReady);
  const dueDates = items
    .map((item) => item.requiredBefore)
    .filter(Boolean)
    .sort();
  return {
    category,
    total: items.length,
    evidenced,
    open: openItems.length,
    overdueOpen: openItems.filter((item) => item.overdue).length,
    percent:
      items.length === 0
        ? null
        : Math.round((evidenced / items.length) * 1000) / 10,
    earliestRequiredBefore: dueDates[0] ?? null,
    owners: unique(items.map((item) => item.owner ?? item.ownerId)),
    gaps: openItems.map((item) => ({
      itemId: item.itemId,
      label: item.item,
      asset: item.assetTag ?? item.asset,
      owner: item.owner ?? item.ownerId,
      requiredBefore: item.requiredBefore,
      overdue: item.overdue,
    })),
    recordRefs: unique(
      items.flatMap((item) => [
        `asset_onboarding_items:${item.itemId}`,
        `assets:${item.assetId}`,
        item.evidenceItemId ? `evidence_items:${item.evidenceItemId}` : null,
      ]),
    ),
  };
}

/**
 * Presentation-only composition over the canonical system-readiness read.
 * Evidence coverage is a count of returned evidenceReady flags, not a new engineering judgement
 * or permission to accept handover.
 */
export function buildOperationalReadinessMatrix(
  source: SystemOperationalReadinessResult,
): OperationalReadinessMatrix {
  const categories = [
    ...new Set(
      source.systems.flatMap((system) =>
        system.items.map((item) => item.category),
      ),
    ),
  ].sort();

  return {
    caseId: source.caseId,
    categories,
    rows: source.systems.map((system) => {
      const cells = Object.fromEntries(
        categories.map((category) => [
          category,
          buildCell(
            category,
            system.items.filter((item) => item.category === category),
          ),
        ]),
      );
      return {
        systemId: system.systemId,
        systemRef: system.systemRef,
        title: system.title,
        currentState: system.currentState,
        assetCount: system.assetCount,
        total: system.itemCount,
        evidenced: system.satisfiedCount,
        open: Math.max(0, system.itemCount - system.satisfiedCount),
        overdueOpen: system.overdueOpenCount,
        cells,
        recordRefs: [
          `commissioning_systems:${system.systemId}`,
          ...unique(system.items.map((item) => `assets:${item.assetId}`)),
        ],
      };
    }),
    emptyState:
      source.systems.length === 0
        ? "No commissioning systems are recorded for this case. Operational readiness cannot be shown by system."
        : categories.length === 0
          ? "Commissioning systems exist, but no operational-readiness items have been assigned. Absence is not readiness."
          : null,
    readinessStore: source.readinessStore,
    decisionBoundary: source.decisionBoundary,
    interpretationLimits: [
      "Each percentage is evidence coverage within one recorded system and category; it is not a blended readiness verdict.",
      "An unscoped cell means no canonical readiness item was returned for that system and category; it does not mean ready or not applicable.",
      "Only a named human using the governed handover workflow can accept operations ownership or authorize energization.",
    ],
  };
}
