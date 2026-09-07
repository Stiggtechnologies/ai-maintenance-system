import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import { ErrorState, LoadingState } from "../components/ui/AsyncStates";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import {
  addEngineeringModelDebt,
  bindEngineeringModelEvidence,
  getEngineeringModelRegistry,
  independentlyVerifyEngineeringModel,
  promoteEngineeringModel,
  registerBuiltInResonancePack,
  resolveEngineeringModelDebt,
  type EngineeringModelRegistryRow,
} from "../services/engineeringModelService";

interface EvidenceOption {
  id: string;
  description: string | null;
  source_system: string | null;
  data_quality: string;
  verification_status: "verified";
  quality_grade: "high" | "moderate" | "low" | null;
}

const NEXT_STATE: Record<string, string | undefined> = {
  draft: "derived",
  derived: "verified",
  verified: "bench_validated",
  bench_validated: "field_validated",
  field_validated: "engineering_approved",
  engineering_approved: "production_eligible",
  revalidation_required: "verified",
};

function words(value: string): string {
  return value.replaceAll("_", " ");
}

function canonicalEngineeringGrade(
  quality: EvidenceOption["quality_grade"],
): "A" | "B" | "C" | "D" {
  if (quality === "high") return "A";
  if (quality === "moderate") return "B";
  if (quality === "low") return "C";
  return "D";
}

function ModelCard({
  model,
  evidence,
  canManage,
  busy,
  run,
}: {
  model: EngineeringModelRegistryRow;
  evidence: EvidenceOption[];
  canManage: boolean;
  busy: boolean;
  run: (operation: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [reviewNote, setReviewNote] = useState("");
  const [evidenceItemId, setEvidenceItemId] = useState("");
  const [requirementKey, setRequirementKey] = useState(
    model.evidenceRequirements[0]?.key ?? "",
  );
  const [grade, setGrade] = useState<"A" | "B" | "C" | "D">("B");
  const [sourceRights, setSourceRights] = useState("");
  const [debtKey, setDebtKey] = useState("");
  const [debtDescription, setDebtDescription] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const requirement = model.evidenceRequirements.find(
    (item) => item.key === requirementKey,
  );
  const nextState = NEXT_STATE[model.lifecycleState];

  return (
    <article className="rounded-2xl border border-white/8 bg-[#0D1520] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-white">{model.name}</h2>
            <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-xs text-slate-300">
              v{model.version}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${model.productionEligible ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}
            >
              {words(model.lifecycleState)}
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            {model.description}
          </p>
          <p className="mt-2 font-mono text-xs text-slate-500">
            {model.modelKey} · {model.domain} ·{" "}
            {model.lifeModelType ?? "method"}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center text-xs">
          <div className="rounded-lg border border-white/6 bg-black/20 px-3 py-2">
            <div className="font-bold text-white">
              {model.verificationState === "passed" ? "Passed" : "Not passed"}
            </div>
            <div className="text-slate-500">verification</div>
          </div>
          <div className="rounded-lg border border-white/6 bg-black/20 px-3 py-2">
            <div className="font-bold text-white">{model.evidenceBound}</div>
            <div className="text-slate-500">evidence links</div>
          </div>
          <div className="rounded-lg border border-white/6 bg-black/20 px-3 py-2">
            <div className="font-bold text-white">{model.openDebt}</div>
            <div className="text-slate-500">open debt</div>
          </div>
          <div className="rounded-lg border border-white/6 bg-black/20 px-3 py-2">
            <div className="font-bold text-white">{model.openImpacts}</div>
            <div className="text-slate-500">open impacts</div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-xs text-slate-400 md:grid-cols-3">
        <div>
          <span className="text-slate-500">Source</span>
          <div className="mt-0.5 text-slate-200">
            {model.sourceTool} · {model.sourceLicense}
          </div>
        </div>
        <div>
          <span className="text-slate-500">Independent reviewer</span>
          <div className="mt-0.5 break-all text-slate-200">
            {words(model.requiredReviewerRoleKey)}
          </div>
        </div>
        <div>
          <span className="text-slate-500">Runtime posture</span>
          <div className="mt-0.5 text-slate-200">
            Deterministic ·{" "}
            {model.airGapCompatible
              ? "air-gap compatible"
              : "network constrained"}
          </div>
        </div>
      </div>

      {canManage ? (
        <div className="mt-5 grid gap-4 border-t border-white/6 pt-4 xl:grid-cols-3">
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
              Verification & promotion
            </h3>
            <button
              disabled={busy}
              onClick={() =>
                run(
                  () => independentlyVerifyEngineeringModel(model.id),
                  "Independent verification recorded.",
                )
              }
              className="w-full rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-300 disabled:opacity-50"
            >
              Independently rerun verification
            </button>
            <textarea
              aria-label={`Promotion basis for ${model.name}`}
              value={reviewNote}
              onChange={(event) => setReviewNote(event.target.value)}
              placeholder="Promotion/revalidation basis (20 characters minimum)"
              className="min-h-20 w-full rounded-lg border border-white/8 bg-black/20 p-2 text-xs text-white placeholder:text-slate-600"
            />
            {nextState ? (
              <button
                disabled={busy || reviewNote.trim().length < 20}
                onClick={() =>
                  run(
                    () =>
                      promoteEngineeringModel(model.id, nextState, reviewNote),
                    `Model moved to ${words(nextState)}.`,
                  )
                }
                className="w-full rounded-lg bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-300 disabled:opacity-40"
              >
                Advance to {words(nextState)}
              </button>
            ) : null}
            {model.lifecycleState === "production_eligible" ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  disabled={busy || reviewNote.trim().length < 20}
                  onClick={() =>
                    run(
                      () =>
                        promoteEngineeringModel(
                          model.id,
                          "revalidation_required",
                          reviewNote,
                        ),
                      "Model removed from production pending revalidation.",
                    )
                  }
                  className="rounded-lg bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-300 disabled:opacity-40"
                >
                  Require revalidation
                </button>
                <button
                  disabled={busy || reviewNote.trim().length < 20}
                  onClick={() =>
                    run(
                      () =>
                        promoteEngineeringModel(
                          model.id,
                          "retired",
                          reviewNote,
                        ),
                      "Model retired and downstream impacts opened.",
                    )
                  }
                  className="rounded-lg bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-300 disabled:opacity-40"
                >
                  Retire
                </button>
              </div>
            ) : null}
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
              Canonical evidence binding
            </h3>
            <select
              aria-label={`Evidence requirement for ${model.name}`}
              value={requirementKey}
              onChange={(event) => setRequirementKey(event.target.value)}
              className="w-full rounded-lg border border-white/8 bg-[#111b28] p-2 text-xs text-white"
            >
              {model.evidenceRequirements.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.key} · min {item.minimumGrade}
                </option>
              ))}
            </select>
            <select
              aria-label={`Evidence item for ${model.name}`}
              value={evidenceItemId}
              onChange={(event) => {
                const nextEvidenceId = event.target.value;
                setEvidenceItemId(nextEvidenceId);
                const selected = evidence.find(
                  (item) => item.id === nextEvidenceId,
                );
                if (selected)
                  setGrade(canonicalEngineeringGrade(selected.quality_grade));
              }}
              className="w-full rounded-lg border border-white/8 bg-[#111b28] p-2 text-xs text-white"
            >
              <option value="">Select verified canonical evidence…</option>
              {evidence.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.description ?? item.id} ·{" "}
                  {item.source_system ?? "unknown source"} · grade{" "}
                  {canonicalEngineeringGrade(item.quality_grade)}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-[5rem_1fr] gap-2">
              <select
                aria-label={`Evidence grade for ${model.name}`}
                value={grade}
                onChange={(event) =>
                  setGrade(event.target.value as typeof grade)
                }
                className="rounded-lg border border-white/8 bg-[#111b28] p-2 text-xs text-white"
              >
                {["A", "B", "C", "D"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
              <input
                aria-label={`Source rights for ${model.name}`}
                value={sourceRights}
                onChange={(event) => setSourceRights(event.target.value)}
                placeholder="Usage-rights basis"
                className="rounded-lg border border-white/8 bg-black/20 p-2 text-xs text-white placeholder:text-slate-600"
              />
            </div>
            <button
              disabled={
                busy ||
                !evidenceItemId ||
                !requirement ||
                sourceRights.trim().length < 5
              }
              onClick={() =>
                requirement &&
                run(
                  () =>
                    bindEngineeringModelEvidence({
                      modelRegisterId: model.id,
                      evidenceItemId,
                      requirement,
                      evidenceGrade: grade,
                      sourceRights,
                    }),
                  "Evidence bound to the model version.",
                )
              }
              className="w-full rounded-lg bg-blue-500/15 px-3 py-2 text-xs font-semibold text-blue-300 disabled:opacity-40"
            >
              Bind evidence
            </button>
          </section>

          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-300">
              Verification debt
            </h3>
            <input
              aria-label={`Debt key for ${model.name}`}
              value={debtKey}
              onChange={(event) => setDebtKey(event.target.value)}
              placeholder="Unique debt key"
              className="w-full rounded-lg border border-white/8 bg-black/20 p-2 text-xs text-white placeholder:text-slate-600"
            />
            <textarea
              aria-label={`Debt description for ${model.name}`}
              value={debtDescription}
              onChange={(event) => setDebtDescription(event.target.value)}
              placeholder="Blocking debt description"
              className="min-h-16 w-full rounded-lg border border-white/8 bg-black/20 p-2 text-xs text-white placeholder:text-slate-600"
            />
            <button
              disabled={
                busy || !debtKey.trim() || debtDescription.trim().length < 10
              }
              onClick={() =>
                run(
                  () =>
                    addEngineeringModelDebt(model.id, debtKey, debtDescription),
                  "Blocking verification debt recorded.",
                )
              }
              className="w-full rounded-lg bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-300 disabled:opacity-40"
            >
              Record blocking debt
            </button>
            {model.openDebtRecords.length > 0 ? (
              <div className="space-y-2 pt-1">
                {model.openDebtRecords.map((debt) => (
                  <div
                    key={debt.id}
                    className="rounded-lg border border-amber-500/15 bg-amber-500/5 p-2"
                  >
                    <div className="font-medium text-amber-200">
                      {debt.debtKey}
                    </div>
                    <p className="mt-0.5 text-slate-400">{debt.description}</p>
                    <input
                      aria-label={`Resolution note for ${debt.debtKey}`}
                      value={resolutionNote}
                      onChange={(event) =>
                        setResolutionNote(event.target.value)
                      }
                      placeholder="Resolution evidence (10 characters minimum)"
                      className="mt-2 w-full rounded border border-white/8 bg-black/20 p-1.5 text-xs text-white"
                    />
                    <button
                      disabled={busy || resolutionNote.trim().length < 10}
                      onClick={() =>
                        run(
                          () =>
                            resolveEngineeringModelDebt(
                              debt.id,
                              resolutionNote,
                            ),
                          "Verification debt resolved.",
                        )
                      }
                      className="mt-2 text-xs font-semibold text-emerald-300 disabled:opacity-40"
                    >
                      Resolve debt
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500">No open debt.</p>
            )}
          </section>
        </div>
      ) : (
        <p className="mt-4 border-t border-white/6 pt-3 text-xs text-slate-500">
          Read-only registry. Import, evidence binding, verification and
          lifecycle promotion require an administrator or Reliability Engineer;
          the server enforces every gate.
        </p>
      )}
    </article>
  );
}

export function EngineeringModelRegistryPage() {
  const { profile } = useAuth();
  const role = String(profile?.role ?? "");
  const canManage = role === "admin" || role === "reliability_engineer";
  const registry = useAsyncData(getEngineeringModelRegistry, [], {
    isEmpty: () => false,
  });
  const evidence = useAsyncData(async () => {
    const { data, error } = await supabase
      .from("evidence_items")
      .select(
        "id,description,source_system,data_quality,verification_status,quality_grade",
      )
      .eq("verification_status", "verified")
      .order("created_at", { ascending: false })
      .limit(100)
      .returns<EvidenceOption[]>();
    if (error) throw new Error(error.message);
    return data ?? [];
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice(null);
    setMutationError(null);
    try {
      await operation();
      setNotice(success);
      registry.refetch();
    } catch (error) {
      setMutationError(
        error instanceof Error
          ? error.message
          : "The controlled model operation failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (registry.loading || evidence.loading)
    return <LoadingState label="Loading engineering model registry…" />;
  if (registry.error)
    return <ErrorState message={registry.error} onRetry={registry.refetch} />;
  if (evidence.error)
    return <ErrorState message={evidence.error} onRetry={evidence.refetch} />;
  const data = registry.data;
  if (!data)
    return (
      <ErrorState
        message="Engineering model registry returned no data."
        onRetry={registry.refetch}
      />
    );
  const pilotRegistered = data.models.some(
    (model) =>
      model.modelKey === "pof.shaft-resonance.screening" &&
      model.version === "1.0.0",
  );

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
            <FlaskConical className="h-4 w-4" /> Engineering model supply chain
          </div>
          <h1 className="text-2xl font-bold text-white">
            Physics & Reliability Model Registry
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Versioned engineering artifacts move from derivation through
            independent verification, bench and field validation,
            competency-scoped approval and bounded production use.
          </p>
        </div>
        {canManage && !pilotRegistered ? (
          <button
            disabled={busy}
            onClick={() =>
              run(
                registerBuiltInResonancePack,
                "Vibration/resonance pilot registered as a draft.",
              )
            }
            className="rounded-lg border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-300 disabled:opacity-50"
          >
            Register vibration pilot
          </button>
        ) : null}
      </header>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-100">
        <div className="flex items-center gap-2 font-semibold">
          <LockKeyhole className="h-4 w-4" /> Human-final, deterministic
          boundary
        </div>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          GPD may author and red-team offline artifacts, but it is never a
          customer runtime dependency. Imported code cannot execute. SyncAI
          recomputes the manifest digest, independently reruns an allowlisted
          evaluator, refuses out-of-envelope inputs, and never turns a model
          result into operational authorization.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Registered", data.posture.registered],
          ["Production eligible", data.posture.productionEligible],
          ["Revalidation required", data.posture.revalidationRequired],
          ["Blocking debt", data.posture.openBlockingDebt],
          ["Field outcomes", data.posture.outcomesRecorded],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-white/6 bg-[#0D1520] p-4"
          >
            <div className="text-2xl font-black text-white">{value}</div>
            <div className="mt-1 text-xs text-slate-500">{label}</div>
          </div>
        ))}
      </div>

      {notice ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300"
        >
          <CheckCircle2 className="h-4 w-4" /> {notice}
        </div>
      ) : null}
      {mutationError ? (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300"
        >
          <AlertTriangle className="h-4 w-4" /> {mutationError}
        </div>
      ) : null}

      {data.models.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center">
          <ShieldCheck className="mx-auto h-8 w-8 text-slate-600" />
          <p className="mt-3 text-sm text-slate-300">
            No engineering model packs are registered in this tenant.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Nothing can execute until a valid pack is registered and every
            promotion gate passes.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {data.models.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              evidence={evidence.data ?? []}
              canManage={canManage}
              busy={busy}
              run={run}
            />
          ))}
        </div>
      )}

      <div className="flex items-start gap-2 rounded-xl border border-white/6 bg-[#0D1520] p-4 text-xs text-slate-400">
        <RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
        <p>{data.posture.basis}</p>
      </div>
    </div>
  );
}
