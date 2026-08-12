/**
 * DataGovernance — whether the register can say what is what
 * (capability register E12.03–E12.06, E12.09, E12.11–E12.13).
 *
 * The identity line goes first because it bounds everything else. An asset
 * whose only identifier is a free-text name cannot be joined on, and no
 * analysis further down this application can recover that.
 *
 * Duplicate candidates are shown and never actioned. A wrong merge destroys
 * two histories and is far more expensive to undo than a missed one, so the
 * panel proposes and a person decides — the same pattern the interdependency
 * candidate queue uses.
 */
import { useMemo } from "react";
import { Fingerprint, Info, Copy, Activity } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import {
  assessIdentity,
  detectDuplicates,
  validateReading,
  type AssetIdentity,
  type SensorRule,
  type Reading,
} from "../lib/data-governance";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface Posture {
  assets_total: number;
  name_only: number;
  sensors_total: number;
  sensors_with_rules: number;
  calibrations_overdue: number;
  historian_tags_unconfirmed: number;
  slas_breaching: number;
  basis: string;
}

interface SensorRow {
  sensorName: string;
  assetName: string | null;
  unit: string | null;
  rule: SensorRule;
  history: Reading[];
}

export function DataGovernance() {
  const { data, loading, error, refetch } = useAsyncData<{
    posture: Posture | null;
    assets: AssetIdentity[];
    sensors: SensorRow[];
  }>(async () => {
    const [p, a, s] = await Promise.all([
      supabase.rpc("get_identity_posture"),
      supabase.rpc("get_asset_identities", { p_limit: 500 }),
      supabase.rpc("get_sensor_validation"),
    ]);
    if (p.error) throw new Error(p.error.message);
    if (a.error) throw new Error(a.error.message);
    if (s.error) throw new Error(s.error.message);
    return {
      posture: (p.data as Posture[])?.[0] ?? null,
      assets: (a.data as AssetIdentity[]) ?? [],
      sensors: (s.data as SensorRow[]) ?? [],
    };
  }, []);

  const identity = useMemo(() => assessIdentity(data?.assets ?? []), [data]);
  const duplicates = useMemo(
    () => detectDuplicates(data?.assets ?? []),
    [data],
  );
  const sensorVerdicts = useMemo(
    () =>
      (data?.sensors ?? []).map((s) => ({
        sensor: s,
        result: validateReading(
          (s.history ?? []).map((h) => ({
            at: h.at,
            value: Number(h.value),
          })),
          s.rule ?? {},
        ),
      })),
    [data],
  );

  if (loading) return <LoadingState label="Loading data governance" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const posture = data?.posture ?? null;
  const unusable = sensorVerdicts.filter((s) => !s.result.usable);

  return (
    <section aria-labelledby="datagov-heading" className="space-y-4">
      <div>
        <h2
          id="datagov-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Fingerprint className="h-5 w-5 text-signal-cyan" aria-hidden />
          Data Governance
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          Everything else here rests on the register being able to say what is
          what.
        </p>
      </div>

      {posture && (
        <div
          className={`flex items-start gap-2 rounded-xl border p-4 text-sm ${
            posture.name_only > 0
              ? "border-amber-500/30 bg-amber-500/5 text-amber-100"
              : "border-white/6 bg-white/2 text-slate-300"
          }`}
        >
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{posture.basis}</p>
        </div>
      )}

      {/* Identity. */}
      <div className="rounded-xl border border-white/6 p-4">
        <h3 className="text-sm font-semibold text-white">Asset identity</h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          {identity.reason}
        </p>
        <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
          <span>
            <span className="font-mono text-slate-300">{identity.withTag}</span>{" "}
            with a tag
          </span>
          <span>
            <span className="font-mono text-slate-300">
              {identity.withSerial}
            </span>{" "}
            with a serial number
          </span>
          <span>
            <span className="font-mono text-slate-300">
              {identity.nameOnly}
            </span>{" "}
            name only
          </span>
        </div>
      </div>

      {/* Duplicates. */}
      <div className="rounded-xl border border-white/6 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Copy className="h-4 w-4 text-signal-cyan" aria-hidden />
          Duplicate candidates
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          {duplicates.reason}
        </p>
        {duplicates.candidates.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">
            {duplicates.candidates.slice(0, 10).map((c, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-xs uppercase tracking-wide ${
                    c.confidence === "certain"
                      ? "bg-rose-500/10 text-rose-300"
                      : "bg-white/5 text-slate-400"
                  }`}
                >
                  {c.confidence}
                </span>
                <span className="text-slate-200">
                  {c.aLabel} ↔ {c.bLabel}
                </span>
                <span className="text-xs text-slate-500">{c.basis}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Sensor validation. */}
      {sensorVerdicts.length > 0 && (
        <div className="rounded-xl border border-white/6 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Activity className="h-4 w-4 text-signal-cyan" aria-hidden />
            Sensor validation
            <span className="text-xs font-normal text-slate-500">
              {unusable.length} of {sensorVerdicts.length} unusable
            </span>
          </h3>
          <ul className="mt-2 space-y-1.5">
            {sensorVerdicts.map(({ sensor, result }, i) => (
              <li key={i} className="text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-slate-200">{sensor.sensorName}</span>
                  {sensor.assetName && (
                    <span className="text-xs text-slate-500">
                      {sensor.assetName}
                    </span>
                  )}
                  <span
                    className={`font-mono text-xs ${
                      result.usable ? "text-signal-cyan" : "text-rose-300"
                    }`}
                  >
                    {result.verdict.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-slate-500">
                  {result.reason}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
