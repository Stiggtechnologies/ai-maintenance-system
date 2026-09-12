import { useMemo, useState } from "react";
import { CheckCircle2, Compass, ShieldCheck } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  authorMissionOutcomeModel,
  decideMissionOutcomeModel,
  getMissionOutcomeWorkspace,
} from "../services/missionOutcomeModels";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-industrial-black px-3 py-2 text-sm text-slate-200";
const actionClass =
  "rounded-lg border border-signal-cyan/35 bg-signal-cyan/10 px-3 py-1.5 text-sm font-medium text-signal-cyan disabled:opacity-40";

function names(items: Array<{ name: string }>) {
  return items.map((item) => item.name).join(" · ");
}

export function MissionOutcomeModels() {
  const workspace = useAsyncData(getMissionOutcomeWorkspace, []);
  const [type, setType] = useState("");
  const [title, setTitle] = useState("");
  const [mission, setMission] = useState("");
  const [evidence, setEvidence] = useState("");
  const [applicability, setApplicability] = useState("");
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const template = useMemo(
    () => workspace.data?.templates.find((item) => item.organizationType === type),
    [type, workspace.data],
  );
  const adopted = workspace.data?.models.find((model) => model.status === "adopted");

  if (workspace.loading)
    return <LoadingState label="Loading mission and outcome models" />;
  if (workspace.error)
    return <ErrorState message={workspace.error} onRetry={workspace.refetch} />;

  const selectTemplate = (value: string) => {
    const next = workspace.data?.templates.find(
      (item) => item.organizationType === value,
    );
    setType(value);
    setTitle(next?.title ?? "");
    setMission(next?.missionPattern ?? "");
  };

  const run = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await work();
      setMessage(success);
      setReviewing(null);
      setReviewNote("");
      await workspace.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const draft = async () => {
    if (!template) return;
    await run(
      () =>
        authorMissionOutcomeModel({
          template,
          title,
          missionStatement: mission,
          evidenceBasis: evidence,
          applicabilityNotes: applicability,
        }),
      "Draft captured and held for an independent human decision.",
    );
  };

  return (
    <section aria-labelledby="mission-outcome-heading" className="space-y-5">
      <div>
        <h2
          id="mission-outcome-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Compass className="h-5 w-5 text-signal-cyan" aria-hidden />
          Mission and service outcomes
        </h2>
        <p className="mt-1 text-sm text-slate-300">
          Define what reliability must protect for this organization before
          prioritizing assets, risks, work or investment.
        </p>
        <p className="mt-2 rounded-xl border border-white/8 bg-industrial-black/60 px-4 py-3 text-xs text-slate-400">
          {workspace.data?.control}
        </p>
      </div>

      {message && (
        <p className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-sm text-slate-200">
          {message}
        </p>
      )}

      {adopted ? (
        <article className="rounded-xl border border-green-500/25 bg-green-500/8 p-4">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-green-300">
            <CheckCircle2 className="h-4 w-4" /> Adopted organization model · v{adopted.version}
          </p>
          <h3 className="mt-2 text-base font-semibold text-white">{adopted.title}</h3>
          <p className="mt-2 text-sm text-slate-200">{adopted.missionStatement}</p>
          <p className="mt-3 text-xs text-slate-400">Outcomes: {names(adopted.outcomes)}</p>
          <p className="mt-1 text-xs text-slate-400">Measures: {names(adopted.measures)}</p>
        </article>
      ) : (
        <p className="rounded-xl border border-amber-500/25 bg-amber-500/8 p-4 text-sm text-amber-200">
          No organization-owned mission model is adopted. Template defaults are
          not authority.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-3 rounded-xl border border-white/8 bg-overlook-deep/40 p-4">
          <h3 className="text-sm font-semibold text-slate-200">Prepare a governed draft</h3>
          <select
            aria-label="Organization type"
            className={inputClass}
            value={type}
            onChange={(event) => selectTemplate(event.target.value)}
          >
            <option value="">Select organization type</option>
            {(workspace.data?.templates ?? []).map((item) => (
              <option key={item.organizationType} value={item.organizationType}>
                {item.title}
              </option>
            ))}
          </select>
          <input aria-label="Model title" className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Model title" />
          <textarea aria-label="Mission statement" className={inputClass} rows={3} value={mission} onChange={(event) => setMission(event.target.value)} placeholder="Organization mission or service promise" />
          <textarea aria-label="Evidence basis" className={inputClass} rows={3} value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="Organization policy, charter, service commitments and source references" />
          <textarea aria-label="Applicability and limitations" className={inputClass} rows={3} value={applicability} onChange={(event) => setApplicability(event.target.value)} placeholder="Where this applies, exclusions, jurisdiction and review conditions" />
          <button className={actionClass} disabled={!template || busy} onClick={draft}>
            Submit for independent adoption
          </button>
        </div>

        <div className="space-y-3 rounded-xl border border-white/8 bg-overlook-deep/40 p-4">
          <h3 className="text-sm font-semibold text-slate-200">Template preview</h3>
          {template ? (
            <>
              <p className="text-sm text-slate-300">{template.missionPattern}</p>
              <div>
                <p className="text-xs font-medium text-slate-300">Outcomes</p>
                <p className="mt-1 text-xs text-slate-400">{names(template.outcomes)}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-300">Measures</p>
                <p className="mt-1 text-xs text-slate-400">{names(template.measures)}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-300">Consequences to protect</p>
                <p className="mt-1 text-xs text-slate-400">{template.consequenceDimensions.join(" · ")}</p>
              </div>
              <p className="flex gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> {template.limitations}
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500">Choose a type to inspect its outcomes, measures and limitations.</p>
          )}
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-200">Adoption queue and history</h3>
        {(workspace.data?.models ?? []).map((model) => (
          <article key={model.id} className="rounded-xl border border-white/8 bg-overlook-deep/40 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">v{model.version} · {model.title}</p>
                <p className="mt-1 text-xs text-slate-400">{model.organizationType.replaceAll("_", " ")} · {model.status} · authored by {model.createdBy ?? "named user"}</p>
              </div>
              {model.status === "draft" && workspace.data?.canApprove && !model.isOwnDraft && (
                <button className={actionClass} onClick={() => setReviewing(model.id)}>Review</button>
              )}
            </div>
            <p className="mt-3 text-sm text-slate-300">{model.missionStatement}</p>
            {reviewing === model.id && (
              <div className="mt-3 space-y-2">
                <textarea aria-label={`Decision basis for version ${model.version}`} className={inputClass} rows={2} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Independent decision basis (minimum 20 characters)" />
                <div className="flex gap-2">
                  <button className={actionClass} disabled={busy || reviewNote.trim().length < 20} onClick={() => run(() => decideMissionOutcomeModel(model.id, "approved", reviewNote), "Mission/outcome model adopted.")}>Adopt</button>
                  <button className="rounded-lg border border-red-400/30 px-3 py-1.5 text-sm text-red-300 disabled:opacity-40" disabled={busy || reviewNote.trim().length < 20} onClick={() => run(() => decideMissionOutcomeModel(model.id, "rejected", reviewNote), "Mission/outcome model rejected.")}>Reject</button>
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
