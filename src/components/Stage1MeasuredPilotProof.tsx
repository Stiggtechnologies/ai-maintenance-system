/**
 * Measured Stage-1 pilot proof.
 *
 * Five arms from this tenant's canonical rows: emergency work, repeat
 * failures, availability, backlog quality, and production loss. A missing
 * arm stays "Not measurable". Historical fleet studies are not substituted.
 */
import { Activity } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  getStage1MeasuredPilotProof,
  type PilotMeasureStatus,
  type Stage1MeasuredPilotProof,
} from "../services/stage1PilotPack";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

function formatMeasured(value: number | null, unit: string | null): string {
  if (value === null) return "Not measurable";
  if (unit === "%") return `${value}%`;
  if (unit) return `${value} ${unit}`;
  return String(value);
}

function StatusLabel({ status }: { status: PilotMeasureStatus }) {
  const label =
    status === "measured"
      ? "Measured"
      : status === "partial"
        ? "Partial"
        : "Not measurable";
  return (
    <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
  );
}

export function Stage1MeasuredPilotProof() {
  const { data, loading, error, refetch } = useAsyncData(
    getStage1MeasuredPilotProof,
    [],
  );

  if (loading) {
    return <LoadingState label="Measuring this tenant's pilot proof" />;
  }
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  if (!data || data.historical_fleet_studies_used !== false) {
    return (
      <ErrorState
        message="Pilot proof refused: the readout was not marked as this tenant's live rows."
        onRetry={refetch}
      />
    );
  }

  return (
    <section
      data-testid="stage1-measured-pilot-proof"
      className="space-y-4 rounded-2xl border border-white/8 bg-[#0D1520] p-4 md:p-5"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-teal-300">
          <Activity className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white">
            Measured pilot proof
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Emergency work, repeat failures, availability, backlog quality, and
            production loss from this tenant&apos;s rows. Historical fleet
            studies are not used. {data.authority}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {data.population.work_orders} work orders
            {data.population.work_orders_without_source_system > 0
              ? ` (${data.population.work_orders_without_source_system} with no source system)`
              : ""}
            {" · "}
            {data.population.operating_state_rows} operating-state rows ·{" "}
            {data.population.production_rows} production rows
          </p>
        </div>
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        <ProofCard
          testId="stage1-proof-emergency"
          title="Emergency work"
          status={data.emergency_work.status}
          value={formatMeasured(
            data.emergency_work.value,
            data.emergency_work.unit,
          )}
          detail={`${data.emergency_work.classified} classified of ${data.emergency_work.work_orders} work orders in the health window.`}
          basis={data.emergency_work.basis}
        />
        <ProofCard
          testId="stage1-proof-repeat"
          title="Repeat failures"
          status={data.repeat_failures.status}
          value={formatMeasured(
            data.repeat_failures.value,
            data.repeat_failures.unit,
          )}
          detail={`${data.repeat_failures.repeat_events} repeat events across ${data.repeat_failures.coded_events} coded events. ${data.repeat_failures.uncoded_excluded} uncoded and ${data.repeat_failures.incomplete_excluded} incomplete-provenance events stay excluded.`}
          basis={data.repeat_failures.basis}
        />
        <ProofCard
          testId="stage1-proof-availability"
          title="Availability"
          status={data.availability.status}
          value={formatMeasured(data.availability.value, data.availability.unit)}
          detail={availabilityDetail(data)}
          basis={data.availability.basis}
        />
        <BacklogCard proof={data} />
        <ProofCard
          testId="stage1-proof-loss"
          title="Production loss"
          status={data.production_loss.status}
          value={lossValue(data)}
          detail={`${data.production_loss.assets_measurable} assets measurable. ${data.production_loss.assets_excluded_mixed_units} excluded for mixed units. ${data.production_loss.assets_excluded_no_rate} excluded with no demonstrated rate.`}
          basis={data.production_loss.basis}
        />
      </div>
      {data.production_loss.by_asset.length > 0 && (
        <ul
          data-testid="stage1-proof-loss-assets"
          className="space-y-1 text-xs text-slate-400"
        >
          {data.production_loss.by_asset.map((row) => (
            <li key={`${row.asset}-${row.unit_of_measure}`}>
              {row.asset}: {row.units_lost} {row.unit_of_measure} lost at{" "}
              {row.demonstrated_rate} per running hour
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function availabilityDetail(data: Stage1MeasuredPilotProof): string {
  if (data.availability.conflict_assets > 0) {
    return `${data.availability.conflict_assets} asset(s) have overlapping running and down intervals.`;
  }
  if (
    data.availability.running_hours === null &&
    data.availability.down_hours === null
  ) {
    return "No running or down exposure in this tenant's window.";
  }
  return `${data.availability.running_hours ?? 0} running hours, ${data.availability.down_hours ?? 0} down hours, ${data.availability.other_hours ?? 0} idle, standby, or offline hours outside the ratio.`;
}

function lossValue(data: Stage1MeasuredPilotProof): string {
  if (data.production_loss.status !== "measured") return "Not measurable";
  if (data.production_loss.sum_refused) {
    return "Measured per asset — mixed units stay unsummed";
  }
  return formatMeasured(
    data.production_loss.units_lost,
    data.production_loss.unit_of_measure,
  );
}

function ProofCard({
  testId,
  title,
  status,
  value,
  detail,
  basis,
}: {
  testId: string;
  title: string;
  status: PilotMeasureStatus;
  value: string;
  detail: string;
  basis: string;
}) {
  return (
    <article
      data-testid={testId}
      className="rounded-xl border border-white/8 bg-black/20 p-3"
    >
      <StatusLabel status={status} />
      <h3 className="mt-1 text-sm font-medium text-slate-100">{title}</h3>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-400">{detail}</p>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">{basis}</p>
    </article>
  );
}

function BacklogCard({ proof }: { proof: Stage1MeasuredPilotProof }) {
  const row = proof.backlog_quality;
  const planning =
    row.planning_complete_pct === null
      ? "Not measurable"
      : `${row.planning_complete_pct}%`;
  const materials =
    row.materials_status === "measured" && row.materials_ready_pct !== null
      ? `${row.materials_ready_pct}%`
      : "Not measurable";
  return (
    <article
      data-testid="stage1-proof-backlog"
      className="rounded-xl border border-white/8 bg-black/20 p-3"
    >
      <StatusLabel status={row.status} />
      <h3 className="mt-1 text-sm font-medium text-slate-100">
        Backlog quality
      </h3>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">
            Planning complete
          </dt>
          <dd className="text-xl font-semibold tabular-nums text-white">
            {planning}
          </dd>
          <dd className="text-xs text-slate-400">
            {row.planning_complete} of {row.open_work_orders} open
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wide text-slate-500">
            Materials ready
          </dt>
          <dd className="text-xl font-semibold tabular-nums text-white">
            {materials}
          </dd>
          <dd className="text-xs text-slate-400">
            {row.materials_with_demand} open orders with demand
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs leading-relaxed text-slate-500">{row.basis}</p>
    </article>
  );
}
