import { supabase } from "../lib/supabase";

export interface EnterpriseMethod {
  id: string;
  standard_key: string;
  title: string;
  method: string;
  applicability: string | null;
  mandatory: boolean;
  owner_role: string;
  variance_approver_role: string;
  basis: string;
  status: "draft" | "adopted";
  version: number;
  adoption_note: string | null;
}

export interface EffectiveSiteMethod {
  standard_id: string;
  standard_key: string;
  standard_title: string;
  site_id: string;
  site: string;
  resolution: "enterprise_standard" | "site_strategy";
  strategy_id: string | null;
  strategy_title: string | null;
  local_context: string | null;
  implementation_method: string;
  job_plan_id: string | null;
  job_plan: string | null;
  conformance: "inherited" | "aligned" | "variance";
  evidence_basis: string;
  variance_id: string | null;
  variance_status: string | null;
  variance_expires_at: string | null;
  authority: string;
}

export interface AvailableVariance {
  id: string;
  standard_id: string;
  site_id: string;
  status: "approved";
  expires_at: string;
  justification: string;
  compensating_controls: string;
}

export interface FederationPayload {
  methods: EnterpriseMethod[];
  effective_site_methods: EffectiveSiteMethod[];
  available_variances: AvailableVariance[];
  site_strategy_drafts: Array<{
    id: string;
    standard_id: string;
    standard_title: string;
    site_id: string;
    site: string;
    strategy_key: string;
    title: string;
    conformance: "aligned" | "variance";
    variance_id: string | null;
    version: number;
    evidence_basis: string;
  }>;
  blocked_site_strategies: Array<{
    id: string;
    standard_id: string;
    standard_title: string;
    site_id: string;
    site: string;
    title: string;
    reason: string;
    variance_id: string | null;
    variance_status: string | null;
    variance_expires_at: string | null;
  }>;
  controls: {
    inheritance: string;
    variance: string;
    execution: string;
  };
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  const result = data as T & { error?: string };
  if (result?.error) throw new Error(result.error);
  return result;
}

export function getEnterpriseMethodFederation(): Promise<FederationPayload> {
  return rpc<FederationPayload>("get_enterprise_method_federation", {});
}

export interface EnterpriseMethodDraft {
  sourceStandardId?: string;
  standardKey: string;
  title: string;
  method: string;
  applicability: string;
  basis: string;
  mandatory: boolean;
  ownerRole: string;
  varianceApproverRole: string;
}

export function authorEnterpriseMethod(input: EnterpriseMethodDraft) {
  return rpc<{ standard_id: string; status: "draft"; version: number }>(
    "upsert_enterprise_reliability_method",
    {
      p_method: {
        source_standard_id: input.sourceStandardId ?? null,
        standard_key: input.standardKey,
        title: input.title,
        requirement: input.method,
        applicability: input.applicability,
        basis: input.basis,
        mandatory: input.mandatory,
        owner_role: input.ownerRole,
        variance_approver_role: input.varianceApproverRole,
      },
    },
  );
}

export function adoptEnterpriseMethod(standardId: string, note: string) {
  return rpc<{ standard_id: string; status: "adopted"; version: number }>(
    "adopt_enterprise_reliability_method",
    { p_standard_id: standardId, p_note: note },
  );
}

export interface SiteStrategyDraft {
  standardId: string;
  siteId: string;
  strategyKey: string;
  title: string;
  localContext: string;
  implementationMethod: string;
  evidenceBasis: string;
  conformance: "aligned" | "variance";
  varianceId?: string;
}

export function authorSiteStrategy(input: SiteStrategyDraft) {
  return rpc<{ strategy_id: string; status: "draft"; version: number }>(
    "author_site_standard_strategy",
    {
      p_strategy: {
        standard_id: input.standardId,
        site_id: input.siteId,
        strategy_key: input.strategyKey,
        title: input.title,
        local_context: input.localContext,
        implementation_method: input.implementationMethod,
        evidence_basis: input.evidenceBasis,
        conformance: input.conformance,
        variance_id: input.varianceId ?? null,
      },
    },
  );
}

export function adoptSiteStrategy(strategyId: string, note: string) {
  return rpc<{ strategy_id: string; status: "adopted"; resolution: string }>(
    "adopt_site_standard_strategy",
    { p_strategy_id: strategyId, p_note: note },
  );
}

export const ENTERPRISE_METHOD_AUTHOR_ROLES = [
  "reliability_engineer",
  "executive",
  "admin",
] as const;

export const SITE_STRATEGY_AUTHOR_ROLES = [
  "planner",
  "reliability_engineer",
  "maintenance_manager",
  "executive",
  "admin",
] as const;

export function canAuthorEnterpriseMethod(role: string | null | undefined) {
  return (
    !!role &&
    (ENTERPRISE_METHOD_AUTHOR_ROLES as readonly string[]).includes(role)
  );
}

export function canAuthorSiteStrategy(role: string | null | undefined) {
  return (
    !!role && (SITE_STRATEGY_AUTHOR_ROLES as readonly string[]).includes(role)
  );
}
