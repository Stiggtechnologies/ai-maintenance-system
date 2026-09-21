import { useCallback, useEffect, useState } from "react";
import {
  getCasePhysicalInformationReadiness,
  type PhysicalInformationReadiness,
  type ReadinessDimension,
} from "../../services/physicalInformationReadinessService";

function DimensionCard({
  label,
  value,
}: {
  label: string;
  value: ReadinessDimension;
}) {
  const tone =
    value.status === "READY"
      ? "text-emerald-300"
      : value.status === "NOT_READY"
        ? "text-amber-300"
        : "text-slate-400";
  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-slate-200">{label}</h3>
        <span className={`text-[10px] font-semibold ${tone}`}>
          {value.status.replaceAll("_", " ")}
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-white">
        {value.percent == null ? "Not assessed" : `${value.percent}%`}
      </p>
      <p className="mt-1 text-[11px] text-slate-500">
        {value.satisfied}/{value.total} evidenced · {value.source}
      </p>
      {(value.unassessedSystemCount ?? 0) > 0 && (
        <p className="mt-1 text-[11px] text-amber-300">
          {value.unassessedSystemCount} system(s) have no assessment scope.
        </p>
      )}
    </div>
  );
}

export function PhysicalInformationReadinessPanel({
  caseId,
}: {
  caseId: string;
}) {
  const [model, setModel] = useState<PhysicalInformationReadiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const load = useCallback(
    () =>
      getCasePhysicalInformationReadiness(caseId)
        .then((x) => {
          setModel(x);
          setError(null);
        })
        .catch((x) =>
          setError(
            x instanceof Error ? x.message : "Readiness comparison failed",
          ),
        ),
    [caseId],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">
            Physical vs information readiness
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Two independent evidence positions. Installed and tested does not
            mean documented; documented does not mean physically accepted.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="rounded border border-white/10 px-2 py-1 text-[11px] text-slate-300"
        >
          Refresh
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-rose-300">
          {error}
        </p>
      )}
      {model && (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <DimensionCard
              label="Project physical readiness"
              value={model.project.physical}
            />
            <DimensionCard
              label="Project information readiness"
              value={model.project.information}
            />
          </div>
          <div className="mt-4 space-y-2">
            {model.systems.length === 0 ? (
              <p className="text-xs text-slate-500">
                No commissioning systems are scoped to this case; both positions
                remain not assessed.
              </p>
            ) : (
              model.systems.map((s) => (
                <div
                  key={s.systemId}
                  className="rounded-lg border border-white/8"
                >
                  <button
                    className="flex w-full items-center justify-between gap-3 p-3 text-left"
                    onClick={() =>
                      setOpen(open === s.systemId ? null : s.systemId)
                    }
                  >
                    <span className="text-xs font-semibold text-slate-200">
                      {s.systemRef} · {s.title}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      Physical {s.physical.percent ?? "—"}% · Information{" "}
                      {s.information.percent ?? "—"}%
                    </span>
                  </button>
                  {open === s.systemId && (
                    <div className="grid gap-3 border-t border-white/8 p-3 md:grid-cols-2">
                      <DimensionCard label="Physical" value={s.physical} />
                      <DimensionCard
                        label="Information"
                        value={s.information}
                      />
                      <p className="text-[11px] text-slate-500 md:col-span-2">
                        Commissioning state: {s.commissioningState}. Physical
                        gaps: {s.physical.gaps?.length ?? 0}; information gaps:{" "}
                        {s.information.gaps?.length ?? 0}.
                      </p>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          <p className="mt-4 text-[11px] text-slate-500">
            {model.decisionBoundary}
          </p>
        </>
      )}
    </section>
  );
}
