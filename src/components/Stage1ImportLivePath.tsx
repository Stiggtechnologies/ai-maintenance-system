/**
 * Stage-1 live path for plans + work-order history.
 *
 * Reuses ContractImport (the one ingest door) and deep-links the existing
 * CMMS read adapter (#366) and job-plan authoring (#333). Not a second CMMS.
 */
import { useNavigate } from "react-router-dom";
import { Database, ExternalLink, FileSpreadsheet } from "lucide-react";
import { ContractImport } from "./ContractImport";
import { useAsyncData } from "../hooks/useAsyncData";
import { getStage1ImportStatus } from "../services/stage1PilotPack";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

export function Stage1ImportLivePath() {
  const navigate = useNavigate();
  const { data, loading, error, refetch } = useAsyncData(
    getStage1ImportStatus,
    [],
  );

  return (
    <section
      data-testid="stage1-import-live-path"
      className="space-y-4 rounded-2xl border border-white/8 bg-[#0D1520] p-4 md:p-5"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-500/15 text-teal-300">
          <FileSpreadsheet className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white">
            Import plans and work-order history
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Same ingest contract as /pm-programme. Same read-only CMMS pull as
            Integrations. No parallel historian or CMMS. A file is not live
            plant data until a named human imports it; a dry-run writes nothing.
          </p>
        </div>
      </div>

      {loading && (
        <LoadingState label="Counting live plan and work-order rows" />
      )}
      {error && <ErrorState message={error} onRetry={refetch} />}

      {data && (
        <div
          data-testid="stage1-import-counts"
          className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4"
        >
          <CountTile
            label="Maintenance plans"
            value={data.maintenancePlans}
            empty="None loaded"
          />
          <CountTile
            label="Work orders"
            value={data.workOrders}
            hint={
              data.completedWorkOrders > 0
                ? `${data.completedWorkOrders} completed`
                : undefined
            }
            empty="No history"
          />
          <CountTile
            label="Job plans"
            value={data.jobPlans}
            hint={
              data.adoptedJobPlans > 0
                ? `${data.adoptedJobPlans} adopted`
                : "Drafts are not executable"
            }
            empty="None authored"
          />
          <div className="rounded-xl border border-white/8 bg-black/20 p-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500">
              Honesty
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-300">
              {data.honesty}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-white/5"
          onClick={() => navigate("/integrations")}
        >
          <Database className="h-3.5 w-3.5" />
          CMMS read-only WO pull
          <ExternalLink className="h-3 w-3" />
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-white/5"
          onClick={() => navigate("/job-plans")}
        >
          Author / adopt job plans
          <ExternalLink className="h-3 w-3" />
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-100 hover:bg-white/5"
          onClick={() => navigate("/pm-programme")}
        >
          Full import door
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>

      <ContractImport initialEntity="maintenance_plan" />
    </section>
  );
}

function CountTile({
  label,
  value,
  hint,
  empty,
}: {
  label: string;
  value: number;
  hint?: string;
  empty: string;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/20 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-white">
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-400">
        {value === 0 ? empty : (hint ?? "Live tenant rows")}
      </p>
    </div>
  );
}
