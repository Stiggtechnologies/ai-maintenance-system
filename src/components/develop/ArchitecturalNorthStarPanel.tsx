import { useCallback, useEffect, useMemo, useState } from "react";
import { Route } from "lucide-react";
import {
  getCaseArchitecturalNorthStar,
  linkCaseLearningToNextDecision,
  type ArchitecturalNorthStar,
} from "../../services/architecturalNorthStarService";

const field =
  "rounded-lg border border-white/10 bg-[#09111B] px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-400/40";

export function ArchitecturalNorthStarPanel({
  caseId,
  canLink,
}: {
  caseId: string;
  canLink: boolean;
}) {
  const [model, setModel] = useState<ArchitecturalNorthStar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcomeId, setOutcomeId] = useState("");
  const [lessonId, setLessonId] = useState("");
  const [decisionId, setDecisionId] = useState("");
  const [basis, setBasis] = useState("");
  const outcome = useMemo(
    () => model?.outcomes.find((item) => item.id === outcomeId),
    [model, outcomeId],
  );
  const load = useCallback(async () => {
    try {
      setModel(await getCaseArchitecturalNorthStar(caseId));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [caseId]);
  useEffect(() => void load(), [load]);

  async function link() {
    if (!outcome || !lessonId || !decisionId) return;
    setBusy(true);
    setError(null);
    try {
      await linkCaseLearningToNextDecision({
        caseId,
        outcomeEventId: outcome.id,
        lessonEventId: lessonId,
        nextDecisionId: decisionId,
        evidenceItemId: outcome.evidenceItemId,
        basis,
      });
      setBasis("");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
      <div className="flex items-start gap-3">
        <Route className="mt-0.5 h-4 w-4 text-signal-cyan" />
        <div>
          <h2 className="text-sm font-semibold text-white">
            Architectural north star (§86)
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            One governed path from the objective through delivery and operation
            to verified learning and the next human decision.
          </p>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-xs text-rose-300">
          {error}
        </p>
      )}
      {model && (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            {model.legs.map((leg, index) => (
              <div key={leg.key} className="flex items-center gap-2">
                <div
                  className={`rounded-lg border px-2.5 py-2 text-[11px] ${leg.complete ? "border-emerald-400/25 bg-emerald-400/8 text-emerald-200" : "border-amber-400/25 bg-amber-400/8 text-amber-200"}`}
                >
                  <span className="font-semibold">{leg.label}</span>
                  <span className="ml-1 text-slate-400">{leg.count}</span>
                </div>
                {index < model.legs.length - 1 && (
                  <span className="text-slate-600">→</span>
                )}
              </div>
            ))}
          </div>
          <p
            className={`mt-3 text-xs font-semibold ${model.complete ? "text-emerald-300" : "text-amber-200"}`}
          >
            {model.complete
              ? "Complete canonical traversal — evidence visible end to end."
              : `${model.gaps.length} missing leg${model.gaps.length === 1 ? "" : "s"}: ${model.gaps.join("; ")}`}
          </p>
          {canLink && model.learningDecisionLinks.length === 0 && (
            <div className="mt-4 grid gap-2 rounded-lg border border-white/8 p-3 lg:grid-cols-2">
              <select
                aria-label="Verified project outcome"
                className={field}
                value={outcomeId}
                onChange={(event) => setOutcomeId(event.target.value)}
              >
                <option value="">Verified outcome…</option>
                {model.outcomes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
              <select
                aria-label="Project lesson"
                className={field}
                value={lessonId}
                onChange={(event) => setLessonId(event.target.value)}
              >
                <option value="">Project lesson…</option>
                {model.lessons.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
              <select
                aria-label="Next decision"
                className={field}
                value={decisionId}
                onChange={(event) => setDecisionId(event.target.value)}
              >
                <option value="">Later decision…</option>
                {model.candidateNextDecisions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.caseTitle} · {item.question}
                  </option>
                ))}
              </select>
              <input
                className={field}
                value={basis}
                onChange={(event) => setBasis(event.target.value)}
                placeholder="How the verified outcome and lesson inform this decision (20+ characters)"
              />
              <button
                className="rounded-lg bg-cyan-400/15 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40 lg:col-span-2"
                disabled={
                  busy ||
                  !outcomeId ||
                  !lessonId ||
                  !decisionId ||
                  basis.trim().length < 20
                }
                onClick={() => void link()}
              >
                {busy ? "Recording…" : "Link learning to next decision"}
              </button>
            </div>
          )}
          <p className="mt-4 text-[11px] text-slate-500">
            {model.decisionBoundary}
          </p>
        </>
      )}
    </section>
  );
}
