import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  CircleAlert,
  Database,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  loadReliabilityLifeData,
  recordComponentLifeEvent,
  runReliabilityLifeDataAgent,
  type LifeDataRunReceipt,
} from "../services/reliabilityLifeDataService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";
import { CovariateSurvivalWorkbench } from "./CovariateSurvivalWorkbench";

const today = new Date().toISOString().slice(0, 10);

function numberOrNull(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ReliabilityLifeDataWorkbench() {
  const { data, loading, error, refetch } = useAsyncData(
    loadReliabilityLifeData,
    [],
    { isEmpty: () => false },
  );
  const [component, setComponent] = useState("");
  const [assetId, setAssetId] = useState("");
  const [hours, setHours] = useState("");
  const [eventKind, setEventKind] = useState<"failure" | "scheduled" | "other">(
    "failure",
  );
  const [eventDate, setEventDate] = useState(today);
  const [plannedInterval, setPlannedInterval] = useState("");
  const [symptom, setSymptom] = useState("");
  const [workOrderRef, setWorkOrderRef] = useState("");
  const [sourceReference, setSourceReference] = useState("manual field entry");
  const [evidenceBasis, setEvidenceBasis] = useState("");
  const [showCapture, setShowCapture] = useState(false);
  const [showSurvival, setShowSurvival] = useState(false);
  const [busy, setBusy] = useState<"capture" | "run" | null>(null);
  const [notice, setNotice] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const [receipt, setReceipt] = useState<LifeDataRunReceipt | null>(null);

  useEffect(() => {
    if (!component && data?.groups[0]?.component)
      setComponent(data.groups[0].component);
    if (!assetId && data?.assets[0]?.id) setAssetId(data.assets[0].id);
  }, [assetId, component, data]);

  const group = useMemo(
    () =>
      data?.groups.find(
        (entry) => entry.component.toLowerCase() === component.toLowerCase(),
      ) ?? null,
    [component, data?.groups],
  );
  const latestReport = useMemo(
    () =>
      data?.reports.find(
        (entry) => entry.component.toLowerCase() === component.toLowerCase(),
      ) ?? null,
    [component, data?.reports],
  );
  const method = receipt?.method_selection ?? latestReport?.methodSelection;

  async function runAgent() {
    if (!component.trim()) return;
    setBusy("run");
    setNotice(null);
    try {
      const next = await runReliabilityLifeDataAgent(component);
      setReceipt(next);
      setNotice({
        kind: "success",
        text: `Retained advisory report ${next.report_id.slice(0, 8)} created from ${next.source_event_ids.length} exact source events.`,
      });
      refetch();
    } catch (runError) {
      setNotice({
        kind: "error",
        text:
          runError instanceof Error
            ? runError.message
            : "Reliability analysis failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function captureEvent(event: React.FormEvent) {
    event.preventDefault();
    setBusy("capture");
    setNotice(null);
    try {
      const eventId = await recordComponentLifeEvent({
        assetId,
        component: component.trim(),
        hoursAtChangeOut: Number(hours),
        eventKind,
        eventDate,
        plannedIntervalHours: numberOrNull(plannedInterval),
        symptom,
        workOrderRef,
        sourceReference,
        evidenceBasis,
      });
      setNotice({
        kind: "success",
        text: `Life event ${eventId} recorded. Run the agent to create a new dated reading.`,
      });
      setHours("");
      setSymptom("");
      setWorkOrderRef("");
      setEvidenceBasis("");
      setReceipt(null);
      refetch();
    } catch (captureError) {
      setNotice({
        kind: "error",
        text:
          captureError instanceof Error
            ? captureError.message
            : "Life-event capture failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data)
    return <LoadingState label="Loading governed component life data" />;
  if (error && !data) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <section
      aria-labelledby="life-data-heading"
      className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#09131d] shadow-[0_24px_80px_rgba(0,0,0,0.2)]"
    >
      <div className="border-b border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_45%)] p-5 lg:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
              <Bot className="h-4 w-4" aria-hidden /> Reliability Engineer agent
            </div>
            <h2
              id="life-data-heading"
              className="text-xl font-semibold text-white"
            >
              Governed component life-data workbench
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Capture operating-hour evidence, keep scheduled working removals
              right-censored, and run the pinned estimator over the complete
              tenant component population. Every reading is retained with its
              exact source-event set and control profile.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowCapture((value) => !value)}
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-200 hover:bg-white/10"
            >
              <Plus className="h-4 w-4" aria-hidden /> Record evidence
            </button>
            <button
              type="button"
              disabled={!component.trim() || busy !== null}
              onClick={runAgent}
              className="inline-flex items-center gap-2 rounded-lg bg-cyan-300 px-3 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Activity className="h-4 w-4" aria-hidden />
              {busy === "run" ? "Running…" : "Run governed analysis"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)] lg:p-6">
        <div className="space-y-4">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Component population
            <input
              list="life-data-components"
              value={component}
              onChange={(event) => {
                setComponent(event.target.value);
                setReceipt(null);
              }}
              placeholder="e.g. final drive"
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm normal-case tracking-normal text-white outline-hidden focus:border-cyan-400/60"
            />
          </label>
          <datalist id="life-data-components">
            {(data?.groups ?? []).map((entry) => (
              <option key={entry.component} value={entry.component} />
            ))}
          </datalist>

          {group ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Failures", group.failureHours.length],
                  ["Right-censored", group.censoredHours.length],
                  ["Other excluded", group.otherHours.length],
                  ["Units", group.units],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-xl border border-white/8 bg-white/[0.025] p-3"
                  >
                    <div className="text-2xl font-semibold text-white">
                      {value}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">{label}</div>
                  </div>
                ))}
              </div>
              <p className="rounded-lg border border-white/7 bg-black/15 p-3 text-xs leading-5 text-slate-400">
                <Database className="mr-1.5 inline h-3.5 w-3.5 text-cyan-400" />
                {group.basis}
              </p>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-white/12 p-5 text-sm text-slate-400">
              No events are recorded for this component yet. Record named,
              sourced exposure evidence before requesting a model.
            </div>
          )}
        </div>

        <div className="rounded-xl border border-white/8 bg-black/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-white">
              Latest retained reading
            </h3>
            {method && (
              <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-2 py-1 text-xs font-semibold text-cyan-300">
                {method.method.replaceAll("_", " ")}
              </span>
            )}
          </div>
          {method ? (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-xs text-slate-500">Beta</div>
                  <div className="font-mono text-slate-100">
                    {method.beta == null
                      ? "Not identified"
                      : method.beta.toFixed(3)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Eta</div>
                  <div className="font-mono text-slate-100">
                    {method.eta == null
                      ? "Not identified"
                      : `${method.eta.toFixed(0)} h`}
                  </div>
                </div>
              </div>
              <div className="text-xs leading-5 text-slate-300">
                <span className="font-semibold text-slate-200">Rule: </span>
                {method.ruleApplied}
              </div>
              <p className="text-xs leading-5 text-slate-400">
                {method.reason}
              </p>
              {method.modelWarning && (
                <div className="rounded-lg border border-amber-400/20 bg-amber-400/8 p-3 text-xs leading-5 text-amber-200">
                  <CircleAlert className="mr-1.5 inline h-4 w-4" />
                  {method.modelWarning}
                </div>
              )}
            </div>
          ) : (
            <p className="mt-4 text-sm leading-6 text-slate-400">
              No governed reading exists for this component. The agent will
              refuse a fit when fewer than two distinct failure exposures make
              Weibull shape unidentifiable.
            </p>
          )}
          <div className="mt-4 flex gap-2 border-t border-white/8 pt-4 text-xs leading-5 text-slate-400">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            Advisory only. This agent cannot change a PM interval, create or
            release work, approve strategy, accept risk, commit spend, or return
            equipment to service.
          </div>
        </div>
      </div>

      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`mx-5 mb-5 rounded-lg border px-3 py-2 text-sm lg:mx-6 lg:mb-6 ${
            notice.kind === "error"
              ? "border-red-400/25 bg-red-400/8 text-red-200"
              : "border-emerald-400/25 bg-emerald-400/8 text-emerald-200"
          }`}
        >
          {notice.text}
        </div>
      )}

      {showCapture && (
        <form
          onSubmit={captureEvent}
          className="border-t border-white/8 bg-black/15 p-5 lg:p-6"
        >
          <div className="mb-4">
            <h3 className="font-semibold text-white">
              Record named life evidence
            </h3>
            <p className="mt-1 text-xs text-slate-400">
              Reliability Engineer or administrator only. A scheduled removal
              means the component was still working and will be retained as a
              right-censored observation.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-xs text-slate-400">
              Asset
              <select
                required
                value={assetId}
                onChange={(event) => setAssetId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b1620] px-3 py-2 text-sm text-white"
              >
                <option value="">Select asset</option>
                {(data?.assets ?? []).map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.asset_tag ? `${asset.asset_tag} · ` : ""}
                    {asset.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Event classification
              <select
                value={eventKind}
                onChange={(event) =>
                  setEventKind(
                    event.target.value as "failure" | "scheduled" | "other",
                  )
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b1620] px-3 py-2 text-sm text-white"
              >
                <option value="failure">Failed in service</option>
                <option value="scheduled">Scheduled, still working</option>
                <option value="other">Other — exclude from fit</option>
              </select>
            </label>
            <label className="text-xs text-slate-400">
              Operating hours at removal
              <input
                required
                type="number"
                min="0.001"
                step="any"
                value={hours}
                onChange={(event) => setHours(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b1620] px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs text-slate-400">
              Event date
              <input
                required
                type="date"
                max={today}
                value={eventDate}
                onChange={(event) => setEventDate(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b1620] px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs text-slate-400">
              Planned interval hours
              <input
                type="number"
                min="0.001"
                step="any"
                value={plannedInterval}
                onChange={(event) => setPlannedInterval(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b1620] px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs text-slate-400">
              Work-order reference
              <input
                value={workOrderRef}
                onChange={(event) => setWorkOrderRef(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b1620] px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs text-slate-400">
              Source reference
              <input
                required
                value={sourceReference}
                onChange={(event) => setSourceReference(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b1620] px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs text-slate-400">
              Symptom / removal observation
              <input
                value={symptom}
                onChange={(event) => setSymptom(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b1620] px-3 py-2 text-sm text-white"
              />
            </label>
          </div>
          <label className="mt-3 block text-xs text-slate-400">
            Evidence basis
            <textarea
              required
              minLength={10}
              rows={2}
              value={evidenceBasis}
              onChange={(event) => setEvidenceBasis(event.target.value)}
              placeholder="Who verified the meter and removal classification, and from which source?"
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#0b1620] px-3 py-2 text-sm text-white"
            />
          </label>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Recording evidence does not run the model or change maintenance
              policy.
            </p>
            <button
              type="submit"
              disabled={busy !== null || !assetId || !component.trim()}
              className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
            >
              {busy === "capture" ? "Recording…" : "Record life event"}
            </button>
          </div>
        </form>
      )}
      <div className="border-t border-white/10 px-5 py-4">
        <button
          type="button"
          onClick={() => setShowSurvival((value) => !value)}
          disabled={!component.trim()}
          aria-expanded={showSurvival}
          className="rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-sm text-cyan-200 disabled:opacity-40"
        >
          {showSurvival
            ? "Close covariate survival workbench"
            : "Open covariate survival workbench"}
        </button>
      </div>
      {showSurvival && component.trim() && (
        <CovariateSurvivalWorkbench
          key={component.trim().toLowerCase()}
          component={component.trim()}
        />
      )}
    </section>
  );
}
