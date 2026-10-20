import { useState } from "react";
import { LockKeyhole, ShieldAlert } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { useAuth } from "./AuthProvider";
import {
  decideDataEgressRule,
  getDataEgressRules,
  proposeDataEgressRule,
  type DataClass,
  type DestinationKind,
  type EgressPurpose,
} from "../services/dataEgressGovernanceService";

const dataClasses: DataClass[] = [
  "operational",
  "personal",
  "commercial",
  "safety_critical",
  "security_sensitive",
];
const destinationKinds: DestinationKind[] = [
  "llm_gateway",
  "analytics",
  "vendor_support",
  "regulator",
  "corporate_it",
  "other",
];
const purposes: EgressPurpose[] = [
  "model_inference",
  "embedding",
  "document_extraction",
  "realtime_voice",
  "speech_synthesis",
  "onboarding_enrichment",
  "agent_enrichment",
];
const inputClass =
  "w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";

export function DataEgressGovernancePanel() {
  const { profile } = useAuth();
  const role = String(profile?.role ?? "");
  const canView = ["admin", "executive", "reliability_engineer"].includes(role);
  const canGovern = ["admin", "executive"].includes(role);
  const register = useAsyncData(
    () =>
      canView
        ? getDataEgressRules()
        : Promise.resolve({ rules: [], boundary: "" }),
    [canView],
  );
  const [form, setForm] = useState({
    destination: "api.openai.com",
    destinationKind: "llm_gateway" as DestinationKind,
    dataClass: "operational" as DataClass,
    allowedPurposes: ["model_inference"] as EgressPurpose[],
    permitted: false,
    redactionRequired: false,
    basis: "",
  });
  const [reviews, setReviews] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canView) return null;
  if (register.loading) {
    return (
      <div className="rounded-xl border border-white/6 p-4 text-xs text-slate-400">
        Loading data-egress policy…
      </div>
    );
  }
  if (register.error) {
    return (
      <div className="rounded-xl border border-rose-500/20 p-4 text-xs text-rose-200">
        Data-egress policy is unavailable: {register.error}
      </div>
    );
  }

  const rules = register.data?.rules ?? [];
  const pending = rules.filter((rule) => rule.status === "proposed");
  const current = rules.find(
    (rule) =>
      rule.status === "adopted" &&
      !rule.supersededByRuleId &&
      rule.destination === form.destination.trim().toLowerCase() &&
      rule.dataClass === form.dataClass,
  );
  const ready =
    form.destination.includes(".") &&
    form.allowedPurposes.length > 0 &&
    form.basis.trim().length >= 30;

  const act = async (operation: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await operation();
      setNotice(message);
      await register.refetch();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-signal-cyan/20 bg-signal-cyan/[0.025] p-4">
      <div className="flex items-start gap-2">
        <LockKeyhole className="mt-0.5 h-4 w-4 text-signal-cyan" aria-hidden />
        <div>
          <h3 className="text-sm font-semibold text-white">
            Data-loss prevention
          </h3>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-slate-400">
            Tenant content is denied before a supported AI provider connection
            unless the exact destination, data class and purpose match a current
            independently approved rule. Missing, stale and
            redaction-incomplete rules deny, and fallback destinations are
            checked independently. This control does not authorize plant action
            or certify a provider.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {rules
          .filter(
            (rule) => rule.status === "adopted" && !rule.supersededByRuleId,
          )
          .map((rule) => (
            <div
              key={rule.id}
              className={`rounded-lg border p-3 text-xs ${
                rule.permitted
                  ? "border-emerald-500/20 bg-emerald-500/5"
                  : "border-rose-500/20 bg-rose-500/5"
              }`}
            >
              <p className="font-mono text-slate-100">
                {rule.destination} · {rule.dataClass.replaceAll("_", " ")}
              </p>
              <p className="mt-1 text-slate-300">
                v{rule.version} · {rule.permitted ? "permit" : "deny"}
                {rule.redactionRequired ? " after redaction" : ""} ·{" "}
                {rule.allowedPurposes.join(", ").replaceAll("_", " ")}
              </p>
              <p className="mt-1 line-clamp-2 text-slate-500">{rule.basis}</p>
            </div>
          ))}
        {rules.filter(
          (rule) => rule.status === "adopted" && !rule.supersededByRuleId,
        ).length === 0 ? (
          <p className="md:col-span-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
            No adopted egress rule exists. Supported tenant AI-provider calls
            are denied by default.
          </p>
        ) : null}
      </div>

      {canGovern ? (
        <div className="mt-4 grid gap-2 border-t border-white/8 pt-4 md:grid-cols-2">
          <input
            className={inputClass}
            aria-label="Exact destination hostname"
            placeholder="Exact provider hostname"
            value={form.destination}
            onChange={(event) =>
              setForm({
                ...form,
                destination: event.target.value.toLowerCase(),
              })
            }
          />
          <select
            className={inputClass}
            value={form.destinationKind}
            onChange={(event) =>
              setForm({
                ...form,
                destinationKind: event.target.value as DestinationKind,
              })
            }
          >
            {destinationKinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <select
            className={inputClass}
            value={form.dataClass}
            onChange={(event) =>
              setForm({ ...form, dataClass: event.target.value as DataClass })
            }
          >
            {dataClasses.map((dataClass) => (
              <option key={dataClass} value={dataClass}>
                {dataClass.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-lg border border-white/10 p-2">
            {purposes.map((purpose) => (
              <label
                key={purpose}
                className="flex items-center gap-1 text-[11px] text-slate-300"
              >
                <input
                  type="checkbox"
                  checked={form.allowedPurposes.includes(purpose)}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      allowedPurposes: event.target.checked
                        ? [...form.allowedPurposes, purpose]
                        : form.allowedPurposes.filter(
                            (value) => value !== purpose,
                          ),
                    })
                  }
                />
                {purpose.replaceAll("_", " ")}
              </label>
            ))}
          </div>
          <div className="flex gap-4 text-xs text-slate-300 md:col-span-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.permitted}
                onChange={(event) =>
                  setForm({ ...form, permitted: event.target.checked })
                }
              />
              Permit matching egress
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.redactionRequired}
                onChange={(event) =>
                  setForm({ ...form, redactionRequired: event.target.checked })
                }
              />
              Require applied redaction
            </label>
          </div>
          <textarea
            className={`${inputClass} min-h-20 md:col-span-2`}
            placeholder="Destination, purpose, handling and residual-risk basis (30 characters minimum)"
            value={form.basis}
            onChange={(event) =>
              setForm({ ...form, basis: event.target.value })
            }
          />
          <p className="text-[11px] text-slate-500">
            {current
              ? `This proposal must supersede current rule #${current.id}, version ${current.version}.`
              : "This is the first rule for the exact destination and class."}
          </p>
          <div className="text-right">
            <button
              type="button"
              disabled={busy || !ready}
              onClick={() =>
                void act(
                  () =>
                    proposeDataEgressRule({
                      ...form,
                      destination: form.destination.trim(),
                      basis: form.basis.trim(),
                      supersedesRuleId: current?.id ?? null,
                    }),
                  "Immutable rule proposed; it is not active until a different AAL2 human adopts it.",
                )
              }
              className="rounded-lg bg-signal-cyan/15 px-3 py-2 text-xs font-semibold text-signal-cyan disabled:opacity-40"
            >
              Propose rule version
            </button>
          </div>
        </div>
      ) : null}

      {canGovern && pending.length > 0 ? (
        <div className="mt-4 space-y-2 border-t border-white/8 pt-4">
          <p className="flex items-center gap-2 text-xs font-semibold text-white">
            <ShieldAlert className="h-4 w-4 text-amber-300" aria-hidden />
            Independent AAL2 review queue
          </p>
          {pending.map((rule) => {
            const reason = reviews[rule.id] ?? "";
            const isOwn = rule.proposedBy === profile?.id;
            return (
              <div
                key={rule.id}
                className="rounded-lg border border-white/8 p-3"
              >
                <p className="text-xs font-mono text-slate-200">
                  {rule.destination} · {rule.dataClass.replaceAll("_", " ")} · v
                  {rule.version}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Proposed by {rule.proposedByLabel ?? "named user"}.{" "}
                  {rule.permitted ? "Permit" : "Deny"} for{" "}
                  {rule.allowedPurposes.join(", ").replaceAll("_", " ")}.
                </p>
                <textarea
                  className={`${inputClass} mt-2 min-h-16`}
                  placeholder="Independent decision and residual-risk basis (30 characters minimum)"
                  value={reason}
                  onChange={(event) =>
                    setReviews({ ...reviews, [rule.id]: event.target.value })
                  }
                />
                {isOwn ? (
                  <p className="mt-2 text-[11px] text-amber-200">
                    Segregation of duties: another named administrator or
                    executive must decide this proposal.
                  </p>
                ) : (
                  <div className="mt-2 flex gap-2">
                    {(["adopt", "reject"] as const).map((decision) => (
                      <button
                        key={decision}
                        type="button"
                        disabled={busy || reason.trim().length < 30}
                        onClick={() =>
                          void act(
                            () =>
                              decideDataEgressRule({
                                ruleId: rule.id,
                                decision,
                                reason: reason.trim(),
                              }),
                            decision === "adopt"
                              ? "Rule adopted as the exact current version."
                              : "Rule rejected and retained for audit.",
                          )
                        }
                        className="rounded border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 disabled:opacity-40"
                      >
                        {decision === "adopt" ? "Adopt rule" : "Reject rule"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {notice ? (
        <p role="status" className="mt-3 text-xs text-emerald-300">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-xs text-rose-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
