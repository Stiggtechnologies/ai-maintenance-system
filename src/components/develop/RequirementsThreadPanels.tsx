/**
 * Sync Develop Slice 5A — design integrity and the digital thread.
 *
 *   D4.16  the Requirement object: §10's eleven categories, the hierarchy, and
 *          the thread from objective through installed asset and commissioning
 *          test to the operating KPI — with the two DEFERRED links (design
 *          object, procurement specification) rendered as deferred rather than
 *          dropped, because a link missing from the picture reads as a link
 *          that does not exist.
 *   D4.17  the Verification object: §11's five methods, planned against a
 *          requirement with a procedure, acceptance criteria and a due date
 *          that is real or SAYS it is assumed; the result recorded by a named
 *          human through the ONE verification RPC.
 *   D12.09 the Requirements Agent: missing method / unverified / orphan /
 *          inconsistent / unowned, deterministic in SQL, with the model used
 *          only for semantic contradiction and every such finding labelled
 *          AI-generated on the screen.
 *
 * THE SURFACE CONVENTION, unchanged: a REFUSAL is an answer and is rendered as
 * prose, never as an error and never as a zero. Every coverage percentage on
 * this panel comes off the server; where the server refused to compute one,
 * `coverageLabel` says so instead of printing 0% or 100%.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Bot, GitBranch, ShieldCheck } from "lucide-react";

import {
  VERIFICATION_METHODS,
  agentModelNote,
  aiFindingsAsFindings,
  coverageLabel,
  deferredChainLinks,
  findingsHeadline,
  hasAiGeneratedFindings,
  methodDemandsAcceptanceCriteria,
  orderedFindings,
  requirementGapLists,
  traceabilityHeadline,
  wbsClause,
  type RequirementFinding,
  type RequirementFindings,
  type RequirementTraceability,
  type RequirementVerificationView,
} from "../../lib/develop/requirements";
import {
  computeCaseRequirementTraceability,
  createRequirementVerification,
  getCaseRequirementFindings,
  getCaseRequirementTraceability,
  getCaseRequirementVerifications,
  getRequirementAgentReports,
  linkRequirementThread,
  listBindableAssets,
  listCaseObjectives,
  listCaseRequirements,
  listCommissioningTests,
  listOperatingKpis,
  listOrgEvidenceItems,
  runRequirementsAgent,
} from "../../services/developService";
import { recordVerificationResult } from "../../services/operatingLoopService";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";
const btnClass =
  "rounded-lg bg-signal-cyan/15 px-3 py-1.5 text-xs font-semibold text-signal-cyan hover:bg-signal-cyan/25 disabled:opacity-40";

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      </div>
      <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded border border-red-400/30 bg-red-400/10 px-2.5 py-1.5 text-xs text-red-300">
      {error}
    </div>
  );
}

/** A refusal is an ANSWER, so it is rendered as prose and never as an error. */
function Refusal({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className="rounded border border-amber-400/25 bg-amber-400/5 px-2.5 py-1.5 text-xs text-amber-200">
      {text}
    </div>
  );
}

const SEVERITY_TONE: Record<string, string> = {
  blocking: "border-red-400/30 bg-red-400/10 text-red-200",
  attention: "border-amber-400/25 bg-amber-400/5 text-amber-200",
  informational: "border-white/10 bg-white/[0.02] text-slate-300",
};

/** The same three tones for the §10 gap lists. */
const GAP_TONE: Record<string, string> = SEVERITY_TONE;

interface RequirementRow {
  id: number;
  requirement_ref: string;
  category: string;
  requirement: string;
  parent_requirement_id: number | null;
  owner_id: string | null;
  acceptance_criteria: string | null;
  objective_id: string | null;
  operating_kpi_key: string | null;
  verification_method: string | null;
  verification_status: string;
}

export function RequirementsThreadPanel({
  caseId,
  members,
  canPlan,
  reloadKey,
}: {
  caseId: string;
  members: { id: string; name: string }[];
  canPlan: boolean;
  reloadKey?: number;
}) {
  const [trace, setTrace] = useState<RequirementTraceability | null>(null);
  const [verifications, setVerifications] =
    useState<RequirementVerificationView | null>(null);
  const [findings, setFindings] = useState<RequirementFindings | null>(null);
  const [requirements, setRequirements] = useState<RequirementRow[]>([]);
  const [objectives, setObjectives] = useState<
    { id: string; description: string }[]
  >([]);
  const [kpis, setKpis] = useState<{ kpi_key: string; name: string }[]>([]);
  const [assets, setAssets] = useState<
    { id: string; name: string; tag: string | null }[]
  >([]);
  const [tests, setTests] = useState<
    { id: number; test_ref: string; test_type: string | null }[]
  >([]);
  const [evidence, setEvidence] = useState<
    { id: string; description: string; evidence_class: string | null }[]
  >([]);
  /**
   * The model's semantic candidates from the LAST agent run, and what it
   * dropped. Held in state because they arrive from the edge function and
   * have no home in the SQL finding engine — before this they were returned,
   * discarded, and the "AI-generated" badge below was unreachable code.
   */
  const [aiFindings, setAiFindings] = useState<RequirementFinding[]>([]);
  const [reports, setReports] = useState<
    {
      id: number;
      asAt: string;
      findingCount: number;
      byFamily: Record<string, number>;
      narrative: string | null;
      model: string | null;
      requestedBy: string | null;
    }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [agentNote, setAgentNote] = useState<string | null>(null);

  const [threadFor, setThreadFor] = useState<number | null>(null);
  const [threadForm, setThreadForm] = useState({
    objectiveId: "",
    satisfiedByAssetId: "",
    commissioningTestId: "",
    operatingKpiKey: "",
    ownerId: "",
    parentRequirementId: "",
    acceptanceCriteria: "",
  });

  const [verifyFor, setVerifyFor] = useState<number | null>(null);
  const [verifyForm, setVerifyForm] = useState({
    methodCode: "analysis",
    procedure: "",
    acceptanceCriteria: "",
    dueDate: "",
    supersedesObligationId: "",
  });

  const [resultFor, setResultFor] = useState<string | null>(null);
  const [resultForm, setResultForm] = useState<{
    result: "" | "achieved" | "not_achieved" | "inconclusive";
    measuredNote: string;
    evidenceId: string;
  }>({ result: "", measuredNote: "", evidenceId: "" });

  const load = useCallback(async () => {
    setError(null);
    try {
      const [t, v, f, r, o, k, h, a, ct, ev] = await Promise.all([
        getCaseRequirementTraceability(caseId),
        getCaseRequirementVerifications(caseId),
        getCaseRequirementFindings(caseId),
        listCaseRequirements(caseId),
        listCaseObjectives(),
        listOperatingKpis(),
        getRequirementAgentReports(caseId),
        listBindableAssets(),
        listCommissioningTests(),
        listOrgEvidenceItems(),
      ]);
      setTrace(t);
      setVerifications(v);
      setFindings(f);
      setRequirements(r as RequirementRow[]);
      setObjectives(o);
      setKpis(k);
      setReports(h.reports);
      setAssets(a);
      setTests(ct);
      setEvidence(ev);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after?.();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const deferred = useMemo(() => deferredChainLinks(trace), [trace]);
  /**
   * The deterministic findings AND the model's semantic candidates in ONE
   * list. `orderedFindings` sorts every ai_suggestion below every fact, which
   * was a no-op while the list came from SQL alone (that engine writes
   * `deterministic` on every row it produces).
   */
  const allFindings = useMemo(
    () => [...(findings?.findings ?? []), ...aiFindings],
    [findings, aiFindings],
  );
  const ordered = useMemo(() => orderedFindings(allFindings), [allFindings]);
  const gapLists = useMemo(() => requirementGapLists(trace), [trace]);
  /**
   * The recorded failures against one requirement that nothing has answered.
   * A re-verification that does not NAME one of these leaves the requirement
   * failed, which the server states and this offers a way to avoid.
   */
  const failuresFor = useCallback(
    (requirementId: number) =>
      (verifications?.verifications ?? []).filter(
        (v) =>
          v.requirementId === requirementId &&
          v.status === "completed" &&
          v.result === "not_achieved" &&
          !v.supersededByObligationId,
      ),
    [verifications],
  );

  return (
    <div className="space-y-4">
      {/* ── D4.16: the §10 object and its thread ─────────────────────────── */}
      <Section
        icon={<GitBranch className="h-4 w-4 text-signal-cyan" aria-hidden />}
        title="Requirements and the digital thread (§10)"
        subtitle="Objective → requirement → installed asset → commissioning test → operating KPI, over the ONE project requirement table. Two links of the spec's chain are not built yet; they are shown as deferred rather than left out, because a link missing from the picture reads as a link that does not exist."
      >
        <ErrorLine error={error} />
        <p className="text-xs text-slate-300">{traceabilityHeadline(trace)}</p>
        {trace?.refused && <Refusal text={trace.refusal} />}
        {(trace?.refusals ?? []).map((r, i) => (
          <Refusal key={i} text={r} />
        ))}

        {trace && !trace.refused && (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-white/8 p-2.5">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">
                  Thread coverage
                </p>
                <p className="text-sm text-slate-200">
                  {coverageLabel(trace.threadCoveragePct, "Complete")}
                </p>
              </div>
              <div className="rounded-lg border border-white/8 p-2.5">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">
                  Verified
                </p>
                <p className="text-sm text-slate-200">
                  {coverageLabel(trace.verifiedPct, "Verified")}
                </p>
              </div>
              <div className="rounded-lg border border-white/8 p-2.5">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">
                  Hierarchy
                </p>
                <p className="text-sm text-slate-200">
                  {trace.hierarchy?.roots ?? 0} root(s),{" "}
                  {trace.hierarchy?.children ?? 0} child(ren), depth{" "}
                  {trace.hierarchy?.maxDepth ?? 0}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-slate-500">
                  <tr>
                    <th className="py-1 pr-3">Chain link</th>
                    <th className="py-1 pr-3">Canonical home</th>
                    <th className="py-1 pr-3">Linked</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {trace.chain.map((l) => (
                    <tr key={l.link} className="border-t border-white/5">
                      <td className="py-1 pr-3">{l.link}</td>
                      <td className="py-1 pr-3 text-slate-400">{l.home}</td>
                      <td className="py-1 pr-3">
                        {l.built ? (
                          l.count
                        ) : (
                          <span className="text-amber-300">not built</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {deferred.map((l) => (
              <Refusal key={l.link} text={`${l.link}: ${l.deferral}`} />
            ))}

            {trace.scopeChain && (
              <p className="text-[11px] text-slate-500">
                {trace.scopeChain.note} Owner:{" "}
                <span className="font-mono">{trace.scopeChain.owner}</span>.{" "}
                {/* ONE implementation of "how many are absent from the WBS",
                    shared with the headline. Restating it here in JSX is how a
                    panel comes to report a different number from the sentence
                    above it — the defect this slice's ruling 1 exists to
                    forbid one table over. */}
                <span
                  className={
                    trace.scopeChain.answered === false ? "text-amber-300" : ""
                  }
                >
                  {wbsClause(trace)}
                  {trace.scopeChain.answered === false
                    ? "."
                    : `; ${trace.scopeChain.requirementsWithoutNeed.length} trace to no live business need.`}
                </span>
              </p>
            )}

            {/* The gap lists the server computes with a record link on every
                row. They were computed and rendered NOWHERE, so a requirement
                outside the §10 taxonomy, one with no owner and one with no
                acceptance criteria were all silently counted as compliant. */}
            <div className="space-y-1.5">
              {gapLists.map((g) => (
                <details
                  key={g.key}
                  className={`rounded-md border px-2.5 py-1.5 text-xs ${
                    g.rows.length === 0
                      ? "border-white/5 text-slate-500"
                      : GAP_TONE[g.tone]
                  }`}
                >
                  <summary className="cursor-pointer">
                    <span className="font-semibold">{g.label}</span>{" "}
                    <span className="tabular-nums">
                      {g.rows.length} of {trace.requirementCount}
                    </span>
                  </summary>
                  {g.rows.length === 0 ? (
                    <p className="mt-1 text-slate-500">{g.emptyNote}</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {g.rows.map((row) => (
                        <li key={`${g.key}-${row.requirementId}`}>
                          <span className="font-semibold">
                            {row.requirementRef}
                          </span>
                          {row.category ? ` · ${row.category}` : ""}
                          {row.measured ? (
                            <span className="text-slate-400">
                              {" "}
                              — measured: {row.measured}
                            </span>
                          ) : null}
                          {row.failureStandsUnretracted === false ? (
                            <span className="text-slate-500">
                              {" "}
                              (that failure has been superseded by a named
                              re-verification)
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              ))}
            </div>

            <button
              disabled={busy}
              onClick={() =>
                void run(() => computeCaseRequirementTraceability(caseId))
              }
              className={btnClass}
            >
              Record a traceability calculation
            </button>
          </>
        )}

        {/* Per-requirement thread linking. */}
        {requirements.length > 0 && (
          <div className="space-y-2">
            {requirements.map((r) => (
              <div
                key={r.id}
                className="rounded-lg border border-white/8 p-2.5 text-xs"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-200">
                    {r.requirement_ref}
                  </span>
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-slate-400">
                    {r.category.replaceAll("_", " ")}
                  </span>
                  <span className="text-slate-500">
                    {r.verification_status}
                    {r.verification_method
                      ? ` · ${r.verification_method.replaceAll("_", " ")}`
                      : " · no verification method"}
                  </span>
                  {r.objective_id == null && (
                    <span className="text-amber-300">no objective</span>
                  )}
                  {r.owner_id == null && (
                    <span className="text-amber-300">no owner</span>
                  )}
                  {r.operating_kpi_key == null && (
                    <span className="text-amber-300">no operating KPI</span>
                  )}
                </div>
                <p className="mt-1 text-slate-400">{r.requirement}</p>
                {canPlan && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      className={btnClass}
                      onClick={() => {
                        setThreadFor(threadFor === r.id ? null : r.id);
                        setThreadForm({
                          objectiveId: "",
                          satisfiedByAssetId: "",
                          commissioningTestId: "",
                          operatingKpiKey: "",
                          ownerId: "",
                          parentRequirementId: "",
                          acceptanceCriteria: "",
                        });
                      }}
                    >
                      {threadFor === r.id ? "Cancel" : "Link the thread"}
                    </button>
                    <button
                      className={btnClass}
                      onClick={() => {
                        setVerifyFor(verifyFor === r.id ? null : r.id);
                        setVerifyForm({
                          methodCode: "analysis",
                          procedure: "",
                          acceptanceCriteria: "",
                          dueDate: "",
                          supersedesObligationId: "",
                        });
                      }}
                    >
                      {verifyFor === r.id ? "Cancel" : "Plan a verification"}
                    </button>
                  </div>
                )}

                {canPlan && threadFor === r.id && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <select
                      value={threadForm.objectiveId}
                      onChange={(e) =>
                        setThreadForm({
                          ...threadForm,
                          objectiveId: e.target.value,
                        })
                      }
                      className={inputClass}
                    >
                      <option value="">Objective (leave to keep)…</option>
                      {objectives.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.description.slice(0, 70)}
                        </option>
                      ))}
                    </select>
                    <select
                      value={threadForm.operatingKpiKey}
                      onChange={(e) =>
                        setThreadForm({
                          ...threadForm,
                          operatingKpiKey: e.target.value,
                        })
                      }
                      className={inputClass}
                    >
                      <option value="">Operating KPI (leave to keep)…</option>
                      {kpis.map((k) => (
                        <option key={k.kpi_key} value={k.kpi_key}>
                          {k.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={threadForm.ownerId}
                      onChange={(e) =>
                        setThreadForm({
                          ...threadForm,
                          ownerId: e.target.value,
                        })
                      }
                      className={inputClass}
                    >
                      <option value="">Owner (leave to keep)…</option>
                      {members.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    {/* The installed asset and the commissioning test.
                        Without these two selectors the columns were
                        write-unreachable from the product, and
                        threadCoveragePct — which counts a requirement threaded
                        only when objective AND asset AND test AND KPI are all
                        set — was structurally pinned at 0% for any customer
                        data while rendering as a measured figure. */}
                    <select
                      value={threadForm.satisfiedByAssetId}
                      onChange={(e) =>
                        setThreadForm({
                          ...threadForm,
                          satisfiedByAssetId: e.target.value,
                        })
                      }
                      className={inputClass}
                    >
                      <option value="">Installed asset (leave to keep)…</option>
                      {assets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                          {a.tag ? ` · ${a.tag}` : ""}
                        </option>
                      ))}
                    </select>
                    <select
                      value={threadForm.commissioningTestId}
                      onChange={(e) =>
                        setThreadForm({
                          ...threadForm,
                          commissioningTestId: e.target.value,
                        })
                      }
                      className={inputClass}
                    >
                      <option value="">
                        Commissioning test (leave to keep)…
                      </option>
                      {tests.map((t) => (
                        <option key={t.id} value={String(t.id)}>
                          {t.test_ref}
                          {t.test_type ? ` · ${t.test_type}` : ""}
                        </option>
                      ))}
                    </select>
                    <select
                      value={threadForm.parentRequirementId}
                      onChange={(e) =>
                        setThreadForm({
                          ...threadForm,
                          parentRequirementId: e.target.value,
                        })
                      }
                      className={inputClass}
                    >
                      <option value="">
                        Parent requirement (leave to keep)…
                      </option>
                      {requirements
                        .filter((x) => x.id !== r.id)
                        .map((x) => (
                          <option key={x.id} value={String(x.id)}>
                            {x.requirement_ref}
                          </option>
                        ))}
                    </select>
                    <textarea
                      value={threadForm.acceptanceCriteria}
                      onChange={(e) =>
                        setThreadForm({
                          ...threadForm,
                          acceptanceCriteria: e.target.value,
                        })
                      }
                      placeholder="Acceptance criteria — what 'met' means, measurably"
                      rows={2}
                      className={`${inputClass} sm:col-span-2`}
                    />
                    <button
                      disabled={busy}
                      className={`${btnClass} sm:col-span-2`}
                      onClick={() =>
                        void run(
                          () =>
                            linkRequirementThread(r.id, {
                              objectiveId: threadForm.objectiveId || undefined,
                              satisfiedByAssetId:
                                threadForm.satisfiedByAssetId || undefined,
                              commissioningTestId:
                                threadForm.commissioningTestId
                                  ? Number(threadForm.commissioningTestId)
                                  : undefined,
                              operatingKpiKey:
                                threadForm.operatingKpiKey || undefined,
                              ownerId: threadForm.ownerId || undefined,
                              parentRequirementId:
                                threadForm.parentRequirementId
                                  ? Number(threadForm.parentRequirementId)
                                  : undefined,
                              acceptanceCriteria:
                                threadForm.acceptanceCriteria || undefined,
                            }),
                          () => setThreadFor(null),
                        )
                      }
                    >
                      Link on the one requirement table
                    </button>
                    <p className="text-[11px] text-slate-500 sm:col-span-2">
                      Re-pointing a link is a correction. CLEARING one is
                      refused by the server: a hop that disappears is
                      indistinguishable from one that never existed.
                      {tests.length === 0 && (
                        <>
                          {" "}
                          No commissioning test exists in this organization to
                          link to — acceptance tests have no authoring path in
                          the product yet (D4.05), so this link cannot be
                          completed on this data. That is a missing target, not
                          a missing link.
                        </>
                      )}
                    </p>
                  </div>
                )}

                {canPlan && verifyFor === r.id && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <select
                      value={verifyForm.methodCode}
                      onChange={(e) =>
                        setVerifyForm({
                          ...verifyForm,
                          methodCode: e.target.value,
                        })
                      }
                      className={inputClass}
                    >
                      {VERIFICATION_METHODS.map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={verifyForm.dueDate}
                      onChange={(e) =>
                        setVerifyForm({
                          ...verifyForm,
                          dueDate: e.target.value,
                        })
                      }
                      className={inputClass}
                    />
                    <input
                      value={verifyForm.procedure}
                      onChange={(e) =>
                        setVerifyForm({
                          ...verifyForm,
                          procedure: e.target.value,
                        })
                      }
                      placeholder="Procedure (how it will be done)"
                      className={`${inputClass} sm:col-span-2`}
                    />
                    <textarea
                      value={verifyForm.acceptanceCriteria}
                      onChange={(e) =>
                        setVerifyForm({
                          ...verifyForm,
                          acceptanceCriteria: e.target.value,
                        })
                      }
                      placeholder={
                        methodDemandsAcceptanceCriteria(verifyForm.methodCode)
                          ? "Acceptance criteria — REQUIRED for a measured method: a test with nothing to test against produces a number nobody can call a pass or a fail"
                          : "Acceptance criteria (falls back to the requirement's own)"
                      }
                      rows={2}
                      className={`${inputClass} sm:col-span-2`}
                    />
                    {failuresFor(r.id).length > 0 && (
                      <select
                        value={verifyForm.supersedesObligationId}
                        onChange={(e) =>
                          setVerifyForm({
                            ...verifyForm,
                            supersedesObligationId: e.target.value,
                          })
                        }
                        className={`${inputClass} sm:col-span-2`}
                      >
                        <option value="">
                          This does not re-test a recorded failure…
                        </option>
                        {failuresFor(r.id).map((f) => (
                          <option key={f.obligationId} value={f.obligationId}>
                            Re-tests the failed{" "}
                            {String(f.methodCode).replaceAll("_", " ")}:{" "}
                            {f.measuredNote ?? "(no measurement)"}
                          </option>
                        ))}
                      </select>
                    )}
                    {failuresFor(r.id).length > 0 &&
                      !verifyForm.supersedesObligationId && (
                        <p className="sm:col-span-2 text-[11px] text-amber-300">
                          {r.requirement_ref} carries a recorded verification
                          FAILURE that nothing has superseded. Unless this
                          verification NAMES that failure, the requirement will
                          stay FAILED whatever this one measures — a later pass
                          by another method does not un-fail an earlier failure.
                        </p>
                      )}
                    <button
                      disabled={busy}
                      className={`${btnClass} sm:col-span-2`}
                      onClick={() =>
                        void run(
                          () =>
                            createRequirementVerification(r.id, {
                              methodCode: verifyForm.methodCode,
                              procedure: verifyForm.procedure || undefined,
                              acceptanceCriteria:
                                verifyForm.acceptanceCriteria || undefined,
                              dueDate: verifyForm.dueDate || undefined,
                              supersedesObligationId:
                                verifyForm.supersedesObligationId || undefined,
                            }),
                          () => setVerifyFor(null),
                        )
                      }
                    >
                      Plan this verification (§11)
                    </button>
                    <p className="text-[11px] text-slate-500 sm:col-span-2">
                      With no due date the server assumes 30 days and SAYS it
                      assumed: an obligation that can never be overdue is an
                      open verification nobody can see.
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── D4.17: the §11 Verification object ───────────────────────────── */}
      <Section
        icon={<ShieldCheck className="h-4 w-4 text-signal-cyan" aria-hidden />}
        title="Verification (§11, five methods)"
        subtitle="Analysis, inspection, demonstration, test, operational validation — each with a procedure, acceptance criteria and a due date. A result is recorded by a named human against a measurement; §70 refuses the AI-operator identity at the door and at the persistence wall."
      >
        {verifications?.refused && <Refusal text={verifications.refusal} />}
        {(verifications?.refusals ?? []).map((r, i) => (
          <Refusal key={i} text={r} />
        ))}
        {verifications && !verifications.refused && (
          <>
            <p className="text-xs text-slate-300">
              {verifications.requirementsWithAVerification} of{" "}
              {verifications.requirementCount} requirement(s) carry a
              verification;{" "}
              {coverageLabel(verifications.verificationCoveragePct, "coverage")}
              . {verifications.openVerifications} open, {verifications.overdue}{" "}
              overdue.
            </p>
            {verifications.verifications.length === 0 ? (
              <p className="text-xs text-slate-500">
                No verification has been planned against any requirement on this
                case. That is not "verified"; it is nobody having said how
                anyone would know.
              </p>
            ) : (
              <div className="space-y-2">
                {verifications.verifications.map((v) => (
                  <div
                    key={v.obligationId}
                    className="rounded-lg border border-white/8 p-2.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-200">
                        {v.requirementRef}
                      </span>
                      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-slate-400">
                        {String(v.methodCode).replaceAll("_", " ")}
                      </span>
                      <span className="text-slate-500">
                        due {v.dueDate}
                        {v.dueDateAssumed ? " (assumed)" : ""}
                      </span>
                      {v.daysOverdue > 0 && (
                        <span className="text-red-300">
                          {v.daysOverdue} day(s) overdue
                        </span>
                      )}
                      <span className="text-slate-400">
                        {v.status}
                        {v.result ? ` · ${v.result.replaceAll("_", " ")}` : ""}
                      </span>
                    </div>
                    {v.acceptanceCriteria && (
                      <p className="mt-1 text-slate-400">
                        <span className="text-slate-500">Criteria: </span>
                        {v.acceptanceCriteria}
                      </p>
                    )}
                    {v.measuredNote && (
                      <p className="mt-1 text-slate-400">
                        <span className="text-slate-500">Measured: </span>
                        {v.measuredNote}
                        {v.verifiedBy ? ` — ${v.verifiedBy}` : ""}
                      </p>
                    )}
                    {v.supersedesObligationId && (
                      <p className="mt-1 text-slate-400">
                        Planned to re-test an earlier recorded FAILURE, and it
                        names it. The failed result stays on this list.
                      </p>
                    )}
                    {v.result === "not_achieved" && (
                      <p className="mt-1 text-red-300">
                        {v.supersededByObligationId
                          ? "This failure has been answered by a named re-verification that passed. It stays on the record: a failure that disappears once it is fixed leaves nobody able to see it happened."
                          : "This failure STANDS. No verification has named it as the one it re-tests, so the requirement is FAILED whatever else has passed against it."}
                      </p>
                    )}
                    {canPlan && v.status === "open" && (
                      <div className="mt-2">
                        <button
                          className={btnClass}
                          onClick={() => {
                            setResultFor(
                              resultFor === v.obligationId
                                ? null
                                : v.obligationId,
                            );
                            setResultForm({
                              result: "",
                              measuredNote: "",
                              evidenceId: "",
                            });
                          }}
                        >
                          {resultFor === v.obligationId
                            ? "Cancel"
                            : "Record the result"}
                        </button>
                      </div>
                    )}
                    {canPlan && resultFor === v.obligationId && (
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <select
                          value={resultForm.result}
                          onChange={(e) =>
                            setResultForm({
                              ...resultForm,
                              result: e.target
                                .value as typeof resultForm.result,
                            })
                          }
                          className={inputClass}
                        >
                          <option value="">Result…</option>
                          <option value="achieved">Achieved</option>
                          <option value="not_achieved">Not achieved</option>
                          <option value="inconclusive">Inconclusive</option>
                        </select>
                        <input
                          value={resultForm.measuredNote}
                          onChange={(e) =>
                            setResultForm({
                              ...resultForm,
                              measuredNote: e.target.value,
                            })
                          }
                          placeholder="What was measured, against what, and when"
                          className={inputClass}
                        />
                        {/* §11's evidence_id. The RPC has carried the
                            parameter since this slice; until this selector
                            existed every production call passed null and the
                            only non-null writer in the repository was a smoke
                            script. */}
                        <select
                          value={resultForm.evidenceId}
                          onChange={(e) =>
                            setResultForm({
                              ...resultForm,
                              evidenceId: e.target.value,
                            })
                          }
                          className={`${inputClass} sm:col-span-2`}
                        >
                          <option value="">
                            Evidence item (§11) — none cited…
                          </option>
                          {evidence.map((ev) => (
                            <option key={ev.id} value={ev.id}>
                              {ev.description.slice(0, 90)}
                              {ev.evidence_class
                                ? ` · ${ev.evidence_class}`
                                : ""}
                            </option>
                          ))}
                        </select>
                        <button
                          disabled={
                            busy ||
                            resultForm.result === "" ||
                            resultForm.measuredNote.trim() === ""
                          }
                          className={`${btnClass} sm:col-span-2`}
                          onClick={() =>
                            void run(
                              () =>
                                recordVerificationResult(
                                  v.obligationId,
                                  resultForm.result as
                                    | "achieved"
                                    | "not_achieved"
                                    | "inconclusive",
                                  resultForm.measuredNote,
                                  resultForm.evidenceId || undefined,
                                ),
                              () => setResultFor(null),
                            )
                          }
                        >
                          Record this verification result
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Section>

      {/* ── D12.09: the Requirements Agent ───────────────────────────────── */}
      <Section
        icon={<Bot className="h-4 w-4 text-signal-cyan" aria-hidden />}
        title="Requirements Agent (§59) — proposes, never disposes"
        subtitle="Missing verification method, unverified, orphaned, internally inconsistent, unowned. Every one of those is a SQL query, not a model call. The model is asked one thing a query cannot do — whether two requirement statements contradict each other — and those findings are labelled AI-generated."
      >
        <p className="text-xs text-slate-300">{findingsHeadline(findings)}</p>
        {findings?.refused && <Refusal text={findings.refusal} />}
        {(findings?.refusals ?? []).map((r, i) => (
          <Refusal key={i} text={r} />
        ))}
        {agentNote && <Refusal text={agentNote} />}

        {ordered.length > 0 && (
          <ul className="space-y-1.5">
            {ordered.map((f, i) => (
              <li
                key={`${f.family}-${f.requirementRef}-${i}`}
                className={`rounded border px-2.5 py-1.5 text-xs ${
                  SEVERITY_TONE[f.severity] ?? SEVERITY_TONE.informational
                }`}
              >
                <span className="font-semibold">
                  {f.requirementRef ?? "(unreferenced)"}
                </span>{" "}
                <span className="uppercase tracking-wide text-[10px]">
                  {f.family.replaceAll("_", " ")}
                  {f.subFamily ? ` · ${f.subFamily.replaceAll("_", " ")}` : ""}
                </span>
                {f.source === "ai_suggestion" && (
                  <span className="ml-1 rounded bg-white/10 px-1 py-0.5 text-[10px] uppercase tracking-wide">
                    AI-generated
                  </span>
                )}
                <p className="mt-0.5">{f.detail}</p>
              </li>
            ))}
          </ul>
        )}

        {(hasAiGeneratedFindings(findings) || aiFindings.length > 0) && (
          <p className="text-[11px] text-slate-500">
            Findings marked AI-generated are a model's reading of two
            requirement statements. They are capped at &ldquo;attention&rdquo;
            by the server and can never be recorded as blocking.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            disabled={busy}
            className={btnClass}
            onClick={() =>
              void run(async () => {
                const res = await runRequirementsAgent({ caseId });
                // The model half is KEPT. It used to be returned and
                // discarded, which made the AI-generated badge, the
                // "capped at attention" disclaimer and the AI-below-facts
                // sort all unreachable code, and made a successful run
                // produce no visible change on the page at all.
                setAiFindings(
                  res.refused
                    ? []
                    : aiFindingsAsFindings(
                        res.aiFindings ?? [],
                        (ref) =>
                          requirements.find((x) => x.requirement_ref === ref)
                            ?.id,
                      ),
                );
                setAgentNote(
                  res.refused ? (res.refusal ?? null) : agentModelNote(res),
                );
              })
            }
          >
            Ask the Requirements Agent
          </button>
          <button
            disabled={busy}
            className={btnClass}
            onClick={() =>
              void run(async () => {
                const res = await runRequirementsAgent({
                  caseId,
                  record: true,
                });
                setAiFindings(
                  res.refused
                    ? []
                    : aiFindingsAsFindings(
                        res.aiFindings ?? [],
                        (ref) =>
                          requirements.find((x) => x.requirement_ref === ref)
                            ?.id,
                      ),
                );
                setAgentNote(
                  res.recordNote ??
                    (res.refused ? (res.refusal ?? null) : agentModelNote(res)),
                );
              })
            }
          >
            Ask and record a dated reading
          </button>
        </div>

        <p className="text-[11px] text-slate-500">
          The agent cannot state a verification method, close an obligation or
          mark a requirement verified. Those doors refuse the AI-operator
          identity by name, and the persistence wall refuses a verification
          attributed to it for every writer, service included.
        </p>

        {reports.length > 0 && (
          <details className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
            <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Dated readings ({reports.length})
            </summary>
            <ul className="mt-2 space-y-2 text-xs text-slate-400">
              {reports.map((r) => (
                <li key={r.id} className="border-t border-white/5 pt-2">
                  <p className="text-slate-500">
                    {new Date(r.asAt).toLocaleString()} · {r.findingCount}{" "}
                    finding(s) · {r.model ?? "no model"} ·{" "}
                    {r.requestedBy ?? "unknown"}
                    {r.byFamily?.semanticInconsistencyAiSuggested
                      ? ` · ${r.byFamily.semanticInconsistencyAiSuggested} AI-suggested`
                      : ""}
                  </p>
                  {r.narrative && (
                    // The stored narrative is the deterministic reading and,
                    // after the marker line the edge function writes, the
                    // model's prose. It is rendered whole so the boundary is
                    // visible rather than being two paragraphs a reader has
                    // to guess between.
                    <p className="mt-1 whitespace-pre-wrap">{r.narrative}</p>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Section>
    </div>
  );
}
