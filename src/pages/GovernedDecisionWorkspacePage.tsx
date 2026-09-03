/**
 * The governed Decision Workspace (D13.07 / overlap-map ruling 15).
 *
 * THE RULING THIS PAGE EXISTS TO SATISFY: the signed-in decision record
 * lives in the canonical `decisions` + `scenarios` stores — localStorage is
 * NEVER a system of record. The prior signed-in surface persisted rich case
 * state into localStorage and a jsonb blob; this page re-points the route:
 *
 *   * the LIST and DETAIL views read the canonical stores through RLS —
 *     the §44 columns (question, options matrix, approval routing,
 *     selection record) are the decisions/scenarios rows themselves;
 *   * editing is the Case Workspace's governed forms (create_case_decision,
 *     add_decision_option, select_decision_option) — one editor, linked,
 *     not duplicated;
 *   * any drafts a browser still holds from the old surface appear in an
 *     explicit "unsaved local drafts" banner with a ONE-TIME IMPORT path
 *     (frame the draft as a canonical case decision) and an explicit
 *     discard — never silent loss, never silent continuation;
 *   * the public value-proof demo keeps its own sessionStorage surface —
 *     it is a demo and says so; nothing here reads or seeds it.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Scale,
  Trash2,
} from "lucide-react";
import { type DecisionCase } from "../lib/decision-case";
import {
  readStoredDecisionDrafts,
  removeStoredDecisionDraft,
} from "../lib/decision-case-drafts";
import {
  createCaseDecision,
  getGovernedDecision,
  listDevelopmentCases,
  listGovernedDecisions,
  type DevelopmentCaseSummary,
  type GovernedDecisionOptionRow,
  type GovernedDecisionRow,
} from "../services/developService";

const inputClass =
  "rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 focus:border-signal-cyan/50 focus:outline-none";

function money(value: number | null): string {
  if (value == null) return "not stated";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    value,
  );
}

function DraftBanner({
  onImported,
}: {
  onImported: (decisionId: string) => void;
}) {
  const [drafts, setDrafts] = useState<DecisionCase[]>([]);
  const [cases, setCases] = useState<DevelopmentCaseSummary[]>([]);
  const [targetCase, setTargetCase] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setDrafts(readStoredDecisionDrafts(window.localStorage));
  }, []);

  useEffect(() => {
    refresh();
    listDevelopmentCases()
      .then(setCases)
      .catch(() => setCases([]));
  }, [refresh]);

  if (drafts.length === 0) return null;

  return (
    <div
      className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4"
      data-testid="browser-draft-banner"
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-amber-300">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        Browser drafts — import or discard
        {drafts.length === 1 ? "" : ` · ${drafts.length} leftover`}
      </div>
      <p className="mt-1 text-xs text-amber-200/80">
        Leftover localStorage DecisionCase drafts from the old workspace. They
        are not cowork threads, not Spaces, and not governed decisions. Import
        one into a development case, or discard it. These rows are not links and
        will not open a case until imported.
      </p>
      {error && <p className="mt-2 text-xs text-red-300">{error}</p>}
      <div className="mt-3 flex items-center gap-2">
        <select
          value={targetCase}
          onChange={(e) => setTargetCase(e.target.value)}
          className={inputClass}
          aria-label="Import target development case"
        >
          <option value="">Import target: select a development case</option>
          {cases.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        {cases.length === 0 && (
          <span className="text-xs text-amber-200/70">
            Import stays disabled until a development case is selected.
          </span>
        )}
      </div>
      <ul className="mt-2 space-y-2" aria-label="Browser drafts">
        {drafts.map((draft) => (
          <li
            key={draft.id}
            data-testid="browser-draft-row"
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/15 bg-amber-400/[0.04] px-3 py-2 text-xs"
          >
            <div>
              <span className="mr-2 inline-block rounded bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-200">
                Browser draft
              </span>
              <span className="text-amber-100/90">
                {draft.caseNumber} · {draft.title}
              </span>
              <span className="text-amber-200/50">
                {" "}
                — {draft.objective} (last touched{" "}
                {new Date(draft.updatedAt).toLocaleDateString()})
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busyId != null || targetCase === ""}
                onClick={() => {
                  setBusyId(draft.id);
                  setError(null);
                  createCaseDecision({
                    caseId: targetCase,
                    question: `${draft.title}: ${draft.objective}`.slice(
                      0,
                      500,
                    ),
                    approvalLevel: draft.authorityRole || null,
                  })
                    .then((result) => {
                      removeStoredDecisionDraft(window.localStorage, draft.id);
                      refresh();
                      onImported(result.decision_id);
                    })
                    .catch((e) =>
                      setError(
                        e instanceof Error ? e.message : "Import refused",
                      ),
                    )
                    .finally(() => setBusyId(null));
                }}
                className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 font-semibold text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busyId === draft.id ? "Importing…" : "Import"}
              </button>
              <button
                type="button"
                disabled={busyId != null}
                onClick={() => {
                  if (
                    window.confirm(
                      `Discard browser draft "${draft.title}"? It exists nowhere else and this cannot be undone.`,
                    )
                  ) {
                    removeStoredDecisionDraft(window.localStorage, draft.id);
                    refresh();
                  }
                }}
                className="flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1 text-slate-400 hover:text-red-300"
              >
                <Trash2 className="h-3 w-3" aria-hidden /> Discard
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OptionsMatrix({
  decision,
  options,
}: {
  decision: GovernedDecisionRow;
  options: GovernedDecisionOptionRow[];
}) {
  if (options.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        No options recorded on this decision yet — add them in the Case
        Workspace decision card.
      </p>
    );
  }
  const rows: {
    label: string;
    render: (o: GovernedDecisionOptionRow) => string;
  }[] = [
    { label: "CAPEX", render: (o) => money(o.capex) },
    { label: "OPEX", render: (o) => money(o.opex) },
    { label: "Lifecycle cost", render: (o) => money(o.lifecycle_cost) },
    { label: "Schedule", render: (o) => o.schedule_effect ?? "not stated" },
    { label: "Risk", render: (o) => o.risk_effect ?? "not stated" },
    { label: "RAM", render: (o) => o.reliability_effect ?? "not stated" },
    {
      label: "Environmental",
      render: (o) => o.environmental_effect ?? "not stated",
    },
    { label: "Expected value", render: (o) => money(o.expected_value) },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="text-[11px] uppercase text-slate-500">
            <th className="py-1 pr-3">Dimension</th>
            {options.map((o) => (
              <th key={o.id} className="py-1 pr-3">
                {o.label}
                {decision.selected_option_id === o.id && (
                  <span className="ml-1 rounded bg-emerald-400/10 px-1 py-0.5 text-[10px] font-semibold text-emerald-300">
                    selected
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="text-slate-300">
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-white/5">
              <td className="py-1.5 pr-3 text-slate-400">{row.label}</td>
              {options.map((o) => (
                <td key={o.id} className="py-1.5 pr-3">
                  {row.render(o)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GovernedDecisionWorkspacePage() {
  const { caseId } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const [decisions, setDecisions] = useState<
    (GovernedDecisionRow & { caseTitle: string | null })[]
  >([]);
  const [detail, setDetail] = useState<{
    decision: (GovernedDecisionRow & { caseTitle: string | null }) | null;
    options: GovernedDecisionOptionRow[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isDetail = caseId != null && caseId !== "demo";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isDetail && caseId) {
        setDetail(await getGovernedDecision(caseId));
      } else {
        setDecisions(await listGovernedDecisions());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [caseId, isDetail]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-center gap-2">
        <Scale className="h-5 w-5 text-signal-cyan" aria-hidden />
        <h1 className="text-lg font-bold text-white">Decision Workspace</h1>
      </div>
      <p className="max-w-3xl text-xs text-slate-400">
        The governed record: every decision here is a `decisions` row bound to a
        development case, its options are `scenarios` rows, and a selection is
        the audited human act recorded through the case workspace — localStorage
        is never a system of record.
      </p>

      <DraftBanner
        onImported={(decisionId) => navigate(`/decision-cases/${decisionId}`)}
      />

      {error && (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : isDetail ? (
        detail?.decision == null ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-400">
              No governed decision with this id exists in your organization. If
              this was an old local draft, it appears in the banner above when
              this browser still holds it.
            </p>
            <button
              onClick={() => navigate("/decision-cases")}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All decisions
            </button>
          </div>
        ) : (
          <div className="space-y-4 rounded-xl border border-white/6 bg-[#0D1520] p-5">
            <button
              onClick={() => navigate("/decision-cases")}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> All decisions
            </button>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                {detail.decision.decision_question ?? "Untitled decision"}
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                Case:{" "}
                <Link
                  to={`/develop/cases/${detail.decision.development_case_id}`}
                  className="text-signal-cyan underline decoration-dotted"
                >
                  {detail.decision.caseTitle ?? "open case workspace"}
                </Link>
                {" · "}Approval routing:{" "}
                {detail.decision.approval_level ?? "not stated"}
                {" · "}Required by:{" "}
                {detail.decision.decision_required_date ?? "no date"}
              </p>
            </div>
            {detail.decision.selected_at ? (
              <div className="flex items-start gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-3 py-2 text-xs text-emerald-200">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  Decided{" "}
                  {new Date(detail.decision.selected_at).toLocaleDateString()}.
                  Rationale: {detail.decision.selection_rationale}
                </span>
              </div>
            ) : (
              <p className="text-xs text-amber-300">
                Undecided — the selection act happens in the Case Workspace
                decision card (human-only, rationale mandatory).
              </p>
            )}
            <OptionsMatrix
              decision={detail.decision}
              options={detail.options}
            />
          </div>
        )
      ) : decisions.length === 0 ? (
        <div className="rounded-xl border border-white/6 bg-[#0D1520] p-6 text-sm text-slate-400">
          No governed decisions exist yet. Frame one in a Case Workspace
          (Decisions section) — it will appear here with its options matrix and
          approval routing.{" "}
          <Link to="/develop" className="text-signal-cyan underline">
            Open Develop
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {decisions.map((decision) => (
            <Link
              key={decision.id}
              to={`/decision-cases/${decision.id}`}
              className="block rounded-xl border border-white/6 bg-[#0D1520] px-4 py-3 hover:border-signal-cyan/30"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-slate-100">
                  {decision.decision_question ?? "Untitled decision"}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${decision.selected_at ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"}`}
                >
                  {decision.selected_at ? "decided" : "open"}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {decision.caseTitle ?? "—"} · approval:{" "}
                {decision.approval_level ?? "not stated"} · required:{" "}
                {decision.decision_required_date ?? "no date"}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
