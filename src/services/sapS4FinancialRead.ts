import { supabase } from "../lib/supabase";

export interface SapGlCostMapping {
  wbsElementInternalId: string;
  glAccount: string;
  costItemRef: string;
}

export function parseSapGlCostMappings(value: string): SapGlCostMapping[] {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 1 || lines.length > 40) {
    throw new Error("Provide between 1 and 40 mapping lines.");
  }
  const seen = new Set<string>();
  return lines.map((line, index) => {
    const parts = line.split("|").map((part) => part.trim());
    if (parts.length !== 3 || parts.some((part) => !part)) {
      throw new Error(
        `Mapping line ${index + 1} must be: SAP WBS internal ID | G/L account | cost item reference.`,
      );
    }
    const [wbsElementInternalId, glAccount, costItemRef] = parts;
    const key = `${wbsElementInternalId}\u0000${glAccount}`;
    if (seen.has(key))
      throw new Error(
        `Mapping line ${index + 1} duplicates SAP pair ${wbsElementInternalId}/${glAccount}.`,
      );
    seen.add(key);
    return { wbsElementInternalId, glAccount, costItemRef };
  });
}

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  if ((data as { error?: string } | null)?.error)
    throw new Error(String((data as { error: unknown }).error));
  return data as Record<string, unknown>;
}

export const sapS4FinancialReadActions = {
  configure: (args: {
    key: string;
    name: string;
    serviceRoot: string;
    developmentCaseId: string;
    ledger: string;
    companyCode: string;
    currency: string;
    postingStartDate: string;
    costMappings: SapGlCostMapping[];
    maxRows: number;
    pageSize: number;
    maxPages: number;
    interval: number;
    credentialRef: string;
    enabled: boolean;
    basis: string;
  }) =>
    rpc("configure_sap_s4_financial_source", {
      p_key: args.key,
      p_name: args.name,
      p_service_root: args.serviceRoot,
      p_development_case_id: args.developmentCaseId,
      p_ledger: args.ledger,
      p_company_code: args.companyCode,
      p_currency: args.currency,
      p_posting_start_date: args.postingStartDate,
      p_cost_mappings: args.costMappings,
      p_max_rows: args.maxRows,
      p_page_size: args.pageSize,
      p_max_pages: args.maxPages,
      p_expected_interval_minutes: args.interval,
      p_credential_binding_ref: args.credentialRef,
      p_enabled: args.enabled,
      p_basis: args.basis,
    }),

  pull: async (key: string, dryRun: boolean) => {
    const { data, error } = await supabase.functions.invoke(
      "sap-s4-financial-read-pull",
      {
        body: { connector_key: key, dry_run: dryRun },
      },
    );
    if (error) throw new Error(error.message);
    if ((data as { error?: string } | null)?.error)
      throw new Error(String((data as { error: unknown }).error));
    return data as Record<string, unknown>;
  },
};
