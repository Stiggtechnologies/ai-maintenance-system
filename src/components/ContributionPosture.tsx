/**
 * ContributionPosture — what, if anything, this organization gives to the
 * shared knowledge base (capability register E12 data governance, U19 AI
 * governance).
 *
 * The panel leads with the negative statement, because that is the one a
 * customer's security review actually asks about. "This organization
 * contributes nothing" should be readable in one glance, and it should be the
 * default state rather than something achieved by configuration.
 *
 * The eligibility line underneath is the interesting half: it shows the gate
 * refusing to publish, with the arithmetic. A threshold nobody can see is a
 * threshold nobody can audit.
 */
import { useMemo } from "react";
import { Share2, Info, ShieldCheck, AlertTriangle } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import {
  assessContributionPosture,
  type ContributionPosture as Posture,
} from "../lib/knowledge-contribution";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Eligibility {
  eligible: boolean;
  policyKey: string;
  failureEvents: number;
  contributingTenants: number;
  contributingAssets: number;
  maxSingleTenantSharePct: number;
  tenantsWithoutConsent: number;
  staleConsentTenants: number;
  reason: string;
}

interface Policy {
  policy_key: string;
  label: string | null;
  min_failure_events: number;
  min_contributing_tenants: number;
  min_contributing_assets: number;
  max_single_tenant_share_pct: number;
  terms_version: string;
  rationale: string;
}

export function ContributionPosture() {
  const { data, loading, error, refetch } = useAsyncData<{
    posture: Posture | null;
    eligibility: Eligibility | null;
    policy: Policy | null;
  }>(async () => {
    const [p, e, pol] = await Promise.all([
      supabase.rpc("get_contribution_posture"),
      supabase.rpc("evaluate_benchmark_eligibility", {
        p_asset_class: "Ultra-Class Haul Truck",
        p_metric: "weibull_beta",
      }),
      supabase
        .from("contribution_policy")
        .select(
          "policy_key, label, min_contributing_tenants, min_contributing_assets, min_failure_events, max_single_tenant_share_pct, terms_version, rationale",
        )
        .eq("policy_key", "default")
        .maybeSingle(),
    ]);
    if (p.error) throw new Error(p.error.message);
    if (e.error) throw new Error(e.error.message);
    if (pol.error) throw new Error(pol.error.message);
    const raw = (p.data as Posture[])?.[0] ?? null;
    return {
      posture: raw
        ? {
            ...raw,
            ownContributions: Number(raw.ownContributions),
            ownWithdrawn: Number(raw.ownWithdrawn),
            freshBenchmarks: Number(raw.freshBenchmarks),
            staleBenchmarks: Number(raw.staleBenchmarks),
          }
        : null,
      eligibility: (e.data as Eligibility[])?.[0] ?? null,
      policy: (pol.data as Policy) ?? null,
    };
  }, []);

  const verdict = useMemo(
    () => assessContributionPosture(data?.posture ?? null),
    [data],
  );

  if (loading) return <LoadingState label="Loading contribution posture" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const eligibility = data?.eligibility ?? null;
  const policy = data?.policy ?? null;

  return (
    <section aria-labelledby="contrib-heading" className="space-y-4">
      <div>
        <h2
          id="contrib-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Share2 className="h-5 w-5 text-signal-cyan" aria-hidden />
          Cross-Tenant Contribution
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          Nothing here mines a tenant. A named person contributes a specific
          derived artefact, or nothing crosses at all.
        </p>
      </div>

      <div
        className={`flex items-start gap-2 rounded-xl border p-4 text-sm ${
          verdict.consentNeedsRenewal
            ? "border-amber-500/30 bg-amber-500/5 text-amber-100"
            : verdict.contributing
              ? "border-white/6 bg-white/2 text-slate-300"
              : "border-signal-cyan/25 bg-signal-cyan/5 text-slate-200"
        }`}
      >
        {verdict.contributing ? (
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        ) : verdict.consentNeedsRenewal ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        ) : (
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        )}
        <p>{verdict.reason}</p>
      </div>

      {/* The gate, with its arithmetic showing. */}
      {eligibility && policy && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="text-sm font-semibold text-white">
            Publication gate
            <span className="ml-2 text-xs font-normal text-slate-500">
              worked example: Weibull shape, Ultra-Class Haul Truck
            </span>
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {eligibility.reason}
          </p>
          <dl className="mt-2 flex flex-wrap gap-4 text-xs">
            <div>
              <dt className="text-slate-500">Consenting tenants</dt>
              <dd className="font-mono tabular-nums text-slate-300">
                {eligibility.contributingTenants} /{" "}
                {policy.min_contributing_tenants} required
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Assets in sample</dt>
              <dd className="font-mono tabular-nums text-slate-300">
                {eligibility.contributingAssets} /{" "}
                {policy.min_contributing_assets} required
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Failure events</dt>
              <dd className="font-mono tabular-nums text-slate-300">
                {eligibility.failureEvents} / {policy.min_failure_events}{" "}
                required
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Largest contributor</dt>
              <dd className="font-mono tabular-nums text-slate-300">
                {eligibility.maxSingleTenantSharePct}% / max{" "}
                {policy.max_single_tenant_share_pct}%
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Terms</dt>
              <dd className="font-mono text-slate-300">
                {policy.terms_version}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            {policy.rationale}
          </p>
        </div>
      )}
    </section>
  );
}
