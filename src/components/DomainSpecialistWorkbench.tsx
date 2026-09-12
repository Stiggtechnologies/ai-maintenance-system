import { useEffect, useState } from "react";
import { Beaker, Database, ShieldCheck, TriangleAlert } from "lucide-react";
import {
  DOMAIN_SPECIALIST_MODULES,
  getDomainSpecialistMethod,
  getDomainSpecialistModule,
  type DomainEvidenceReference,
  type DomainSpecialistModuleKey,
  type DomainSpecialistResult,
} from "../lib/domain-specialists";

import {
  getDomainSpecialistRuns,
  previewDomainSpecialist,
  recordDomainSpecialistRun,
  reviewDomainSpecialistRun,
  type DomainSpecialistRunRow,
} from "../services/domainSpecialistService";
import type { RiskRecord } from "../types/risk";

const DOMAIN_SPECIALIST_METHOD_COUNT = DOMAIN_SPECIALIST_MODULES.reduce(
  (count, module) => count + module.methods.length,
  0,
);

function resultTone(result: DomainSpecialistResult | null): string {
  if (!result) return "border-white/7 bg-[#0D1520]";
  if (result.status === "blocked") return "border-red-500/25 bg-red-500/6";
  if (result.gaps.length) return "border-amber-500/25 bg-amber-500/6";
  return "border-teal-500/25 bg-teal-500/6";
}

export function DomainSpecialistWorkbench({ risks }: { risks: RiskRecord[] }) {
  const [riskId, setRiskId] = useState(risks[0]?.id ?? "");
  const [moduleKey, setModuleKey] = useState<DomainSpecialistModuleKey>(
    DOMAIN_SPECIALIST_MODULES[0].key,
  );
  const module = getDomainSpecialistModule(moduleKey)!;
  const [methodKey, setMethodKey] = useState(module.methods[0].key);
  const method =
    getDomainSpecialistMethod(moduleKey, methodKey) ?? module.methods[0];
  const [inputText, setInputText] = useState(() =>
    JSON.stringify(method.exampleInputs, null, 2),
  );
  const [evidenceBindings, setEvidenceBindings] = useState<
    Record<string, { sourceReference: string; evidenceItemId: string }>
  >({});
  const [result, setResult] = useState<DomainSpecialistResult | null>(null);
  const [history, setHistory] = useState<DomainSpecialistRunRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [reviewOutcome, setReviewOutcome] = useState<
    "reviewed" | "needs_changes" | "rejected"
  >("reviewed");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedRisk = risks.find((risk) => risk.id === riskId) ?? null;

  useEffect(() => {
    const nextModule = getDomainSpecialistModule(moduleKey)!;
    const nextMethod = nextModule.methods[0];
    setMethodKey(nextMethod.key);
    setInputText(JSON.stringify(nextMethod.exampleInputs, null, 2));
    setEvidenceBindings({});
    setResult(null);
  }, [moduleKey]);

  useEffect(() => {
    const nextMethod = getDomainSpecialistMethod(moduleKey, methodKey);
    if (!nextMethod) return;
    setInputText(JSON.stringify(nextMethod.exampleInputs, null, 2));
    setEvidenceBindings({});
    setResult(null);
  }, [methodKey, moduleKey]);

  useEffect(() => {
    setEvidenceBindings({});
    setSelectedRunId(null);
    if (!riskId) {
      setHistory([]);
      return;
    }
    void getDomainSpecialistRuns(riskId)
      .then(setHistory)
      .catch((cause) =>
        setError(
          cause instanceof Error ? cause.message : "Could not load runs",
        ),
      );
  }, [riskId]);

  const request = (() => {
    let inputs: Record<string, unknown>;
    try {
      const parsed = JSON.parse(inputText) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return null;
      inputs = parsed as Record<string, unknown>;
    } catch {
      return null;
    }
    const evidence: DomainEvidenceReference[] = method.requiredEvidence.map(
      (key) => ({
        key,
        sourceReference: evidenceBindings[key]?.sourceReference ?? "",
        evidenceItemId: evidenceBindings[key]?.evidenceItemId ?? "",
      }),
    );
    return { moduleKey, methodKey: method.key, inputs, evidence };
  })();

  function preview() {
    setError(null);
    if (!request) {
      setError("Inputs must be a valid JSON object.");
      return;
    }
    setResult(previewDomainSpecialist(request));
  }

  async function record() {
    setError(null);
    if (!riskId) {
      setError("Select a governed risk before recording a specialist run.");
      return;
    }
    if (!request) {
      setError("Inputs must be a valid JSON object.");
      return;
    }
    setBusy(true);
    try {
      const response = await recordDomainSpecialistRun(riskId, request);
      setResult(response.result);
      setHistory(await getDomainSpecialistRuns(riskId));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Specialist run failed",
      );
    } finally {
      setBusy(false);
    }
  }

  async function review() {
    setError(null);
    if (!selectedRunId) return;
    if (reviewNote.trim().length < 20) {
      setError("Record at least 20 characters of independent review basis.");
      return;
    }
    setReviewBusy(true);
    try {
      await reviewDomainSpecialistRun(selectedRunId, reviewOutcome, reviewNote);
      setHistory(await getDomainSpecialistRuns(riskId));
      setReviewNote("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review failed");
    } finally {
      setReviewBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-teal-500/20 bg-teal-500/5 p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-teal-500/12 p-2 text-teal-300">
            <Beaker className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">
              Domain-depth specialist workbench
            </h2>
            <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-400">
              {DOMAIN_SPECIALIST_MODULES.length} governed modules and{" "}
              {DOMAIN_SPECIALIST_METHOD_COUNT} deterministic methods. Every run
              is attached to a risk and canonical evidence, registered as a
              model, recalculated server-side, and retained as a
              non-authoritative draft for independent human review.
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-5">
          <div className="grid gap-4 md:grid-cols-3">
            <label className="text-xs font-semibold text-slate-300">
              Governed risk
              <select
                value={riskId}
                onChange={(event) => setRiskId(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#111C29] px-3 py-2 text-sm text-white"
              >
                <option value="">Select a risk</option>
                {risks.map((risk) => (
                  <option key={risk.id} value={risk.id}>
                    {risk.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-300">
              Specialist module
              <select
                value={moduleKey}
                onChange={(event) =>
                  setModuleKey(event.target.value as DomainSpecialistModuleKey)
                }
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#111C29] px-3 py-2 text-sm text-white"
              >
                {DOMAIN_SPECIALIST_MODULES.map((candidate) => (
                  <option key={candidate.key} value={candidate.key}>
                    {candidate.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-300">
              Method
              <select
                value={methodKey}
                onChange={(event) => setMethodKey(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#111C29] px-3 py-2 text-sm text-white"
              >
                {module.methods.map((candidate) => (
                  <option key={candidate.key} value={candidate.key}>
                    {candidate.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 rounded-xl border border-white/7 bg-white/3 p-4 text-xs leading-relaxed text-slate-400">
            <p className="font-semibold text-slate-200">{method.purpose}</p>
            <p className="mt-1">{method.algorithm}</p>
            <p className="mt-2 text-amber-300">
              Required reviewer: {method.requiredApproverRole}
              <span className="ml-1 text-slate-500">
                ({module.reviewerRoleKey})
              </span>
            </p>
          </div>

          <label className="mt-4 block text-xs font-semibold text-slate-300">
            Specialist inputs · governed JSON contract
            <textarea
              value={inputText}
              onChange={(event) => setInputText(event.target.value)}
              spellCheck={false}
              className="mt-1.5 min-h-64 w-full rounded-xl border border-white/10 bg-[#071019] p-3 font-mono text-xs leading-relaxed text-slate-200"
            />
          </label>

          <div className="mt-4">
            <p className="text-xs font-semibold text-slate-300">
              Required evidence provenance
            </p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {method.requiredEvidence.map((key) => (
                <div key={key} className="text-[11px] text-slate-400">
                  <p>{key}</p>
                  <input
                    aria-label={`${key} source reference`}
                    value={evidenceBindings[key]?.sourceReference ?? ""}
                    onChange={(event) =>
                      setEvidenceBindings((current) => ({
                        ...current,
                        [key]: {
                          sourceReference: event.target.value,
                          evidenceItemId: current[key]?.evidenceItemId ?? "",
                        },
                      }))
                    }
                    placeholder="Controlled source, record, or document reference"
                    className="mt-1 w-full rounded-lg border border-white/10 bg-[#111C29] px-3 py-2 text-xs text-white"
                  />
                  <select
                    aria-label={`${key} canonical evidence`}
                    value={evidenceBindings[key]?.evidenceItemId ?? ""}
                    onChange={(event) =>
                      setEvidenceBindings((current) => ({
                        ...current,
                        [key]: {
                          sourceReference: current[key]?.sourceReference ?? "",
                          evidenceItemId: event.target.value,
                        },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-[#111C29] px-3 py-2 text-xs text-white"
                  >
                    <option value="">Bind canonical risk evidence</option>
                    {(selectedRisk?.evidence ?? []).map((evidence) => (
                      <option key={evidence.id} value={evidence.id}>
                        {evidence.description ??
                          evidence.type ??
                          "Risk evidence"}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {(selectedRisk?.evidence.length ?? 0) === 0 && (
              <p className="mt-2 text-xs text-amber-300">
                This risk has no canonical evidence yet. A blocked run may be
                recorded, but a computed draft will be refused until evidence is
                attached through the risk evidence workflow.
              </p>
            )}
          </div>

          {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={preview}
              className="rounded-lg border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5"
            >
              Preview locally
            </button>
            <button
              type="button"
              onClick={() => void record()}
              disabled={busy || !riskId}
              className="rounded-lg bg-teal-500 px-4 py-2 text-xs font-bold text-[#04100f] hover:bg-teal-400 disabled:opacity-40"
            >
              {busy ? "Executing…" : "Run server-side & record"}
            </button>
          </div>
        </section>

        <div className="space-y-5">
          <section className={`rounded-2xl border p-5 ${resultTone(result)}`}>
            <div className="flex items-center gap-2">
              {result?.status === "blocked" ? (
                <TriangleAlert className="h-4 w-4 text-red-300" />
              ) : (
                <ShieldCheck className="h-4 w-4 text-teal-300" />
              )}
              <h3 className="text-sm font-bold text-white">Latest result</h3>
            </div>
            {!result ? (
              <p className="mt-3 text-xs text-slate-500">
                Preview or record a run to see its calculation, gaps, formulae,
                and authority boundary.
              </p>
            ) : (
              <div className="mt-3 space-y-3 text-xs text-slate-300">
                <p className="leading-relaxed">{result.summary}</p>
                <div className="grid grid-cols-2 gap-2">
                  {result.metrics.map((metric) => (
                    <div
                      key={metric.key}
                      className="rounded-lg border border-white/7 bg-black/10 p-2"
                    >
                      <p className="text-[10px] text-slate-500">
                        {metric.label}
                      </p>
                      <p className="mt-0.5 font-semibold text-white">
                        {metric.value == null
                          ? "Not computed"
                          : String(metric.value)}{" "}
                        {metric.unit ?? ""}
                      </p>
                    </div>
                  ))}
                </div>
                {result.findings.map((finding) => (
                  <p key={finding}>• {finding}</p>
                ))}
                {result.gaps.length > 0 && (
                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/6 p-3 text-amber-200">
                    {result.gaps.map((gap) => (
                      <p key={gap}>• {gap}</p>
                    ))}
                  </div>
                )}
                <div className="border-t border-white/7 pt-3 text-[11px] leading-relaxed text-slate-500">
                  {result.authorityBoundary}
                </div>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-white/7 bg-[#0D1520] p-5">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-cyan-300" />
              <h3 className="text-sm font-bold text-white">Run history</h3>
            </div>
            <div className="mt-3 space-y-2">
              {history.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => {
                    setResult(run.result_envelope);
                    setSelectedRunId(run.id);
                  }}
                  className="w-full rounded-lg border border-white/7 p-3 text-left hover:bg-white/3"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-slate-200">
                      {run.method_key}
                    </span>
                    <span className="text-slate-500">{run.run_status}</span>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-600">
                    {new Date(run.created_at).toLocaleString()} ·{" "}
                    {run.evidence_item_ids.length} evidence link(s)
                  </p>
                </button>
              ))}
              {history.length === 0 && (
                <p className="text-xs text-slate-500">
                  No recorded specialist run for this risk.
                </p>
              )}
            </div>
            {selectedRunId &&
              !["reviewed", "rejected"].includes(
                history.find((run) => run.id === selectedRunId)?.run_status ??
                  "",
              ) && (
                <div className="mt-4 space-y-2 border-t border-white/7 pt-4">
                  <p className="text-[11px] text-amber-300">
                    Required review role:{" "}
                    {
                      history.find((run) => run.id === selectedRunId)
                        ?.required_reviewer_role_key
                    }
                  </p>
                  <label className="block text-xs text-slate-300">
                    Independent review outcome
                    <select
                      value={reviewOutcome}
                      onChange={(event) =>
                        setReviewOutcome(
                          event.target.value as typeof reviewOutcome,
                        )
                      }
                      className="mt-1 w-full rounded-lg border border-white/10 bg-[#111C29] px-3 py-2 text-xs text-white"
                    >
                      <option value="reviewed">Reviewed</option>
                      <option value="needs_changes">Needs changes</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </label>
                  <label className="block text-xs text-slate-300">
                    Review basis
                    <textarea
                      value={reviewNote}
                      onChange={(event) => setReviewNote(event.target.value)}
                      className="mt-1 min-h-20 w-full rounded-lg border border-white/10 bg-[#111C29] px-3 py-2 text-xs text-white"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void review()}
                    disabled={reviewBusy}
                    className="w-full rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold text-black disabled:opacity-40"
                  >
                    {reviewBusy
                      ? "Recording review…"
                      : "Record independent review"}
                  </button>
                </div>
              )}
          </section>
        </div>
      </div>
    </div>
  );
}
