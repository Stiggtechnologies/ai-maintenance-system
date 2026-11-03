/**
 * E3.03 — starts, stops, loading, cycling and process excursions for one asset.
 * The database computes the picture. Retaining it is a named-human audit act
 * and does not acknowledge an alarm, create work, change a limit, or release
 * equipment.
 */
import { useState } from "react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getOperatingDutyReadings,
  previewOperatingDuty,
  recordOperatingDutyReading,
  type OperatingDutyPicture,
} from "../services/operatingDutyService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

function countLabel(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function LoadCell({ value }: { value: number | null }) {
  if (value == null) return <span>not recorded</span>;
  return <span className="font-mono tabular-nums">{value}%</span>;
}

export function OperatingDutyPanel({
  assetId,
  windowDays,
}: {
  assetId: string;
  windowDays: number;
}) {
  const preview = useAsyncData(
    () => previewOperatingDuty(assetId, windowDays),
    [assetId, windowDays],
  );
  const history = useAsyncData(
    () => getOperatingDutyReadings(assetId),
    [assetId],
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function retain() {
    setBusy(true);
    setFormError(null);
    setStatus(null);
    try {
      const result = await recordOperatingDutyReading(assetId, windowDays, note);
      setNote("");
      setStatus(
        result.replayed
          ? "This source picture was already retained. No second audit row was written, and the stored note was left as it is."
          : "Duty reading retained. The counts are frozen from operating states and process events.",
      );
      preview.refetch();
      history.refetch();
    } catch (err: unknown) {
      setFormError(
        err instanceof Error ? err.message : "The duty reading was not retained.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (preview.loading) {
    return <LoadingState label="Loading operating duty" />;
  }
  if (preview.error || !preview.data) {
    return (
      <ErrorState
        message={preview.error ?? "Operating duty was not returned."}
        onRetry={preview.refetch}
      />
    );
  }

  const picture: OperatingDutyPicture = preview.data;
  const states = picture.states ?? [];
  const latest = history.data?.[0];
  const sameSource =
    latest != null && latest.source_digest === picture.source_digest;

  return (
    <section
      data-testid="operating-duty-panel"
      aria-labelledby="operating-duty-heading"
      className="space-y-3 border-t border-white/6 pt-3"
    >
      <div>
        <h3
          id="operating-duty-heading"
          className="text-xs uppercase tracking-wide text-slate-400"
        >
          Starts, stops, load, cycles and excursions
        </h3>
        <p className="mt-1 text-sm text-slate-300">{picture.basis}</p>
      </div>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {(
          [
            ["Starts", countLabel(picture.starts, "start")],
            ["Stops", countLabel(picture.stops, "stop")],
            ["Cycles", countLabel(picture.cycles_completed, "cycle")],
            ["Still running", countLabel(picture.running_open, "open run")],
            ["Excursions", countLabel(picture.excursions, "excursion")],
            ["Trips", countLabel(picture.trips, "trip")],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="rounded-lg border border-white/6 bg-white/2 p-2">
            <dt className="text-[10px] uppercase tracking-wide text-slate-500">
              {label}
            </dt>
            <dd className="mt-1 text-sm text-slate-100">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="text-xs text-slate-500">
        {picture.coverage_pct}% of the {picture.window_days}-day window is
        covered by state hours ({picture.hours_covered} h). Source events in
        the same window: {picture.source_start_events} starts,{" "}
        {picture.source_stop_events} stops, {picture.alarms} alarms,{" "}
        {picture.interlocks} interlocks. Source starts are not added to the
        state-transition starts. These are process events, not condition alerts.
      </p>

      {states.length === 0 ? (
        <p className="rounded-lg border border-white/6 bg-white/2 p-3 text-sm text-slate-400">
          No state hours fall inside this window. Missing load is not shown as
          zero, and the gap is not filled from condition alerts.
        </p>
      ) : (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">
            Load carried by each operating state inside the requested window
          </caption>
          <thead className="text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="py-1 font-medium">State</th>
              <th scope="col" className="py-1 font-medium">Hours</th>
              <th scope="col" className="py-1 font-medium">Load known</th>
              <th scope="col" className="py-1 font-medium">Load unknown</th>
              <th scope="col" className="py-1 font-medium">Time-weighted load</th>
            </tr>
          </thead>
          <tbody>
            {states.map((state) => (
              <tr key={state.state} className="border-t border-white/6">
                <td className="py-1.5 text-slate-200">{state.state}</td>
                <td className="py-1.5 font-mono text-slate-300 tabular-nums">
                  {state.hours}
                </td>
                <td className="py-1.5 font-mono text-slate-300 tabular-nums">
                  {state.load_known_hours}
                </td>
                <td className="py-1.5 font-mono text-slate-300 tabular-nums">
                  {state.load_unknown_hours}
                </td>
                <td className="py-1.5 text-slate-300">
                  <LoadCell value={state.load_pct_time_weighted} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {latest && (
        <p className="text-xs text-slate-500">
          {sameSource
            ? "The latest retained reading matches this source picture."
            : "Source rows have changed since the latest retained reading."}
        </p>
      )}

      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          void retain();
        }}
      >
        <label className="block text-xs text-slate-500">
          Optional note. It is stored with the reading and does not change the counts.
          <textarea
            aria-label="Operating duty note"
            value={note}
            maxLength={500}
            rows={2}
            onChange={(event) => setNote(event.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-industrial-black px-2 py-1.5 text-sm text-slate-200"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg border border-signal-gold/40 bg-signal-gold/10 px-2.5 py-1 text-xs font-medium text-signal-gold hover:bg-signal-gold/20 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-gold disabled:opacity-50"
        >
          {busy ? "Retaining duty reading" : "Retain this duty reading"}
        </button>
      </form>
      {status && (
        <p role="status" className="text-xs text-slate-300">
          {status}
        </p>
      )}
      {formError && <ErrorState message={formError} />}
      {history.error && (
        <ErrorState message={history.error} onRetry={history.refetch} />
      )}

      <div>
        <h4 className="text-xs uppercase tracking-wide text-slate-500">
          Retained readings
        </h4>
        {history.loading ? (
          <p className="mt-1 text-xs text-slate-500">Loading retained readings</p>
        ) : (history.data ?? []).length === 0 ? (
          <p className="mt-1 text-xs text-slate-500">
            No duty reading has been retained for this asset.
          </p>
        ) : (
          <ul className="mt-1 space-y-1 text-xs text-slate-400">
            {(history.data ?? []).map((reading) => (
              <li key={reading.id}>
                <time dateTime={reading.recorded_at}>
                  {new Date(reading.recorded_at).toLocaleString()}
                </time>
                {` · ${reading.starts} starts · ${reading.stops} stops · ${reading.cycles_completed} cycles · ${reading.excursions} excursions · ${reading.trips} trips`}
                {reading.note ? ` · ${reading.note}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
