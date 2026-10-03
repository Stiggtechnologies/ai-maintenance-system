import { useState } from "react";
import { GitBranch, ShieldCheck } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { useAuth } from "./AuthProvider";
import { supabase } from "../lib/supabase";
import {
  reviewModelRegistryVersion,
  submitModelRegistryVersion,
  type ModelKind,
} from "../services/modelRegistryService";

export interface GovernedModelRow {
  id: number;
  modelKey: string;
  version: string;
  approvalStatus: string;
  currentForDecisions: boolean;
  submittedBy: string | null;
}

const kinds: ModelKind[] = [
  "statistical",
  "rule_based",
  "machine_learning",
  "llm",
  "hybrid",
  "deterministic_physics",
  "empirical_reliability",
  "oem_curve",
  "standards_method",
];
const inputClass =
  "w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";

export function ModelRegistryGovernancePanel({
  models,
  onChanged,
}: {
  models: GovernedModelRow[];
  onChanged: () => void;
}) {
  const { profile } = useAuth();
  const role = String(profile?.role ?? "");
  const canSubmit = [
    "admin",
    "ai_admin",
    "executive",
    "reliability_engineer",
  ].includes(role);
  const canReview = ["admin", "ai_admin", "executive"].includes(role);
  const evidence = useAsyncData(async () => {
    const { data, error } = await supabase
      .from("evidence_items")
      .select("id,description,source_reference")
      .eq("verification_status", "verified")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  }, []);
  const [form, setForm] = useState({
    modelKey: "",
    version: "",
    modelKind: "llm" as ModelKind,
    purpose: "",
    trainingData: "",
    validation: "",
    applicability: "",
    limitations: "",
    decisionRelevant: true,
    supersedesModelId: "",
  });
  const [reviews, setReviews] = useState<
    Record<number, { evidence: string; basis: string }>
  >({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const versionsForKey = models.filter(
    (model) => model.modelKey === form.modelKey.trim(),
  );
  const ready =
    form.modelKey.trim().length >= 3 &&
    form.version.trim().length > 0 &&
    form.purpose.trim().length >= 20 &&
    form.trainingData.trim().length >= 20 &&
    form.validation.trim().length >= 20 &&
    form.applicability.trim().length >= 20 &&
    form.limitations.trim().length >= 20 &&
    (versionsForKey.length === 0 || Boolean(form.supersedesModelId));

  const act = async (operation: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await operation();
      setNotice(message);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    act(
      () =>
        submitModelRegistryVersion({
          modelKey: form.modelKey.trim(),
          version: form.version.trim(),
          modelKind: form.modelKind,
          purpose: form.purpose.trim(),
          trainingData: { status: "recorded", basis: form.trainingData.trim() },
          validation: { status: "recorded", basis: form.validation.trim() },
          applicability: {
            status: "recorded",
            basis: form.applicability.trim(),
          },
          limitations: form.limitations.trim(),
          decisionRelevant: form.decisionRelevant,
          supersedesModelId: form.supersedesModelId
            ? Number(form.supersedesModelId)
            : null,
        }),
      "Version submitted for independent review. It is not current for decisions.",
    );

  const pending = models.filter((model) =>
    ["pending_review", "revalidation_required"].includes(model.approvalStatus),
  );

  return (
    <div className="rounded-xl border border-signal-cyan/20 bg-signal-cyan/[0.025] p-4">
      <div className="flex items-start gap-2">
        <GitBranch className="mt-0.5 h-4 w-4 text-signal-cyan" aria-hidden />
        <div>
          <h3 className="text-sm font-semibold text-white">
            Governed model versions
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Every AI or calculation version records purpose, training data,
            validation, applicability and limitations. A version swap stays out
            of decision use until a different authorized person reviews verified
            evidence.
          </p>
        </div>
      </div>

      {canSubmit ? (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          <input
            className={inputClass}
            placeholder="Stable model key"
            value={form.modelKey}
            onChange={(e) =>
              setForm({
                ...form,
                modelKey: e.target.value,
                supersedesModelId: "",
              })
            }
          />
          <input
            className={inputClass}
            placeholder="Exact version (never latest)"
            value={form.version}
            onChange={(e) => setForm({ ...form, version: e.target.value })}
          />
          <select
            className={inputClass}
            value={form.modelKind}
            onChange={(e) =>
              setForm({ ...form, modelKind: e.target.value as ModelKind })
            }
          >
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind.replaceAll("_", " ")}
              </option>
            ))}
          </select>
          <select
            className={inputClass}
            value={form.supersedesModelId}
            onChange={(e) =>
              setForm({ ...form, supersedesModelId: e.target.value })
            }
          >
            <option value="">
              {versionsForKey.length
                ? "Select version being superseded…"
                : "Initial version—nothing superseded"}
            </option>
            {versionsForKey.map((model) => (
              <option key={model.id} value={model.id}>
                {model.modelKey}@{model.version}
              </option>
            ))}
          </select>
          {[
            ["purpose", "Purpose and decisions supported"],
            [
              "trainingData",
              "Training-data provenance or why training is not applicable",
            ],
            ["validation", "Validation method, population and results"],
            [
              "applicability",
              "Applicable assets, contexts, ranges and exclusions",
            ],
            ["limitations", "Known limitations and failure conditions"],
          ].map(([key, label]) => (
            <textarea
              key={key}
              className={`${inputClass} min-h-20 md:col-span-2`}
              placeholder={`${label} (20 characters minimum)`}
              value={form[key as keyof typeof form] as string}
              onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            />
          ))}
          <label className="flex items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={form.decisionRelevant}
              onChange={(e) =>
                setForm({ ...form, decisionRelevant: e.target.checked })
              }
            />
            Decision-relevant output (version swap opens impact review)
          </label>
          <div className="md:text-right">
            <button
              type="button"
              disabled={busy || !ready}
              onClick={() => void submit()}
              className="rounded-lg bg-signal-cyan/15 px-3 py-2 text-xs font-semibold text-signal-cyan disabled:opacity-40"
            >
              Submit immutable version
            </button>
          </div>
        </div>
      ) : null}

      {canReview && pending.length > 0 ? (
        <div className="mt-4 space-y-2 border-t border-white/8 pt-4">
          <p className="flex items-center gap-2 text-xs font-semibold text-white">
            <ShieldCheck className="h-4 w-4 text-signal-cyan" />
            Independent review queue
          </p>
          {pending.map((model) => {
            const review = reviews[model.id] ?? { evidence: "", basis: "" };
            const reviewReady =
              review.evidence && review.basis.trim().length >= 30;
            return (
              <div
                key={model.id}
                className="grid gap-2 rounded-lg border border-white/8 p-3 md:grid-cols-2"
              >
                <p className="text-xs font-mono text-slate-200">
                  {model.modelKey}@{model.version} ·{" "}
                  {model.approvalStatus.replaceAll("_", " ")}
                </p>
                <select
                  className={inputClass}
                  value={review.evidence}
                  onChange={(e) =>
                    setReviews({
                      ...reviews,
                      [model.id]: { ...review, evidence: e.target.value },
                    })
                  }
                >
                  <option value="">Verified review evidence…</option>
                  {(evidence.data ?? []).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.description ?? item.source_reference ?? item.id}
                    </option>
                  ))}
                </select>
                <textarea
                  className={`${inputClass} min-h-16 md:col-span-2`}
                  placeholder="Independent review basis (30 characters minimum)"
                  value={review.basis}
                  onChange={(e) =>
                    setReviews({
                      ...reviews,
                      [model.id]: { ...review, basis: e.target.value },
                    })
                  }
                />
                <div className="flex gap-2 md:col-span-2">
                  {(["approved", "rejected"] as const).map((decision) => (
                    <button
                      key={decision}
                      type="button"
                      disabled={busy || !reviewReady}
                      onClick={() =>
                        void act(
                          () =>
                            reviewModelRegistryVersion({
                              modelRegisterId: model.id,
                              decision,
                              evidenceItemId: review.evidence,
                              reviewBasis: review.basis.trim(),
                            }),
                          `Version ${decision}; ${decision === "approved" ? "it is now the exact current version." : "it remains unavailable for decisions."}`,
                        )
                      }
                      className="rounded border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 disabled:opacity-40"
                    >
                      {decision === "approved"
                        ? "Approve exact version"
                        : "Reject version"}
                    </button>
                  ))}
                </div>
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
        <p role="alert" className="mt-3 text-xs text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
