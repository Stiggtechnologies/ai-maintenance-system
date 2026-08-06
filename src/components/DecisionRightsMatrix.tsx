/**
 * DecisionRightsMatrix — the governed three-tier decision-rights policy
 * (capability register C5.23), read live from the decision_rights table.
 *
 * Tiers per the enterprise-OS specification: automatically permitted,
 * approval required, never autonomous. The enforcement column is honest:
 * "capability absent" marks rights currently guaranteed only because no
 * code path exists — those must become enforced before connectors arrive.
 */
import { ShieldCheck, ShieldAlert, ShieldX } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface DecisionRight {
  right_key: string;
  tier: "auto" | "approval" | "never";
  title: string;
  description: string;
  enforcement: "enforced" | "policy" | "capability_absent";
  required_authority: string | null;
  register_ref: string;
  version: number;
}

async function getDecisionRights(): Promise<DecisionRight[]> {
  const { data, error } = await supabase
    .from("decision_rights")
    .select(
      "right_key, tier, title, description, enforcement, required_authority, register_ref, version",
    )
    .order("tier")
    .order("register_ref");
  if (error) throw new Error(error.message);
  return (data ?? []) as DecisionRight[];
}

const TIER_META = {
  auto: {
    label: "Automatically permitted",
    icon: ShieldCheck,
    tone: "text-teal-300",
    chip: "border-teal-500/30 bg-teal-500/10 text-teal-300",
  },
  approval: {
    label: "Approval required",
    icon: ShieldAlert,
    tone: "text-signal-gold",
    chip: "border-signal-gold/30 bg-signal-gold/10 text-signal-gold",
  },
  never: {
    label: "Never autonomous",
    icon: ShieldX,
    tone: "text-red-400",
    chip: "border-red-500/30 bg-red-500/10 text-red-300",
  },
} as const;

const ENFORCEMENT_LABEL: Record<DecisionRight["enforcement"], string> = {
  enforced: "enforced",
  policy: "policy",
  capability_absent: "capability absent",
};

export function DecisionRightsMatrix() {
  const { data, loading, error, refetch } = useAsyncData<DecisionRight[]>(
    getDecisionRights,
    [],
  );

  if (loading) return <LoadingState label="Loading decision-rights matrix" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  const rights = data ?? [];

  return (
    <section aria-labelledby="decision-rights-heading" className="space-y-4">
      <div>
        <h2
          id="decision-rights-heading"
          className="text-lg font-semibold text-white"
        >
          Decision-Rights Matrix
        </h2>
        <p className="mt-1 text-sm text-slate-300">
          The governed three-tier policy every agent and future connector must
          consult. Versioned in the database; changed only by migration.
          &ldquo;Capability absent&rdquo; marks rights currently guaranteed by
          the absence of a code path — they convert to enforced checks before
          any integration makes the action possible.
        </p>
      </div>

      {(Object.keys(TIER_META) as Array<keyof typeof TIER_META>).map((tier) => {
        const meta = TIER_META[tier];
        const Icon = meta.icon;
        const rows = rights.filter((r) => r.tier === tier);
        if (rows.length === 0) return null;
        return (
          <div
            key={tier}
            className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4"
          >
            <div className="mb-3 flex items-center gap-2">
              <Icon className={`h-4 w-4 ${meta.tone}`} aria-hidden />
              <h3
                className={`text-sm font-semibold uppercase tracking-wide ${meta.tone}`}
              >
                {meta.label}
              </h3>
              <span className="text-xs text-slate-500">({rows.length})</span>
            </div>
            <ul className="space-y-2">
              {rows.map((r) => (
                <li
                  key={r.right_key}
                  className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-white/4 bg-white/2 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-200">
                      {r.title}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {r.description}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {r.required_authority && (
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs text-slate-300">
                        approver: {r.required_authority.replace(/_/g, " ")}
                      </span>
                    )}
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${meta.chip}`}
                    >
                      {ENFORCEMENT_LABEL[r.enforcement]}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">
                      {r.register_ref}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
