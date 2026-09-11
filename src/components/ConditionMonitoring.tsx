/**
 * ConditionMonitoring — coverage, live alerts, warning lead time, PM task
 * effectiveness and P-F intervals
 * (capability register C2.05, C6.24, C6.25).
 *
 * The sensors table stored only last_value, so there was no history — and
 * without history a trend is decoration, an alert cannot be edge-triggered,
 * and "how much warning did we get?" has no answer at all. Alerts now record a
 * CROSSING rather than a state, which is precisely what makes lead time
 * measurable.
 *
 * P-F intervals are shown as declared engineering reference data with their
 * basis, not as something the platform inferred. An invented interval sitting
 * underneath an inspection frequency is an invented safety margin.
 */
import { useState } from "react";
import { Radar, Bell, Ruler, Radio } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import { LoadingState, ErrorState } from "./ui/AsyncStates";
import {
  adoptPfInterval,
  canAdoptPfInterval,
  deriveObservedPf,
  linkAlertToWork,
  listOpenWorkOrders,
  listPfIntervals,
  type ObservedPfResult,
  type OpenWorkOrderOption,
  type PfIntervalRow,
} from "../services/reliabilityCallers";
import { plantHistorianActions } from "../services/plantHistorian";
import type { PlantHistorianStatus } from "../lib/plant-historian";

interface Alert {
  id: string;
  asset: string | null;
  sensor: string;
  severity: "warning" | "alarm";
  value: number;
  limit: number;
  triggered_at: string;
  hours_open: number;
  acknowledged: boolean;
  linked_work_order: boolean;
}

interface Payload {
  coverage: {
    assets: number;
    monitored_assets: number;
    coverage_pct: number | null;
    critical_assets: number;
    critical_monitored: number;
    critical_coverage_pct: number | null;
    readings: number;
    basis: string;
  };
  active_alerts: Alert[];
  warning_lead_time: {
    available: boolean;
    value: number | null;
    unit: string;
    sample: number;
    basis: string;
  };
  pm_task_effectiveness: {
    available: boolean;
    recordedOutcomes: number;
    matureOutcomes: number;
    findingRatePct: number | null;
    postPmFailureRatePct: number | null;
    falseReassuranceRatePct: number | null;
    basis: string;
  };
  pf_note: string;
}

export function ConditionMonitoring() {
  const { profile } = useAuth();
  const canAdopt = canAdoptPfInterval(profile?.role as string | undefined);
  const { data, loading, error, refetch } = useAsyncData<Payload>(async () => {
    const [monitoring, effectiveness] = await Promise.all([
      supabase.rpc("get_condition_monitoring", {}),
      supabase.rpc("get_pm_task_effectiveness", { p_observation_days: 30 }),
    ]);
    if (monitoring.error) throw new Error(monitoring.error.message);
    if (effectiveness.error) throw new Error(effectiveness.error.message);
    const pm = effectiveness.data as Payload["pm_task_effectiveness"] & { error?: string };
    if (pm.error) throw new Error(pm.error);
    return { ...(monitoring.data as Payload), pm_task_effectiveness: pm };
  }, []);
  const intervals = useAsyncData<PfIntervalRow[]>(listPfIntervals, []);
  const openWork = useAsyncData<OpenWorkOrderOption[]>(listOpenWorkOrders, []);
  const observedPf = useAsyncData<ObservedPfResult>(deriveObservedPf, []);
  const plant = useAsyncData<PlantHistorianStatus>(
    plantHistorianActions.status,
    [],
  );
  const [citing, setCiting] = useState<string | null>(null);
  const [adopting, setAdopting] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState<Record<string, string>>({});
  const [days, setDays] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  if (loading) return <LoadingState label="Loading condition monitoring" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const cov = data?.coverage;
  const alerts = data?.active_alerts ?? [];
  const lead = data?.warning_lead_time;
  const pm = data?.pm_task_effectiveness;
  const pf = intervals.data ?? [];
  const alarms = alerts.filter((a) => a.severity === "alarm").length;

  return (
    <section aria-labelledby="cm-heading" className="space-y-4">
      <div>
        <h2
          id="cm-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Radar className="h-5 w-5 text-signal-cyan" aria-hidden />
          Condition Monitoring
          <span className="text-xs font-normal text-slate-500">
            {cov?.monitored_assets}/{cov?.assets} assets ·{" "}
            {cov?.readings?.toLocaleString()} readings
          </span>
        </h2>
        <p className="mt-1 text-sm text-slate-300">{cov?.basis}</p>
      </div>

      <PlantHistorianEvidence
        status={plant.data}
        loading={plant.loading}
        error={plant.error}
        onRetry={plant.refetch}
        citing={citing}
        onCite={async (id) => {
          setCiting(id);
          setFlash(null);
          try {
            const result = await plantHistorianActions.attachEvidence(id);
            setFlash(String(result.note ?? "Historian evidence attached."));
            await plant.refetch();
          } catch (caught) {
            setFlash((caught as Error).message);
          } finally {
            setCiting(null);
          }
        }}
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Critical-asset coverage
          </p>
          <p className="mt-1 font-mono text-2xl text-slate-100">
            {cov?.critical_coverage_pct ?? "—"}
            <span className="ml-0.5 text-sm text-slate-500">%</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {cov?.critical_monitored} of {cov?.critical_assets} critical assets
            instrumented
          </p>
        </div>

        <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Warning lead time
          </p>
          <p className="mt-1 font-mono text-2xl text-slate-100">
            {lead?.available ? lead.value : "—"}
            {lead?.available && (
              <span className="ml-0.5 text-sm text-slate-500"> h</span>
            )}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {lead?.available
              ? `Over ${lead.sample} alerts linked to work`
              : "Not measurable yet — no linked alerts"}
          </p>
        </div>

        <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            PM finding rate
          </p>
          <p className="mt-1 font-mono text-2xl text-slate-100">
            {pm?.findingRatePct ?? "—"}
            <span className="ml-0.5 text-sm text-slate-500">%</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Direct findings from {pm?.recordedOutcomes?.toLocaleString()} PM outcomes
          </p>
        </div>

        <div className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            Post-PM corrective recurrence
          </p>
          <p
            className={`mt-1 font-mono text-2xl ${(pm?.postPmFailureRatePct ?? 0) > 25 ? "text-amber-300" : "text-slate-100"}`}
          >
            {pm?.postPmFailureRatePct ?? "—"}
            <span className="ml-0.5 text-sm text-slate-500">%</span>
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Same coded mechanism raised within 30 days · {pm?.matureOutcomes ?? 0} mature PM(s)
          </p>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-slate-500">
        {pm?.basis}
        {pm?.falseReassuranceRatePct != null && ` Corrective-recurrence rate among mature no-finding PMs: ${pm.falseReassuranceRatePct}%.`}
      </p>
      {!lead?.available && (
        <p className="rounded-xl border border-white/6 bg-white/2 p-3 text-xs leading-relaxed text-slate-400">
          {lead?.basis}
        </p>
      )}

      <div className="pt-1">
        <h3 className="flex items-center gap-2 text-base font-semibold text-white">
          <Bell className="h-4.5 w-4.5 text-signal-gold" aria-hidden />
          Open alerts
          <span className="text-xs font-normal text-slate-500">
            {alerts.length}
            {alarms > 0 && ` · ${alarms} at alarm`}
          </span>
        </h3>
      </div>

      {alerts.length === 0 ? (
        <p className="rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-400">
          No open condition alerts. Alerts are raised on a limit{" "}
          <em>crossing</em> and closed when the signal returns inside limits —
          the record of the crossing is kept, because that is what warning lead
          time is measured from.
        </p>
      ) : (
        <ul className="space-y-2">
          {alerts.map((a) => (
            <li
              key={a.id}
              className={`rounded-xl border p-3.5 ${
                a.severity === "alarm"
                  ? "border-red-500/30 bg-red-500/5"
                  : "border-amber-500/25 bg-amber-500/5"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm text-slate-200">
                  {a.asset ?? "Unassigned asset"}{" "}
                  <span className="text-slate-500">· {a.sensor}</span>
                </p>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    a.severity === "alarm"
                      ? "border-red-500/30 text-red-300"
                      : "border-amber-500/30 text-amber-300"
                  }`}
                >
                  {a.severity}
                </span>
              </div>
              <p className="mt-1 font-mono text-xs text-slate-400 tabular-nums">
                {a.value} vs limit {a.limit} · open {a.hours_open} h
              </p>
              {a.linked_work_order ? (
                <p className="mt-1 text-xs text-slate-500">
                  Linked to work — this alert is in the lead-time sample.
                </p>
              ) : (
                <div className="mt-2 space-y-1.5">
                  <p className="text-xs text-slate-500">
                    Not yet linked to work — lead time counts only linked
                    alerts. Linking records the reason; it does not authorize
                    the work.
                  </p>
                  {(openWork.data ?? []).length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No open work order to link. Create or import work first
                      (CMMS read activation is not a substitute for this link).
                    </p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label={`Work order for ${a.sensor}`}
                        value={linkDraft[a.id] ?? ""}
                        onChange={(e) =>
                          setLinkDraft((d) => ({
                            ...d,
                            [a.id]: e.target.value,
                          }))
                        }
                        className="min-w-52 rounded-lg border border-white/10 bg-industrial-black px-2 py-1.5 text-xs text-slate-200"
                      >
                        <option value="">Select open work order…</option>
                        {(openWork.data ?? []).map((wo) => (
                          <option key={wo.id} value={wo.id}>
                            {wo.wo_number ?? wo.id} — {wo.title}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={busy || !linkDraft[a.id]}
                        onClick={async () => {
                          const woId = linkDraft[a.id];
                          if (!woId) return;
                          setBusy(true);
                          setFlash(null);
                          try {
                            await linkAlertToWork(a.id, woId);
                            setFlash(
                              "Alert linked to work. Lead time now includes this pair. This is not work authorization.",
                            );
                            await refetch();
                          } catch (err) {
                            setFlash(
                              err instanceof Error
                                ? err.message
                                : "That did not work.",
                            );
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className="rounded-lg border border-signal-cyan/40 px-2.5 py-1 text-xs text-signal-cyan disabled:opacity-40"
                      >
                        Link to work
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="pt-1">
        <h3 className="flex items-center gap-2 text-base font-semibold text-white">
          <Ruler className="h-4.5 w-4.5 text-slate-300" aria-hidden />
          P-F intervals
          <span className="text-xs font-normal text-slate-500">
            {pf.length} declared
          </span>
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          {data?.pf_note}
        </p>
        <p
          data-testid="observed-pf"
          className="mt-2 rounded-xl border border-white/8 bg-industrial-black/60 px-4 py-3 text-xs text-slate-400"
        >
          {observedPf.data?.available
            ? `Observed P-F from this organization's linked alert-to-work history (${observedPf.data.observed.length} technique(s)). The minimum observed interval is the safe basis — the mean would leave half the population undetected.`
            : (observedPf.data?.basis ??
              "Observed P-F is derived from linked alerts only. Until that history exists, intervals stay declared engineering values, never inferred from a thin sample.")}
        </p>
        {observedPf.data?.available && (
          <ul className="mt-2 space-y-1 text-xs text-slate-400">
            {observedPf.data.observed.map((row) => (
              <li key={row.technique}>
                {row.technique}: min {row.observed_pf_days_min} d · mean{" "}
                {row.observed_pf_days_mean} d · {row.samples} samples
              </li>
            ))}
          </ul>
        )}
        <p
          data-testid="pf-honesty"
          className="mt-2 rounded-xl border border-white/8 bg-industrial-black/60 px-4 py-3 text-xs text-slate-400"
        >
          A recommended interval is not an authorized inspection frequency.
          Adopt is offered to reliability engineer and administrator, and
          requires a stated engineering basis (20 characters). The AI-operator
          identity is not offered Adopt.
        </p>
      </div>

      {flash && (
        <p className="rounded-lg border border-white/10 bg-white/4 px-3 py-2 text-sm text-slate-200">
          {flash}
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-white/6">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <caption className="sr-only">
            Potential-failure to functional-failure intervals by mode and
            detection technique
          </caption>
          <thead className="bg-white/2 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Failure mode
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Technique
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                P-F
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Inspect every
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                State
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Act
              </th>
            </tr>
          </thead>
          <tbody>
            {pf.map((p) => (
              <tr key={p.id} className="border-t border-white/6 align-top">
                <td className="px-4 py-2.5 text-slate-200">{p.failure_mode}</td>
                <td className="px-4 py-2.5 text-slate-400">
                  {p.detection_technique}
                </td>
                <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums">
                  {p.pf_interval_days} d
                </td>
                <td className="px-4 py-2.5 font-mono text-signal-cyan tabular-nums">
                  {p.recommended_inspection_days} d
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${
                      p.status === "adopted"
                        ? "border-green-500/30 bg-green-500/10 text-green-300"
                        : "border-amber-500/30 bg-amber-500/10 text-amber-300"
                    }`}
                  >
                    {p.status}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  {p.status === "draft" && canAdopt && (
                    <button
                      type="button"
                      onClick={() => {
                        setAdopting(p.id);
                        setDays(String(p.pf_interval_days));
                        setNote("");
                        setFlash(null);
                      }}
                      className="rounded-lg border border-signal-gold/40 bg-signal-gold/10 px-2.5 py-1 text-xs font-medium text-signal-gold hover:bg-signal-gold/20 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-gold"
                    >
                      Adopt
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!canAdopt && (
        <p className="text-xs text-slate-500">
          Adopting a P-F interval requires the reliability engineer or
          administrator role. The AI-operator identity is not offered Adopt. A
          recommendation on this table is not authorization.
        </p>
      )}

      {adopting && (
        <form
          aria-label="Adopt P-F interval"
          className="space-y-3 rounded-xl border border-white/8 bg-overlook-deep/40 p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setFlash(null);
            try {
              const result = await adoptPfInterval(
                adopting,
                Number(days),
                note,
              );
              setFlash(
                `Adopted at ${result.pf_interval_days} days. Recommended inspection ${result.recommended_inspection_days} days. This is a named-human act, not an AI authorization.`,
              );
              setAdopting(null);
              setNote("");
              intervals.refetch();
            } catch (err) {
              setFlash(
                err instanceof Error ? err.message : "That did not work.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <p className="text-sm text-slate-300">
            Adoption records you. It does not invent a site-specific interval —
            you must state the engineering basis.
          </p>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">
              P-F interval (days)
            </span>
            <input
              aria-label="P-F interval days"
              type="number"
              min={0.1}
              step="any"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="w-32 rounded-lg border border-white/10 bg-industrial-black px-3 py-2 font-mono text-sm text-slate-200"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">
              Engineering basis
            </span>
            <textarea
              aria-label="P-F adoption basis"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-white/10 bg-industrial-black px-3 py-2 text-sm text-slate-200"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || note.trim().length < 20 || !(Number(days) > 0)}
              className="rounded-lg border border-signal-gold/40 bg-signal-gold/10 px-3 py-1.5 text-sm font-medium text-signal-gold hover:bg-signal-gold/20 disabled:opacity-40"
            >
              Adopt interval
            </button>
            <button
              type="button"
              onClick={() => setAdopting(null)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-slate-400"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function PlantHistorianEvidence({
  status,
  loading,
  error,
  onRetry,
  citing,
  onCite,
}: {
  status: PlantHistorianStatus | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  citing: string | null;
  onCite: (recommendationId: string) => Promise<void>;
}) {
  if (loading) {
    return (
      <p className="text-xs text-slate-500">
        Checking plant historian configuration…
      </p>
    );
  }
  if (error) {
    return (
      <p className="text-xs text-slate-500">
        Historian status unavailable.{" "}
        <button type="button" className="underline" onClick={onRetry}>
          Retry
        </button>
      </p>
    );
  }
  const configured = status?.configured ?? false;
  const recent = status?.recent ?? [];
  const recs = status?.citable_recommendations ?? [];
  return (
    <div
      className={`rounded-xl border p-4 ${
        configured && status?.telemetry_mode === "historian_owns"
          ? "border-signal-cyan/30 bg-signal-cyan/5"
          : "border-white/6 bg-white/2"
      }`}
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
        <Radio className="h-4 w-4 text-signal-cyan" aria-hidden />
        Plant historian evidence
        <span className="text-xs font-normal text-slate-500">
          {configured
            ? status?.telemetry_mode === "historian_owns"
              ? "connector-backed when pulled"
              : "configured, seed/sim still in force"
            : "not configured"}
        </span>
      </h3>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">
        {status?.basis ??
          "No plant historian is configured. Seed/sim telemetry is not live plant data."}
      </p>
      {recent.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-slate-300">
          {recent.map((row) => (
            <li key={`${row.source_system}-${row.external_id}-${row.taken_at}`}>
              <span className="font-mono text-signal-cyan">
                {row.source_system}
              </span>
              {" · "}
              {row.asset ?? "asset"} / {row.sensor ?? "sensor"} = {row.value} at{" "}
              {new Date(row.taken_at).toLocaleString()}
            </li>
          ))}
        </ul>
      )}
      {recs.length > 0 && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-slate-400">
            Pending recommendations that can cite these readings:
          </p>
          {recs.map((rec) => (
            <button
              key={rec.id}
              type="button"
              disabled={citing === rec.id}
              onClick={() => void onCite(rec.id)}
              className="block rounded-lg border border-signal-cyan/30 px-3 py-1.5 text-xs text-signal-cyan disabled:opacity-40"
            >
              {citing === rec.id
                ? "Attaching…"
                : `Cite historian readings on: ${rec.title}`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
