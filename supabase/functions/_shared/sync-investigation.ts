export type InvestigationCategory =
  | "operations"
  | "data_integrity"
  | "safety"
  | "asset"
  | "work"
  | "recommendations"
  | "evidence"
  | "attachments"
  | "risk"
  | "specialist";

export interface InvestigationPlanItem {
  id: string;
  label: string;
  category: InvestigationCategory;
}

export interface KpiSnapshot {
  kpi_key: string;
  name: string;
  page?: string;
  value: number | null;
  unit: string | null;
  status: "on_target" | "watch" | "breach" | "not_assessed" | null;
  confidence?: "high" | "medium" | "low" | null;
  computed_at?: string | null;
  source_note?: string | null;
  accountable?: string | null;
  responsible?: string | null;
}

const RISK_QUERY = /\b(highest|biggest|top|risk|attention|priority|today|operation|operational)\b/i;
const ASSET_QUERY = /\b(asset|equipment|machine|fleet|register|hierarchy|configuration|criticality)\b/i;
const SAFETY_QUERY = /\b(safety|hse|incident|injury|critical control|interlock|protective|environment)\b/i;
const WORK_QUERY = /\b(work order|maintenance|backlog|schedule|job plan|task|repair|inspection)\b/i;
const DATA_QUERY = /\b(data|integrity|accuracy|completeness|coverage|latency|quality|missing|unknown)\b/i;

export function buildInvestigationPlan(input: {
  question: string;
  entityType?: string;
  attachmentCount?: number;
}): InvestigationPlanItem[] {
  const { question, entityType, attachmentCount = 0 } = input;
  const globalRisk = RISK_QUERY.test(question);
  const plan: InvestigationPlanItem[] = [];

  if (globalRisk || /\b(kpi|performance|metric|availability|reliability)\b/i.test(question)) {
    plan.push({ id: "operational-kpis", label: "Reviewing operational KPIs", category: "operations" });
  }
  if (globalRisk || DATA_QUERY.test(question) || ASSET_QUERY.test(question)) {
    plan.push({ id: "asset-data-integrity", label: "Checking asset data integrity", category: "data_integrity" });
  }
  if (globalRisk || SAFETY_QUERY.test(question)) {
    plan.push({ id: "safety-indicators", label: "Cross-checking safety indicators", category: "safety" });
  }
  if (globalRisk || /\b(recommend|action|open item|attention|priority)\b/i.test(question)) {
    plan.push({ id: "open-recommendations", label: "Reviewing open recommendations", category: "recommendations" });
  }
  if (entityType === "asset" || ASSET_QUERY.test(question)) {
    plan.push({ id: "current-asset", label: "Checking current asset context", category: "asset" });
  }
  if (entityType === "work_order" || WORK_QUERY.test(question)) {
    plan.push({ id: "work-context", label: "Checking work execution context", category: "work" });
  }
  if (attachmentCount > 0) {
    plan.push({ id: "attachments", label: "Reading attached source material", category: "attachments" });
  }
  if (globalRisk) {
    plan.push({ id: "risk-ranking", label: "Evaluating highest-risk condition", category: "risk" });
  }

  if (plan.length === 0) {
    plan.push({ id: "governed-context", label: "Checking relevant governed context", category: "evidence" });
  }
  return plan;
}

const STATUS_WEIGHT: Record<string, number> = {
  breach: 0,
  watch: 1,
  not_assessed: 2,
  on_target: 3,
};

export function prioritizeKpis(rows: KpiSnapshot[], limit = 18): KpiSnapshot[] {
  return [...rows]
    .filter((row) => row.value !== null)
    .sort((a, b) => {
      const status = (STATUS_WEIGHT[a.status ?? ""] ?? 9) - (STATUS_WEIGHT[b.status ?? ""] ?? 9);
      if (status !== 0) return status;
      const confidence = { low: 0, medium: 1, high: 2 } as Record<string, number>;
      return (confidence[a.confidence ?? ""] ?? 3) - (confidence[b.confidence ?? ""] ?? 3);
    })
    .slice(0, Math.max(1, limit));
}

export function formatKpiValue(row: KpiSnapshot): string {
  if (row.value === null) return "not available";
  return `${row.value}${row.unit === "%" ? "%" : row.unit ? ` ${row.unit}` : ""}`;
}

export function isDataIntegrityKpi(row: KpiSnapshot): boolean {
  return /\b(accuracy|completeness|coverage|latency|data quality|digital twin|asset register)\b/i.test(
    `${row.kpi_key} ${row.name}`,
  );
}

export function isSafetyKpi(row: KpiSnapshot): boolean {
  return row.page === "risk_safety" || /\b(safety|incident|injury|environment|critical control)\b/i.test(row.name);
}

export function compactText(value: unknown, max = 260): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
