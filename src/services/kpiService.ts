/**
 * KPI service client — the ISO 55000 KPI layer (migration 17).
 * get_kpi_dashboard() enforces role-based access SERVER-side: board-tier
 * KPIs never reach the browser for roles outside their audience.
 */
import { supabase } from "../lib/supabase";

export interface KpiRow {
  kpi_key: string;
  name: string;
  page:
    | "executive"
    | "asset_performance"
    | "reliability"
    | "financial"
    | "risk_safety"
    | "sustainability"
    | "digital";
  formula: string;
  target_label: string;
  direction: "up" | "down" | "range";
  unit: string | null;
  accountable: string;
  responsible: string;
  agent_owner: string | null;
  computable: boolean;
  source_note: string | null;
  value: number | null;
  status: "on_target" | "watch" | "breach" | null;
  variance_pct: number | null;
  confidence: "high" | "medium" | "low" | null;
  computed_from: { source?: string } | null;
  computed_at: string | null;
}

export interface KpiDashboard {
  role: string;
  kpis: KpiRow[];
}

export async function getKpiDashboard(): Promise<KpiDashboard> {
  const { data, error } = await supabase.rpc("get_kpi_dashboard");
  if (error) throw new Error(`Could not load KPI dashboard: ${error.message}`);
  const result = data as { role?: string; kpis?: KpiRow[]; error?: string };
  if (result.error) throw new Error(`KPI dashboard: ${result.error}`);
  return { role: result.role ?? "", kpis: result.kpis ?? [] };
}

export const KPI_PAGES: Array<{ key: KpiRow["page"]; label: string }> = [
  { key: "executive", label: "Executive Overview" },
  { key: "asset_performance", label: "Asset Performance" },
  { key: "reliability", label: "Reliability & Maintenance" },
  { key: "financial", label: "Financial & Lifecycle" },
  { key: "risk_safety", label: "Risk & Safety" },
  { key: "sustainability", label: "Sustainability & ESG" },
  { key: "digital", label: "Digital & AI Performance" },
];

/** Format a KPI value with its unit for display. */
export function formatKpiValue(row: KpiRow): string {
  if (row.value == null) return "—";
  const v = Number(row.value);
  if (row.unit === "USD")
    return v >= 1_000_000
      ? `$${(v / 1_000_000).toFixed(1)}M`
      : v >= 1_000
        ? `$${(v / 1_000).toFixed(0)}K`
        : `$${v}`;
  if (row.unit === "%") return `${v}%`;
  return `${v}${row.unit ? ` ${row.unit}` : ""}`;
}
