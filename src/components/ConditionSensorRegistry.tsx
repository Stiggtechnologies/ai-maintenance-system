import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Activity,
  Archive,
  Gauge,
  History,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  decommissionConditionSensor,
  loadConditionSensorRegistry,
  reactivateConditionSensor,
  upsertConditionSensor,
  type ConditionSensorRow,
  type SensorLimitDirection,
} from "../services/conditionSensorRegistryService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

type Draft = {
  assetId: string;
  sensorTag: string;
  name: string;
  signalType: string;
  unit: string;
  detectionTechnique: string;
  warningLimit: string;
  alarmLimit: string;
  limitDirection: SensorLimitDirection;
  sourceSystem: string;
  basis: string;
};

const EMPTY_DRAFT: Draft = {
  assetId: "",
  sensorTag: "",
  name: "",
  signalType: "",
  unit: "",
  detectionTechnique: "",
  warningLimit: "",
  alarmLimit: "",
  limitDirection: "above",
  sourceSystem: "",
  basis: "",
};

function fromSensor(sensor: ConditionSensorRow): Draft {
  return {
    assetId: sensor.assetId,
    sensorTag: sensor.sensorTag ?? "",
    name: sensor.name,
    signalType: sensor.signalType ?? "",
    unit: sensor.unit ?? "",
    detectionTechnique: sensor.detectionTechnique ?? "",
    warningLimit: sensor.warningLimit?.toString() ?? "",
    alarmLimit: sensor.alarmLimit?.toString() ?? "",
    limitDirection: sensor.limitDirection,
    sourceSystem: sensor.sourceSystem ?? "",
    basis: sensor.configurationBasis ?? "",
  };
}

function optionalNumber(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

function readableDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : "—";
}

export function ConditionSensorRegistry() {
  const workspace = useAsyncData(loadConditionSensorRegistry, [], {
    isEmpty: () => false,
  });
  const [selectedId, setSelectedId] = useState("new");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [lifecycleBasis, setLifecycleBasis] = useState("");
  const [busy, setBusy] = useState<
    "save" | "decommission" | "reactivate" | null
  >(null);
  const [notice, setNotice] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  const selected = useMemo(
    () =>
      workspace.data?.sensors.find(
        (sensor) => sensor.sensorId === selectedId,
      ) ?? null,
    [selectedId, workspace.data?.sensors],
  );

  useEffect(() => {
    if (selected) {
      setDraft(fromSensor(selected));
      setLifecycleBasis("");
      return;
    }
    const firstAsset = workspace.data?.assets[0]?.assetId ?? "";
    setDraft({ ...EMPTY_DRAFT, assetId: firstAsset });
    setLifecycleBasis("");
  }, [selected, workspace.data?.assets]);

  async function run(
    kind: "save" | "decommission" | "reactivate",
    action: () => Promise<void>,
  ) {
    setBusy(kind);
    setNotice(null);
    try {
      await action();
      setNotice({
        kind: "ok",
        text:
          kind === "save"
            ? "Governed sensor configuration recorded with an immutable version receipt."
            : kind === "decommission"
              ? "Sensor decommissioned. Existing readings and diagnostic reports were preserved."
              : "Sensor reactivated with a new configuration-history receipt.",
      });
      await workspace.refetch();
    } catch (caught) {
      setNotice({
        kind: "error",
        text:
          caught instanceof Error
            ? caught.message
            : "The governed sensor action failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    await run("save", async () => {
      const result = await upsertConditionSensor({
        sensorId: selected?.sensorId,
        assetId: draft.assetId,
        sensorTag: draft.sensorTag,
        name: draft.name,
        signalType: draft.signalType,
        unit: draft.unit,
        detectionTechnique: draft.detectionTechnique || null,
        warningLimit: optionalNumber(draft.warningLimit),
        alarmLimit: optionalNumber(draft.alarmLimit),
        limitDirection: draft.limitDirection,
        sourceSystem: draft.sourceSystem || null,
        basis: draft.basis,
        expectedVersion: selected?.configurationVersion,
      });
      setSelectedId(result.sensorId);
    });
  }

  if (workspace.loading && !workspace.data) {
    return <LoadingState label="Loading governed sensor registry" />;
  }
  if (workspace.error && !workspace.data) {
    return <ErrorState message={workspace.error} onRetry={workspace.refetch} />;
  }

  const sensors = workspace.data?.sensors ?? [];
  const canManage = workspace.data?.canManage ?? false;

  return (
    <section
      data-testid="condition-sensor-registry"
      className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#07131a]"
      aria-labelledby="condition-sensor-registry-heading"
    >
      <div className="border-b border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_48%)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
              <Gauge className="h-4 w-4" aria-hidden /> Measurement governance
            </div>
            <h3
              id="condition-sensor-registry-heading"
              className="text-xl font-semibold text-white"
            >
              Condition sensor registry
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {workspace.data?.basis}
            </p>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-right">
            <div className="font-mono text-2xl text-white">
              {sensors.length}
            </div>
            <div className="text-xs uppercase tracking-wide text-slate-500">
              governed points
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-5 xl:grid-cols-[310px_minmax(0,1fr)]">
        <div className="space-y-3">
          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
            Measurement point
            <select
              aria-label="Registry sensor"
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm normal-case tracking-normal text-white"
            >
              <option value="new">+ Register a sensor</option>
              {sensors.map((sensor) => (
                <option key={sensor.sensorId} value={sensor.sensorId}>
                  {sensor.assetTag} · {sensor.sensorTag ?? sensor.name} ·{" "}
                  {sensor.registryStatus}
                </option>
              ))}
            </select>
          </label>

          {selected && (
            <div className="grid gap-2 rounded-xl border border-white/8 bg-white/[0.025] p-4 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Configuration</span>
                <span className="font-mono text-slate-200">
                  v{selected.configurationVersion}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Readings</span>
                <span className="font-mono text-slate-200">
                  {selected.readingCount.toLocaleString()}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Latest reading</span>
                <span className="text-slate-200">
                  {readableDate(selected.latestReadingAt)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Diagnostic reports</span>
                <span className="font-mono text-slate-200">
                  {selected.diagnosticReportCount}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">History receipts</span>
                <span className="font-mono text-slate-200">
                  {selected.historyCount}
                </span>
              </div>
              <div className="mt-1 border-t border-white/8 pt-3">
                <div className="flex items-center gap-2 text-slate-300">
                  <ShieldCheck className="h-4 w-4 text-cyan-300" aria-hidden />
                  Calibration
                </div>
                <p className="mt-1 text-slate-500">
                  {selected.calibration
                    ? `${selected.calibration.posture.replaceAll("_", " ")} · due ${readableDate(selected.calibration.dueOn)} · ${selected.calibration.certificateReference}`
                    : "No calibration evidence recorded"}
                </p>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-amber-400/15 bg-amber-400/[0.04] p-3 text-xs leading-5 text-amber-100/75">
            {workspace.data?.boundary}
          </div>
        </div>

        <form onSubmit={save} className="space-y-4">
          <fieldset
            disabled={
              !canManage || selected?.registryStatus === "decommissioned"
            }
            className="grid gap-4 md:grid-cols-2 disabled:opacity-60"
          >
            <label className="text-xs font-medium text-slate-400">
              Canonical asset
              <select
                required
                value={draft.assetId}
                disabled={Boolean(selected)}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    assetId: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white disabled:opacity-60"
              >
                <option value="">Select asset…</option>
                {(workspace.data?.assets ?? []).map((asset) => (
                  <option key={asset.assetId} value={asset.assetId}>
                    {asset.assetTag} · {asset.name}
                  </option>
                ))}
              </select>
            </label>
            <RegistryInput
              label="Sensor tag"
              value={draft.sensorTag}
              required
              onChange={(sensorTag) =>
                setDraft((current) => ({ ...current, sensorTag }))
              }
            />
            <RegistryInput
              label="Display name"
              value={draft.name}
              required
              onChange={(name) => setDraft((current) => ({ ...current, name }))}
            />
            <RegistryInput
              label="Signal type"
              value={draft.signalType}
              placeholder="vibration_velocity"
              required
              onChange={(signalType) =>
                setDraft((current) => ({ ...current, signalType }))
              }
            />
            <RegistryInput
              label="Engineering unit"
              value={draft.unit}
              placeholder="mm/s RMS"
              required
              onChange={(unit) => setDraft((current) => ({ ...current, unit }))}
            />
            <RegistryInput
              label="Detection technique"
              value={draft.detectionTechnique}
              placeholder="Vibration analysis"
              onChange={(detectionTechnique) =>
                setDraft((current) => ({ ...current, detectionTechnique }))
              }
            />
            <label className="text-xs font-medium text-slate-400">
              Limit direction
              <select
                value={draft.limitDirection}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    limitDirection: event.target.value as SensorLimitDirection,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white"
              >
                <option value="above">Higher is adverse</option>
                <option value="below">Lower is adverse</option>
              </select>
            </label>
            <RegistryInput
              label="Source system"
              value={draft.sourceSystem}
              placeholder="PI-HISTORIAN"
              onChange={(sourceSystem) =>
                setDraft((current) => ({ ...current, sourceSystem }))
              }
            />
            <RegistryInput
              label="Warning limit (optional)"
              type="number"
              value={draft.warningLimit}
              onChange={(warningLimit) =>
                setDraft((current) => ({ ...current, warningLimit }))
              }
            />
            <RegistryInput
              label="Alarm limit (optional)"
              type="number"
              value={draft.alarmLimit}
              onChange={(alarmLimit) =>
                setDraft((current) => ({ ...current, alarmLimit }))
              }
            />
            <label className="text-xs font-medium text-slate-400 md:col-span-2">
              Configuration basis
              <textarea
                required
                minLength={10}
                value={draft.basis}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    basis: event.target.value,
                  }))
                }
                placeholder="State the drawing, instrument index, engineering review or source record supporting this configuration."
                className="mt-1 min-h-20 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-slate-600"
              />
            </label>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3 border-t border-white/8 pt-4">
            <button
              type="submit"
              disabled={
                !canManage ||
                busy !== null ||
                selected?.registryStatus === "decommissioned"
              }
              className="rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-200 disabled:opacity-40"
            >
              {busy === "save"
                ? "Recording…"
                : selected
                  ? "Record new version"
                  : "Register sensor"}
            </button>
            <span className="text-xs text-slate-500">
              Limits are optional. SyncAI never invents a threshold.
            </span>
          </div>

          {selected && (
            <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                {selected.registryStatus === "decommissioned" ? (
                  <RotateCcw className="h-4 w-4 text-cyan-300" aria-hidden />
                ) : (
                  <Archive className="h-4 w-4 text-amber-300" aria-hidden />
                )}
                Lifecycle control
              </div>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Decommissioning blocks new readings but never deletes history or
                retained diagnostic reports. Reactivation creates another
                immutable configuration receipt.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  value={lifecycleBasis}
                  onChange={(event) => setLifecycleBasis(event.target.value)}
                  placeholder={
                    selected.registryStatus === "decommissioned"
                      ? "Reactivation basis (10+ characters)"
                      : "Decommissioning reason (10+ characters)"
                  }
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-slate-600"
                />
                <button
                  type="button"
                  disabled={
                    !canManage || busy !== null || lifecycleBasis.length < 10
                  }
                  onClick={() =>
                    selected.registryStatus === "decommissioned"
                      ? run("reactivate", async () => {
                          await reactivateConditionSensor({
                            sensorId: selected.sensorId,
                            basis: lifecycleBasis,
                            expectedVersion: selected.configurationVersion,
                          });
                          setLifecycleBasis("");
                        })
                      : run("decommission", async () => {
                          await decommissionConditionSensor({
                            sensorId: selected.sensorId,
                            reason: lifecycleBasis,
                            expectedVersion: selected.configurationVersion,
                          });
                          setLifecycleBasis("");
                        })
                  }
                  className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-40"
                >
                  {busy === "decommission" || busy === "reactivate"
                    ? "Recording…"
                    : selected.registryStatus === "decommissioned"
                      ? "Reactivate"
                      : "Decommission"}
                </button>
              </div>
            </div>
          )}

          {notice && (
            <p
              role="status"
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
                notice.kind === "ok"
                  ? "border-emerald-400/20 bg-emerald-400/5 text-emerald-200"
                  : "border-red-400/20 bg-red-400/5 text-red-200"
              }`}
            >
              {notice.kind === "ok" ? (
                <History className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              ) : (
                <Activity className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              )}
              {notice.text}
            </p>
          )}
        </form>
      </div>
    </section>
  );
}

function RegistryInput(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: "text" | "number";
}) {
  return (
    <label className="text-xs font-medium text-slate-400">
      {props.label}
      <input
        type={props.type ?? "text"}
        step={props.type === "number" ? "any" : undefined}
        required={props.required}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-slate-600"
      />
    </label>
  );
}
