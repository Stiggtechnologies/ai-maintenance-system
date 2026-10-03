import { useEffect, useMemo, useState, type FormEvent } from "react";
import { MapPin, Route, Ruler, ShieldCheck, TriangleAlert } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { defectDensity } from "../lib/asset-ontology";
import {
  listLinearAssetRoutes,
  listLinearRouteDefects,
  listOntologyAssets,
  listOntologyEvidence,
  recordLinearAssetRoute,
  recordLinearDefect,
  recordLinearSegment,
  type LinearRouteOption,
} from "../services/assetOntologyService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

type Mode = "route" | "section" | "defect";

const UNIT_OPTIONS: LinearRouteOption["measure_unit"][] = [
  "km",
  "m",
  "mi",
  "ft",
  "chain",
];

export function LinearAssetGovernancePanel({
  revision,
  onRecorded,
}: {
  revision: number;
  onRecorded: () => void;
}) {
  const assets = useAsyncData(listOntologyAssets, [revision]);
  const routes = useAsyncData(listLinearAssetRoutes, [revision]);
  const [mode, setMode] = useState<Mode>("route");
  const [assetId, setAssetId] = useState("");
  const [routeId, setRouteId] = useState("");
  const [evidenceItemId, setEvidenceItemId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [routeCode, setRouteCode] = useState("");
  const [measureUnit, setMeasureUnit] =
    useState<LinearRouteOption["measure_unit"]>("km");
  const [startMeasure, setStartMeasure] = useState("0");
  const [endMeasure, setEndMeasure] = useState("");
  const [description, setDescription] = useState("");
  const [basis, setBasis] = useState("");

  const [fromMeasure, setFromMeasure] = useState("");
  const [toMeasure, setToMeasure] = useState("");
  const [sectionAttributes, setSectionAttributes] = useState("");
  const [sectionBasis, setSectionBasis] = useState("");

  const [atMeasure, setAtMeasure] = useState("");
  const [defectType, setDefectType] = useState("");
  const [severity, setSeverity] = useState("");
  const [detectionMethod, setDetectionMethod] = useState("");
  const [detectedAt, setDetectedAt] = useState("");

  const linearAssets = useMemo(
    () =>
      (assets.data ?? []).filter(
        (asset) => asset.assignment?.class_key === "linear",
      ),
    [assets.data],
  );
  const selectedRoute = (routes.data ?? []).find(
    (route) => String(route.id) === routeId,
  );
  const defects = useAsyncData(
    () =>
      selectedRoute
        ? listLinearRouteDefects(selectedRoute.id)
        : Promise.resolve([]),
    [selectedRoute?.id, revision],
  );
  const density = useMemo(
    () =>
      selectedRoute
        ? defectDensity(
            selectedRoute.start_measure,
            selectedRoute.end_measure,
            defects.data ?? [],
            1,
          )
        : null,
    [defects.data, selectedRoute],
  );
  const contextAssetId = mode === "route" ? assetId : selectedRoute?.asset_id;
  const evidence = useAsyncData(
    () =>
      contextAssetId
        ? listOntologyEvidence(contextAssetId)
        : Promise.resolve([]),
    [contextAssetId, mode, revision],
  );

  useEffect(() => {
    setEvidenceItemId("");
    setMessage(null);
  }, [contextAssetId, mode]);

  if (assets.loading || routes.loading) {
    return <LoadingState label="Loading governed linear assets" />;
  }
  if (assets.error) {
    return <ErrorState message={assets.error} onRetry={assets.refetch} />;
  }
  if (routes.error) {
    return <ErrorState message={routes.error} onRetry={routes.refetch} />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "route") {
        await recordLinearAssetRoute({
          assetId,
          routeCode,
          measureUnit,
          startMeasure: Number(startMeasure),
          endMeasure: Number(endMeasure),
          description,
          basis,
          evidenceItemId,
        });
        setMessage(
          "Route identity and extent recorded from verified evidence. Engineering and operating determinations remain separate governed acts.",
        );
        setRouteCode("");
        setEndMeasure("");
        setDescription("");
        setBasis("");
      } else if (mode === "section") {
        await recordLinearSegment({
          routeId: Number(routeId),
          fromMeasure: Number(fromMeasure),
          toMeasure: Number(toMeasure),
          attributes: { observed: sectionAttributes.trim() },
          basis: sectionBasis,
          evidenceItemId,
        });
        setMessage(
          "Evidence-backed section recorded without asserting condition, capacity or an operating limit.",
        );
        setFromMeasure("");
        setToMeasure("");
        setSectionAttributes("");
        setSectionBasis("");
      } else {
        await recordLinearDefect({
          routeId: Number(routeId),
          atMeasure: Number(atMeasure),
          defectType,
          severity:
            severity === ""
              ? null
              : (severity as "minor" | "moderate" | "major" | "critical"),
          detectionMethod,
          detectedAt,
          evidenceItemId,
        });
        setMessage(
          "Observed defect recorded. SyncAI has not determined fitness for service, repair scope or operating restrictions.",
        );
        setAtMeasure("");
        setDefectType("");
        setSeverity("");
        setDetectionMethod("");
        setDetectedAt("");
      }
      await Promise.all([routes.refetch(), assets.refetch()]);
      onRecorded();
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "Could not record linear data",
      );
    } finally {
      setBusy(false);
    }
  }

  const routeBounds = selectedRoute
    ? `${selectedRoute.start_measure}–${selectedRoute.end_measure} ${selectedRoute.measure_unit}`
    : null;

  return (
    <section
      className="rounded-2xl border border-sky-400/15 bg-sky-400/4 p-5"
      aria-labelledby="linear-asset-governance-heading"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-sky-400/10 p-2 text-sky-300">
          <Route className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h3
            id="linear-asset-governance-heading"
            className="text-sm font-semibold text-white"
          >
            Governed linear asset model
          </h3>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-slate-400">
            Locate routes, evidence-backed sections and observed defects by
            measure. SyncAI preserves the length denominator instead of
            averaging a pipeline, road, rail line or transmission corridor into
            one misleading machine-style MTBF.
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2" role="tablist">
        {(
          [
            ["route", "Create route"],
            ["section", "Record section"],
            ["defect", "Record defect"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => setMode(value)}
            className={`rounded-lg border px-3 py-2 text-xs font-semibold ${
              mode === value
                ? "border-sky-300/40 bg-sky-300/10 text-sky-100"
                : "border-white/10 text-slate-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {message ? (
        <p className="mt-4 rounded-lg border border-sky-400/20 bg-sky-400/5 p-3 text-xs text-slate-200">
          {message}
        </p>
      ) : null}

      <form className="mt-5 grid gap-5 xl:grid-cols-[1fr_0.8fr]" onSubmit={submit}>
        <div className="space-y-3">
          {mode === "route" ? (
            <>
              <label className="block text-xs font-semibold text-slate-300">
                Governed linear asset
                <select
                  required
                  value={assetId}
                  onChange={(event) => setAssetId(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
                >
                  <option value="">Select an asset classified as linear</option>
                  {linearAssets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.name}{asset.tag ? ` · ${asset.tag}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              {linearAssets.length === 0 ? (
                <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-2 text-xs text-amber-100">
                  No asset carries the linear class. Use Governed asset
                  classification above with verified route or register evidence
                  first.
                </p>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
                <label className="block text-xs font-semibold text-slate-300">
                  Route code
                  <input
                    required
                    minLength={3}
                    maxLength={80}
                    value={routeCode}
                    onChange={(event) => setRouteCode(event.target.value)}
                    placeholder="PIPE-07-NORTH"
                    className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="block text-xs font-semibold text-slate-300">
                  Unit
                  <select
                    value={measureUnit}
                    onChange={(event) =>
                      setMeasureUnit(
                        event.target.value as LinearRouteOption["measure_unit"],
                      )
                    }
                    className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
                  >
                    {UNIT_OPTIONS.map((unit) => (
                      <option key={unit}>{unit}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Start measure"
                  value={startMeasure}
                  onChange={setStartMeasure}
                />
                <NumberField
                  label="End measure"
                  value={endMeasure}
                  onChange={setEndMeasure}
                />
              </div>
              <TextField
                label="Route description"
                value={description}
                onChange={setDescription}
                minLength={10}
                placeholder="Identify the physical corridor and endpoints."
              />
              <TextArea
                label="Extent basis and limitations"
                value={basis}
                onChange={setBasis}
                placeholder="Name the survey, drawing or register and any unresolved coordinate or extent limitation."
              />
            </>
          ) : (
            <>
              <label className="block text-xs font-semibold text-slate-300">
                Canonical route
                <select
                  required
                  value={routeId}
                  onChange={(event) => setRouteId(event.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
                >
                  <option value="">Select a route</option>
                  {(routes.data ?? []).map((route) => (
                    <option key={route.id} value={route.id}>
                      {route.route_code} · {route.start_measure}–
                      {route.end_measure} {route.measure_unit}
                    </option>
                  ))}
                </select>
              </label>
              {routeBounds ? (
                <p className="text-xs text-slate-500">
                  Accepted route bounds: {routeBounds}
                </p>
              ) : null}
              {mode === "section" ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <NumberField
                      label="Section from"
                      value={fromMeasure}
                      onChange={setFromMeasure}
                    />
                    <NumberField
                      label="Section to"
                      value={toMeasure}
                      onChange={setToMeasure}
                    />
                  </div>
                  <TextField
                    label="Observed section attributes"
                    value={sectionAttributes}
                    onChange={setSectionAttributes}
                    minLength={3}
                    placeholder="Material, coating, terrain, loading, span type…"
                  />
                  <TextArea
                    label="Section basis and limitations"
                    value={sectionBasis}
                    onChange={setSectionBasis}
                    placeholder="Name the evidence supporting the boundaries and attributes."
                  />
                </>
              ) : (
                <>
                  <NumberField
                    label="Defect location"
                    value={atMeasure}
                    onChange={setAtMeasure}
                  />
                  <TextField
                    label="Observed defect type"
                    value={defectType}
                    onChange={setDefectType}
                    minLength={3}
                    placeholder="Coating loss, crack, washout…"
                  />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block text-xs font-semibold text-slate-300">
                      Human-classified severity
                      <select
                        value={severity}
                        onChange={(event) => setSeverity(event.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
                      >
                        <option value="">Not stated</option>
                        <option value="minor">Minor</option>
                        <option value="moderate">Moderate</option>
                        <option value="major">Major</option>
                        <option value="critical">Critical</option>
                      </select>
                    </label>
                    <label className="block text-xs font-semibold text-slate-300">
                      Detected at
                      <input
                        type="datetime-local"
                        value={detectedAt}
                        onChange={(event) => setDetectedAt(event.target.value)}
                        className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
                      />
                    </label>
                  </div>
                  <TextField
                    label="Detection method"
                    value={detectionMethod}
                    onChange={setDetectionMethod}
                    minLength={5}
                    placeholder="ILI run, qualified inspection, patrol…"
                  />
                </>
              )}
            </>
          )}
        </div>

        <div className="space-y-3">
          <label className="block text-xs font-semibold text-slate-300">
            Verified canonical evidence
            <select
              required
              value={evidenceItemId}
              disabled={!contextAssetId || evidence.loading}
              onChange={(event) => setEvidenceItemId(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white disabled:opacity-45"
            >
              <option value="">
                {evidence.loading
                  ? "Loading verified evidence…"
                  : "Select applicable verified evidence"}
              </option>
              {(evidence.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.evidence_class ?? "UNCLASSIFIED"} · {item.description}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-xl border border-white/8 bg-black/10 p-4">
            <h4 className="flex items-center gap-2 text-xs font-semibold text-white">
              <Ruler className="h-4 w-4 text-sky-300" aria-hidden />
              Linear mathematics boundary
            </h4>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              Route length is location, not exposure by itself. A failure rate
              requires verified length-time exposure such as km-year; defect
              density uses the recorded route length and preserves hotspots.
            </p>
            {density && selectedRoute ? (
              <div className="mt-3 border-t border-white/8 pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {selectedRoute.route_code} · live density view
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-300">
                  {density.reason}
                </p>
                {density.bands.length > 0 ? (
                  <div
                    className="mt-3 flex h-10 items-end gap-0.5"
                    role="img"
                    aria-label={`Defect density along ${selectedRoute.route_code}`}
                  >
                    {density.bands.map((band) => {
                      const peak = Math.max(
                        ...density.bands.map((item) => item.densityPerUnit),
                        1,
                      );
                      return (
                        <div
                          key={band.fromMeasure}
                          title={`${band.fromMeasure}–${band.toMeasure} ${selectedRoute.measure_unit}: ${band.defectCount} open defect(s)`}
                          className="flex h-full flex-1 items-end"
                        >
                          <span
                            className="block w-full rounded-t bg-sky-300/60"
                            style={{
                              height: `${Math.max(4, (band.densityPerUnit / peak) * 100)}%`,
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
            <h4 className="flex items-center gap-2 text-xs font-semibold text-amber-100">
              <TriangleAlert className="h-4 w-4" aria-hidden />
              Authority retained by people
            </h4>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              These records do not establish structural or pressure capacity,
              fitness for service, legal loads, operating restrictions, repair
              completion, a work order, recommendation or approval. Those
              determinations stay in their canonical governed workflows.
            </p>
          </div>

          <button
            type="submit"
            disabled={busy || !contextAssetId || !evidenceItemId}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-400 px-4 py-2 text-xs font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {mode === "defect" ? (
              <MapPin className="h-4 w-4" aria-hidden />
            ) : (
              <ShieldCheck className="h-4 w-4" aria-hidden />
            )}
            {busy
              ? "Recording…"
              : mode === "route"
                ? "Record governed route"
                : mode === "section"
                  ? "Record governed section"
                  : "Record observed defect"}
          </button>
        </div>
      </form>
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-300">
      {label}
      <input
        required
        type="number"
        step="any"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  minLength,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  minLength: number;
  placeholder: string;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-300">
      {label}
      <input
        required
        minLength={minLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="block text-xs font-semibold text-slate-300">
      {label}
      <textarea
        required
        minLength={20}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1.5 min-h-24 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
      />
    </label>
  );
}
