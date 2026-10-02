import { useState } from "react";
import { Gauge, Link2, ShieldCheck, TriangleAlert } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  classifyDowntimeEvent,
  CONSTRAINT_CLASSIFICATIONS,
  DOWNTIME_CLASSIFICATIONS,
  getProductionLossReconciliation,
  type DowntimeClassification,
  type ProductionLossEvent,
  type ProductionLossPayload,
} from "../services/productionLossService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const labelFor = (value: string) =>
  DOWNTIME_CLASSIFICATIONS.find(([key]) => key === value)?.[1] ??
  (value === "unclassified" ? "Unclassified" : value.replaceAll("_", " "));

export function ProductionLossReconciliation() {
  const { data, loading, error, refetch } = useAsyncData<ProductionLossPayload>(
    () => getProductionLossReconciliation(90),
    [],
  );
  const [editing, setEditing] = useState<number | null>(null);
  const [classification, setClassification] =
    useState<DowntimeClassification>("equipment_failure");
  const [basis, setBasis] = useState("");
  const [constraintSignalId, setConstraintSignalId] = useState("");
  const [workOrderId, setWorkOrderId] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  if (loading)
    return <LoadingState label="Loading production-loss reconciliation" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data) return null;

  const begin = (event: ProductionLossEvent) => {
    setEditing(event.operatingStateId);
    setClassification(
      event.classification === "unclassified"
        ? "equipment_failure"
        : event.classification,
    );
    setBasis(event.classificationBasis ?? "");
    setConstraintSignalId(event.constraintSignalId ?? "");
    setWorkOrderId(event.workOrderId ?? "");
    setFlash(null);
  };

  const submit = async (event: ProductionLossEvent) => {
    if (basis.trim().length < 20) {
      setFlash("Record an evidence basis of at least 20 characters.");
      return;
    }
    if (CONSTRAINT_CLASSIFICATIONS.has(classification) && !constraintSignalId) {
      setFlash("Select the canonical constraint signal supporting this claim.");
      return;
    }
    setBusy(true);
    try {
      await classifyDowntimeEvent({
        operatingStateId: event.operatingStateId,
        classification,
        basis: basis.trim(),
        expectedReviewId: event.classificationReviewId,
        constraintSignalId: constraintSignalId || null,
        workOrderId: workOrderId || null,
      });
      setEditing(null);
      setBasis("");
      setConstraintSignalId("");
      setWorkOrderId("");
      setFlash(
        "Classification recorded. Any earlier interpretation remains in the append-only history.",
      );
      refetch();
    } catch (cause) {
      setFlash(
        cause instanceof Error ? cause.message : "Classification was refused.",
      );
    } finally {
      setBusy(false);
    }
  };

  const summary = data.summary;
  const currentConstraints = data.constraints.filter((item) => item.current);

  return (
    <section aria-labelledby="production-loss-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3
            id="production-loss-heading"
            className="flex items-center gap-2 text-base font-semibold text-white"
          >
            <Gauge className="h-4.5 w-4.5 text-signal-cyan" aria-hidden />
            Production loss reconciliation
            <span className="font-mono text-[10px] text-slate-600">C2.06</span>
          </h3>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-slate-400">
            {data.basis} No nameplate assumptions. Source downtime is never
            rewritten; a new human review supersedes the prior interpretation.
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-teal-500/20 bg-teal-500/5 px-2.5 py-1 text-xs text-teal-300">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Human-classified · advisory
        </span>
      </div>

      {flash && (
        <p
          role="status"
          className="rounded-lg border border-white/10 bg-overlook-deep/60 px-3 py-2 text-xs text-slate-300"
        >
          {flash}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          [
            "Down hours",
            summary.downHours.toFixed(1),
            `${summary.downEvents} events`,
          ],
          [
            "Classified coverage",
            summary.classificationCoveragePct === null
              ? "No events"
              : `${summary.classificationCoveragePct.toFixed(1)}%`,
            `${summary.unclassifiedDownHours.toFixed(1)} h still unclassified`,
          ],
          [
            "Measurable events",
            `${summary.measurableEvents}/${summary.downEvents}`,
            "running + production evidence",
          ],
          [
            "Units at risk",
            summary.measurableEvents > 0
              ? summary.estimatedUnitsLost.toLocaleString()
              : "Not measurable",
            "demonstrated rate only",
          ],
        ].map(([label, value, note]) => (
          <div
            key={label}
            className="rounded-xl border border-white/6 bg-overlook-deep/40 p-3.5"
          >
            <p className="text-[11px] uppercase tracking-wide text-slate-500">
              {label}
            </p>
            <p className="mt-1 font-mono text-lg text-slate-100">{value}</p>
            <p className="mt-0.5 text-[11px] text-slate-500">{note}</p>
          </div>
        ))}
      </div>

      {data.categories.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label="Downtime categories">
          {data.categories.map((category) => (
            <span
              key={category.classification}
              className={`rounded-full border px-2.5 py-1 text-xs ${
                category.classification === "unclassified"
                  ? "border-amber-500/30 bg-amber-500/5 text-amber-300"
                  : "border-white/10 bg-white/3 text-slate-300"
              }`}
            >
              {labelFor(category.classification)} · {category.downHours} h ·{" "}
              {category.sharePct}%
            </span>
          ))}
        </div>
      )}

      {data.events.length === 0 ? (
        <p className="rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-400">
          No canonical down-state records overlap this 90-day window. SyncAI
          does not infer that missing operating-state history means the assets
          were running.
        </p>
      ) : (
        <div className="space-y-2">
          {data.eventsTruncated && (
            <p className="text-[11px] text-slate-500">
              Showing the 200 most recent events; summary and category totals
              still cover all {summary.downEvents} events in the window.
            </p>
          )}
          <div className="overflow-x-auto rounded-xl border border-white/6">
            <table className="w-full min-w-[64rem] text-left text-xs">
              <caption className="sr-only">
                Canonical downtime events and current human classifications
              </caption>
              <thead className="bg-white/2 uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Asset / start</th>
                  <th className="px-3 py-2 font-medium">Hours / state</th>
                  <th className="px-3 py-2 font-medium">Classification</th>
                  <th className="px-3 py-2 font-medium">Evidence</th>
                  <th className="px-3 py-2 font-medium">Units at risk</th>
                  <th className="px-3 py-2 font-medium">Review</th>
                </tr>
              </thead>
              <tbody>
                {data.events.map((event) => (
                  <tr
                    key={event.operatingStateId}
                    className="border-t border-white/6 align-top"
                  >
                    <td className="px-3 py-3 text-slate-200">
                      <p className="font-medium">
                        {event.assetTag ?? event.asset}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {new Date(event.startedAt).toLocaleString()}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-mono text-slate-300">
                        {event.downHours.toFixed(1)} h
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        {event.state.replaceAll("_", " ")}
                        {event.reasonCode ? ` · ${event.reasonCode}` : ""}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`rounded-full border px-2 py-0.5 ${
                          event.classification === "unclassified"
                            ? "border-amber-500/30 text-amber-300"
                            : "border-teal-500/20 text-teal-300"
                        }`}
                      >
                        {labelFor(event.classification)}
                      </span>
                      {event.classifiedBy && (
                        <p className="mt-1.5 text-[11px] text-slate-500">
                          by {event.classifiedBy}
                        </p>
                      )}
                    </td>
                    <td className="max-w-xs px-3 py-3 text-slate-400">
                      <p className="line-clamp-2">
                        {event.classificationBasis ??
                          "No human basis recorded."}
                      </p>
                      {event.constraintKey && (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-cyan-300">
                          <Link2 className="h-3 w-3" aria-hidden />
                          {event.constraintKind}: {event.constraintKey}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {event.estimatedUnitsLost === null ? (
                        <span className="inline-flex items-center gap-1 text-amber-300">
                          <TriangleAlert className="h-3 w-3" aria-hidden />
                          Not measurable
                        </span>
                      ) : (
                        <>
                          <p className="font-mono text-amber-300">
                            {event.estimatedUnitsLost.toLocaleString()}{" "}
                            {event.unitOfMeasure}
                          </p>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            {event.demonstratedRate} {event.unitOfMeasure}/h
                          </p>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {editing === event.operatingStateId ? (
                        <div className="w-72 space-y-2">
                          <select
                            aria-label={`Classification for ${event.assetTag ?? event.asset}`}
                            value={classification}
                            onChange={(e) => {
                              const next = e.target
                                .value as DowntimeClassification;
                              setClassification(next);
                              if (!CONSTRAINT_CLASSIFICATIONS.has(next))
                                setConstraintSignalId("");
                            }}
                            className="w-full rounded-lg border border-white/10 bg-overlook-deep px-2 py-1.5 text-slate-200"
                          >
                            {DOWNTIME_CLASSIFICATIONS.map(([key, label]) => (
                              <option key={key} value={key}>
                                {label}
                              </option>
                            ))}
                          </select>
                          {CONSTRAINT_CLASSIFICATIONS.has(classification) && (
                            <select
                              aria-label="Supporting constraint signal"
                              value={constraintSignalId}
                              onChange={(e) =>
                                setConstraintSignalId(e.target.value)
                              }
                              className="w-full rounded-lg border border-white/10 bg-overlook-deep px-2 py-1.5 text-slate-200"
                            >
                              <option value="">
                                Select supporting constraint…
                              </option>
                              {data.constraints
                                .filter(
                                  (item) =>
                                    item.assetId === null ||
                                    item.assetId === event.assetId,
                                )
                                .map((item) => (
                                  <option key={item.id} value={item.id}>
                                    {item.kind}: {item.key} · {item.state}
                                    {item.current ? "" : " · expired"}
                                  </option>
                                ))}
                            </select>
                          )}
                          {event.candidateWorkOrders.length > 0 && (
                            <select
                              aria-label="Related work order"
                              value={workOrderId}
                              onChange={(e) => setWorkOrderId(e.target.value)}
                              className="w-full rounded-lg border border-white/10 bg-overlook-deep px-2 py-1.5 text-slate-200"
                            >
                              <option value="">No linked work order</option>
                              {event.candidateWorkOrders.map((workOrder) => (
                                <option key={workOrder.id} value={workOrder.id}>
                                  {workOrder.woNumber ?? workOrder.id} ·{" "}
                                  {workOrder.title}
                                </option>
                              ))}
                            </select>
                          )}
                          <textarea
                            aria-label="Classification evidence basis"
                            value={basis}
                            onChange={(e) => setBasis(e.target.value)}
                            placeholder="What source evidence supports this classification?"
                            rows={3}
                            className="w-full rounded-lg border border-white/10 bg-overlook-deep px-2 py-1.5 text-slate-200 placeholder:text-slate-600"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void submit(event)}
                              className="rounded-lg bg-teal-500/15 px-2.5 py-1.5 text-teal-300 disabled:opacity-50"
                            >
                              Record review
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditing(null)}
                              className="rounded-lg border border-white/10 px-2.5 py-1.5 text-slate-400"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => begin(event)}
                          className="rounded-lg border border-white/10 px-2.5 py-1.5 text-slate-300 hover:border-white/20"
                        >
                          {event.classification === "unclassified"
                            ? "Classify"
                            : "Supersede"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <details className="rounded-xl border border-white/6 bg-overlook-deep/30 p-3.5">
        <summary className="cursor-pointer text-sm font-medium text-slate-300">
          Constraint evidence · {currentConstraints.length} current /{" "}
          {data.constraints.length} recorded
        </summary>
        <ul className="mt-3 grid gap-2 md:grid-cols-2">
          {data.constraints.map((item) => (
            <li
              key={item.id}
              className="rounded-lg border border-white/6 bg-white/2 p-3 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-200">
                  {item.kind}: {item.key}
                </span>
                <span
                  className={item.current ? "text-teal-300" : "text-slate-500"}
                >
                  {item.state} · {item.current ? "current" : "expired"}
                </span>
              </div>
              <p className="mt-1 text-slate-400">{item.basis}</p>
              <p className="mt-1 text-[11px] text-slate-600">
                {item.sourceSystem}
                {item.sourceRef ? ` · ${item.sourceRef}` : ""}
              </p>
            </li>
          ))}
          {data.constraints.length === 0 && (
            <li className="text-slate-500">
              No constraint signals were recorded in this window. Constrained
              loss classifications remain blocked until one is available.
            </li>
          )}
        </ul>
      </details>

      <p className="text-[11px] leading-relaxed text-slate-600">
        {data.authority}
      </p>
    </section>
  );
}
