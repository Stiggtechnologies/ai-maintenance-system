import { useMemo, useState } from "react";
import { Scale } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  SUBSTANTIVE_NOTE_CHARS,
  SYSTEM_KPI_EFFECTS,
  systemOptimizationBlockers,
  systemPageLabel,
  type SystemKpiEffect,
  type SystemKpiEffectDraft,
} from "../lib/optimization/system-kpis";
import {
  decideSystemKpiOptimization,
  getSystemKpiOptimizationWorkspace,
  proposeSystemKpiOptimization,
  type SystemKpiAssessment,
} from "../services/systemKpiOptimizationService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

interface PageDraft {
  kpiKey: string;
  effect: SystemKpiEffect | "";
  basis: string;
}

const EMPTY_PAGE: PageDraft = { kpiKey: "", effect: "", basis: "" };
const NO_PAGES: string[] = [];

export function SystemKpiOptimizationPanel() {
  const { data, loading, error, refetch } = useAsyncData(
    getSystemKpiOptimizationWorkspace,
    [],
  );
  const [intent, setIntent] = useState("");
  const [focalKpiKey, setFocalKpiKey] = useState("");
  const [focalBasis, setFocalBasis] = useState("");
  const [pageDrafts, setPageDrafts] = useState<Record<string, PageDraft>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notes, setNotes] = useState<
    Record<string, { note: string; escalation: string }>
  >({});

  const catalog = data?.catalog ?? [];
  const pages = data?.pages ?? NO_PAGES;
  const focal = catalog.find((row) => row.kpiKey === focalKpiKey) ?? null;
  const otherPages = pages.filter((page) => page !== focal?.page);

  const effects = useMemo(() => {
    const drafted: SystemKpiEffectDraft[] = [];
    if (focal && focalBasis.trim()) {
      drafted.push({
        kpiKey: focal.kpiKey,
        page: focal.page,
        effect: "improves",
        basis: focalBasis,
      });
    }
    for (const page of pages) {
      if (page === focal?.page) continue;
      const draft = pageDrafts[page];
      if (!draft?.kpiKey || !draft.effect) continue;
      drafted.push({
        kpiKey: draft.kpiKey,
        page,
        effect: draft.effect,
        basis: draft.basis,
      });
    }
    return drafted;
  }, [focal, focalBasis, pages, pageDrafts]);

  const blockers = focal
    ? systemOptimizationBlockers({
        pages,
        focalKpiKey: focal.kpiKey,
        focalPage: focal.page,
        intent,
        effects,
      })
    : ["Choose the KPI this proposal is trying to improve."];

  async function propose() {
    if (!focal || blockers.length > 0) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await proposeSystemKpiOptimization({
        focalKpiKey: focal.kpiKey,
        intent: intent.trim(),
        effects,
      });
      if (result.operationalAuthorization !== false) {
        throw new Error("The server returned an unexpected execution grant.");
      }
      setIntent("");
      setFocalBasis("");
      setPageDrafts({});
      refetch();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "Proposal refused.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function decide(
    assessment: SystemKpiAssessment,
    decision: "accepted" | "rejected",
  ) {
    const note = notes[assessment.id]?.note ?? "";
    const escalation = notes[assessment.id]?.escalation ?? "";
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await decideSystemKpiOptimization({
        optimizationId: assessment.id,
        decision,
        note,
        escalationNote: assessment.safetyKpiWorsens ? escalation : null,
      });
      if (result.operationalAuthorization !== false) {
        throw new Error("The server returned an unexpected execution grant.");
      }
      refetch();
    } catch (caught) {
      setFormError(
        caught instanceof Error ? caught.message : "Decision refused.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingState label="Loading system KPI optimization" />;
  if (error || !data)
    return (
      <ErrorState
        message={error ?? "Workspace unavailable"}
        onRetry={refetch}
      />
    );

  return (
    <section
      aria-labelledby="system-kpi-optimization-heading"
      className="rounded-2xl border border-white/6 bg-[#0D1520] p-6"
    >
      <h2
        id="system-kpi-optimization-heading"
        className="flex items-center gap-2 text-sm font-semibold text-slate-200"
      >
        <Scale className="h-4 w-4 text-teal-400" aria-hidden />
        Optimize the whole system, not a single KPI
      </h2>
      <p className="mt-2 max-w-3xl text-xs leading-relaxed text-slate-400">
        {data.boundary}
      </p>

      {catalog.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">
          No canonical KPIs are in the catalog. Nothing has been optimized.
        </p>
      ) : (
        <form
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void propose();
          }}
        >
          <label
            className="block text-xs text-slate-300"
            htmlFor="system-kpi-intent"
          >
            Optimization intent
            <textarea
              id="system-kpi-intent"
              value={intent}
              onChange={(event) => setIntent(event.target.value)}
              minLength={SUBSTANTIVE_NOTE_CHARS}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-sm text-slate-100"
            />
          </label>
          <label
            className="block text-xs text-slate-300"
            htmlFor="system-kpi-focal"
          >
            Focal KPI
            <select
              id="system-kpi-focal"
              value={focalKpiKey}
              onChange={(event) => setFocalKpiKey(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-sm text-slate-100"
            >
              <option value="">Select a catalog KPI</option>
              {catalog.map((row) => (
                <option key={row.kpiKey} value={row.kpiKey}>
                  {systemPageLabel(row.page)} — {row.name}
                </option>
              ))}
            </select>
          </label>
          {focal && (
            <label
              className="block text-xs text-slate-300"
              htmlFor="system-kpi-focal-basis"
            >
              Basis for judging {focal.name} as improves
              <textarea
                id="system-kpi-focal-basis"
                value={focalBasis}
                onChange={(event) => setFocalBasis(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-sm text-slate-100"
              />
            </label>
          )}
          {otherPages.map((page) => {
            const draft = pageDrafts[page] ?? EMPTY_PAGE;
            const choices = catalog.filter((row) => row.page === page);
            return (
              <fieldset
                key={page}
                className="rounded-xl border border-white/8 p-3"
              >
                <legend className="px-1 text-xs text-slate-300">
                  {systemPageLabel(page)} page
                </legend>
                <div className="grid gap-2 md:grid-cols-2">
                  <label
                    className="text-xs text-slate-400"
                    htmlFor={`kpi-${page}`}
                  >
                    KPI for {systemPageLabel(page)}
                    <select
                      id={`kpi-${page}`}
                      value={draft.kpiKey}
                      onChange={(event) =>
                        setPageDrafts((current) => ({
                          ...current,
                          [page]: { ...draft, kpiKey: event.target.value },
                        }))
                      }
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-sm text-slate-100"
                    >
                      <option value="">Select a KPI</option>
                      {choices.map((row) => (
                        <option key={row.kpiKey} value={row.kpiKey}>
                          {row.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label
                    className="text-xs text-slate-400"
                    htmlFor={`effect-${page}`}
                  >
                    Effect on {systemPageLabel(page)}
                    <select
                      id={`effect-${page}`}
                      value={draft.effect}
                      onChange={(event) =>
                        setPageDrafts((current) => ({
                          ...current,
                          [page]: {
                            ...draft,
                            effect: event.target.value as SystemKpiEffect | "",
                          },
                        }))
                      }
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-sm text-slate-100"
                    >
                      <option value="">Select an effect</option>
                      {SYSTEM_KPI_EFFECTS.map((value) => (
                        <option key={value} value={value}>
                          {systemPageLabel(value)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label
                  className="mt-2 block text-xs text-slate-400"
                  htmlFor={`basis-${page}`}
                >
                  Basis for {systemPageLabel(page)}
                  <textarea
                    id={`basis-${page}`}
                    value={draft.basis}
                    onChange={(event) =>
                      setPageDrafts((current) => ({
                        ...current,
                        [page]: { ...draft, basis: event.target.value },
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-sm text-slate-100"
                  />
                </label>
              </fieldset>
            );
          })}
          {blockers.length > 0 && (
            <ul className="space-y-1 text-xs text-amber-200">
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
          {formError && (
            <p role="alert" className="text-sm text-amber-200">
              {formError}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting || blockers.length > 0}
            className="rounded-lg bg-teal-400 px-3 py-2 text-sm font-medium text-slate-950 disabled:opacity-40"
          >
            Propose system assessment
          </button>
        </form>
      )}

      <div className="mt-6 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Recorded assessments
        </h3>
        {data.assessments.length === 0 ? (
          <p className="text-sm text-slate-400">
            No system assessment has been recorded for this organization.
          </p>
        ) : (
          data.assessments.map((assessment) => (
            <article
              key={assessment.id}
              className="rounded-xl border border-white/8 p-3"
            >
              <p className="text-sm text-slate-200">
                {assessment.focalKpiKey} · {assessment.status}
                {assessment.safetyKpiWorsens
                  ? " · safety or risk KPI worsens"
                  : ""}
              </p>
              <p className="mt-1 text-xs text-slate-400">{assessment.intent}</p>
              <ul className="mt-2 space-y-1 text-xs text-slate-300">
                {assessment.effects.map((effect) => (
                  <li key={`${assessment.id}-${effect.kpiKey}`}>
                    {systemPageLabel(effect.page)} / {effect.kpiKey}:{" "}
                    {effect.effect}. {effect.basis}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-500">
                This assessment does not authorize work, risk acceptance, spend,
                an operating limit, or return to service.
              </p>
              {assessment.status === "proposed" && (
                <div className="mt-3 space-y-2">
                  <label
                    className="block text-xs text-slate-400"
                    htmlFor={`note-${assessment.id}`}
                  >
                    Decision note
                    <textarea
                      id={`note-${assessment.id}`}
                      value={notes[assessment.id]?.note ?? ""}
                      onChange={(event) =>
                        setNotes((current) => ({
                          ...current,
                          [assessment.id]: {
                            note: event.target.value,
                            escalation:
                              current[assessment.id]?.escalation ?? "",
                          },
                        }))
                      }
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-sm text-slate-100"
                    />
                  </label>
                  {assessment.safetyKpiWorsens && (
                    <label
                      className="block text-xs text-slate-400"
                      htmlFor={`escalation-${assessment.id}`}
                    >
                      Escalation note for the worsening safety or risk KPI
                      <textarea
                        id={`escalation-${assessment.id}`}
                        value={notes[assessment.id]?.escalation ?? ""}
                        onChange={(event) =>
                          setNotes((current) => ({
                            ...current,
                            [assessment.id]: {
                              note: current[assessment.id]?.note ?? "",
                              escalation: event.target.value,
                            },
                          }))
                        }
                        className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 p-2 text-sm text-slate-100"
                      />
                    </label>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void decide(assessment, "accepted")}
                      className="rounded-lg border border-teal-400/40 px-3 py-1.5 text-xs text-teal-200"
                    >
                      Accept system assessment
                    </button>
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={() => void decide(assessment, "rejected")}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
