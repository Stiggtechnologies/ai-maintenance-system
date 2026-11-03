import { supabase } from "../lib/supabase";

export interface BudgetSite {
  id: string;
  name: string;
}

export interface BudgetLine {
  id: number;
  budgetYear: number;
  category: string;
  siteId: string | null;
  siteName: string | null;
  budgeted: number;
  budgetBasis: string | null;
  committed: number;
  committedBasis: string | null;
  actual: number;
  actualMeasured: boolean;
  forecast: number | null;
  forecastBasis: string | null;
  version: number;
}

export interface BudgetPreview {
  category: string;
  currency: string | null;
  forecastable: boolean;
  forecast: number | null;
  actualInYear: number | null;
  actualMeasured: boolean;
  basis: string;
  reason: string;
  rate?: {
    value: number;
    unit: string;
    source: string;
    effectiveFrom: string;
  } | null;
}

export interface BudgetWorkspace {
  year: number;
  siteId: string | null;
  sites: BudgetSite[];
  lines: BudgetLine[];
  previews: BudgetPreview[];
  authority: {
    expenditureAuthorized: false;
    budgetApproved: false;
    workAuthorized: false;
    externalFinanceSystemRead: false;
    note: string;
  };
}

export interface BudgetWriteResult {
  budgetLineId: number;
  version: number;
  forecastable: boolean;
  forecast: number | null;
  actualMeasured: boolean;
  currency: string | null;
  basis: string;
  expenditureAuthorized: false;
  budgetApproved: false;
  workAuthorized: false;
  externalFinanceSystemRead: false;
}

const BUDGET_CEILING = 1_000_000_000_000_000;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Budget service returned no payload.");
  }
  return value as Record<string, unknown>;
}

async function callBudget<T>(
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  const payload = asRecord(data);
  if (typeof payload.error === "string") throw new Error(payload.error);
  return payload as T;
}

export async function getMaintenanceBudgetWorkspace(
  year: number,
  siteId: string | null,
): Promise<BudgetWorkspace> {
  if (!Number.isInteger(year) || year < 1990 || year > 2100) {
    throw new Error(
      "The budget year must be a calendar year from 1990 through 2100.",
    );
  }
  return callBudget<BudgetWorkspace>("get_maintenance_budget_workspace", {
    p_year: year,
    p_site: siteId,
  });
}

export async function recordMaintenanceBudgetLine(input: {
  year: number;
  category: string;
  siteId: string | null;
  budgeted: number;
  budgetBasis: string;
  committed: number;
  committedBasis: string;
  expectedVersion: number;
}): Promise<BudgetWriteResult> {
  if (
    !Number.isFinite(input.budgeted) ||
    input.budgeted < 0 ||
    input.budgeted > BUDGET_CEILING
  ) {
    throw new Error(
      "Budgeted amount must be a finite, non-negative, bounded number.",
    );
  }
  if (
    !Number.isFinite(input.committed) ||
    input.committed < 0 ||
    input.committed > BUDGET_CEILING
  ) {
    throw new Error(
      "Committed amount must be a finite, non-negative, bounded number.",
    );
  }
  return callBudget<BudgetWriteResult>("record_maintenance_budget_line", {
    p_year: input.year,
    p_category: input.category,
    p_site: input.siteId,
    p_budgeted: input.budgeted,
    p_budget_basis: input.budgetBasis,
    p_committed: input.committed,
    p_committed_basis: input.committedBasis,
    p_expected_version: input.expectedVersion,
  });
}

export async function refreshMaintenanceBudgetForecast(input: {
  year: number;
  category: string;
  siteId: string | null;
  expectedVersion: number;
}): Promise<BudgetWriteResult> {
  return callBudget<BudgetWriteResult>("refresh_maintenance_budget_forecast", {
    p_year: input.year,
    p_category: input.category,
    p_site: input.siteId,
    p_expected_version: input.expectedVersion,
  });
}
