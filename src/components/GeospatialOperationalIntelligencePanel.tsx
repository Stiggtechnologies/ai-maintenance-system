import { useCallback, useEffect, useState } from "react";
import { Map, MapPinned, Route, ShieldCheck } from "lucide-react";
import {
  getGeospatialOperationalWorkspace,
  getGeospatialReferences,
  recordGeospatialFeature,
  recordGeospatialOperationalAssessment,
  verifyGeospatialFeature,
  verifyGeospatialOperationalAssessment,
  type GeospatialAssessmentType,
  type GeospatialFeatureType,
  type GeospatialReferences,
  type GeospatialWorkspace,
} from "../services/geospatialOperationalIntelligenceService";

const FEATURE_TYPES: GeospatialFeatureType[] = [
  "site",
  "asset",
  "linear_route",
  "access_route",
  "hazard_zone",
  "weather_cell",
  "receptor",
  "logistics_hub",
  "spares_region",
  "failure_cluster",
];
const ASSESSMENT_TYPES: GeospatialAssessmentType[] = [
  "weather_hazard_exposure",
  "access_route",
  "crew_travel",
  "remote_logistics",
  "regional_spares",
  "failure_clustering",
  "hazard_overlay",
  "linear_reference",
];

const label = (value: string) => value.replaceAll("_", " ");

export function GeospatialOperationalIntelligencePanel() {
  const [workspace, setWorkspace] = useState<GeospatialWorkspace | null>(null);
  const [refs, setRefs] = useState<GeospatialReferences | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [featureType, setFeatureType] =
    useState<GeospatialFeatureType>("access_route");
  const [featureKey, setFeatureKey] = useState("");
  const [featureName, setFeatureName] = useState("");
  const [geometryType, setGeometryType] = useState("LineString");
  const [coordinates, setCoordinates] = useState("[]");
  const [sourceSystem, setSourceSystem] = useState("");
  const [sourceReference, setSourceReference] = useState("");
  const [observedAt, setObservedAt] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [featureEvidence, setFeatureEvidence] = useState("");
  const [featureMissing, setFeatureMissing] = useState("");
  const [assessmentType, setAssessmentType] =
    useState<GeospatialAssessmentType>("weather_hazard_exposure");
  const [assessmentTitle, setAssessmentTitle] = useState("");
  const [assetId, setAssetId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [recommendationId, setRecommendationId] = useState("");
  const [inputFeatureId, setInputFeatureId] = useState("");
  const [crewId, setCrewId] = useState("");
  const [materialId, setMaterialId] = useState("");
  const [stockSiteId, setStockSiteId] = useState("");
  const [distance, setDistance] = useState("");
  const [distanceUnit, setDistanceUnit] = useState("km");
  const [travelMinutes, setTravelMinutes] = useState("");
  const [rating, setRating] = useState("unknown");
  const [basis, setBasis] = useState("");
  const [conclusion, setConclusion] = useState("");
  const [assessmentEvidence, setAssessmentEvidence] = useState("");
  const [assessmentMissing, setAssessmentMissing] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    try {
      const [nextWorkspace, nextRefs] = await Promise.all([
        getGeospatialOperationalWorkspace(),
        getGeospatialReferences(),
      ]);
      setWorkspace(nextWorkspace);
      setRefs(nextRefs);
      setError("");
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await reload();
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="space-y-5 rounded-2xl border border-white/10 bg-slate-950/50 p-5"
      aria-labelledby="geo-intelligence-heading"
    >
      <div className="flex gap-3">
        <MapPinned
          className="mt-0.5 h-5 w-5 shrink-0 text-signal-cyan"
          aria-hidden
        />
        <div>
          <h2
            id="geo-intelligence-heading"
            className="text-lg font-semibold text-white"
          >
            Geospatial operational intelligence
          </h2>
          <p className="mt-1 max-w-4xl text-sm leading-relaxed text-slate-300">
            Put verified GIS, linear-reference, weather, hazard, access, travel,
            logistics, spares and failure-cluster evidence beside a governed
            decision.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-amber-200">
            No map position, exposure, journey or stock conclusion is inferred.
            SyncAI records supplied evidence and recommendations only; people
            still approve routes, dispatch crews and release work.
          </p>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200"
        >
          {error}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <form
          className="space-y-3 rounded-xl border border-white/8 bg-white/[0.02] p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              let parsed: unknown;
              try {
                parsed = JSON.parse(coordinates);
              } catch {
                throw new Error("Coordinates must be valid JSON.");
              }
              await recordGeospatialFeature({
                feature_type: featureType,
                feature_key: featureKey,
                name: featureName,
                geometry_type: geometryType,
                geometry: { type: geometryType, coordinates: parsed },
                source_system: sourceSystem,
                source_reference: sourceReference,
                observed_at: new Date(observedAt).toISOString(),
                valid_until: validUntil
                  ? new Date(validUntil).toISOString()
                  : undefined,
                data_quality: "good",
                evidence_item_ids: featureEvidence ? [featureEvidence] : [],
                missing_evidence: featureMissing ? [featureMissing] : [],
              });
              setFeatureKey("");
              setFeatureName("");
              setCoordinates("[]");
              setSourceReference("");
              setFeatureMissing("");
            });
          }}
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Map className="h-4 w-4 text-signal-cyan" />
            Record source GIS feature
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <select
              aria-label="Feature type"
              value={featureType}
              onChange={(e) =>
                setFeatureType(e.target.value as GeospatialFeatureType)
              }
              className="rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
            >
              {FEATURE_TYPES.map((x) => (
                <option key={x} value={x}>
                  {label(x)}
                </option>
              ))}
            </select>
            <select
              aria-label="Geometry type"
              value={geometryType}
              onChange={(e) => setGeometryType(e.target.value)}
              className="rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
            >
              {[
                "Point",
                "LineString",
                "Polygon",
                "MultiPoint",
                "MultiLineString",
                "MultiPolygon",
              ].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </div>
          <input
            required
            value={featureKey}
            onChange={(e) => setFeatureKey(e.target.value)}
            placeholder="Stable feature key"
            className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          />
          <input
            required
            value={featureName}
            onChange={(e) => setFeatureName(e.target.value)}
            placeholder="Feature name"
            className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          />
          <textarea
            required
            value={coordinates}
            onChange={(e) => setCoordinates(e.target.value)}
            placeholder="Source coordinates, e.g. [[-113.5,53.5],[-113.4,53.6]]"
            className="min-h-20 w-full rounded-lg border border-white/10 bg-slate-900 p-2 font-mono text-xs text-white"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              required
              value={sourceSystem}
              onChange={(e) => setSourceSystem(e.target.value)}
              placeholder="GIS/source system"
              className="rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
            />
            <input
              required
              value={sourceReference}
              onChange={(e) => setSourceReference(e.target.value)}
              placeholder="Source reference/version"
              className="rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-400">
              Observed at
              <input
                required
                type="datetime-local"
                value={observedAt}
                onChange={(e) => setObservedAt(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
              />
            </label>
            <label className="text-xs text-slate-400">
              Valid until
              <input
                type="datetime-local"
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
              />
            </label>
          </div>
          <select
            aria-label="Verified feature evidence"
            value={featureEvidence}
            onChange={(e) => setFeatureEvidence(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          >
            <option value="">No verified evidence selected</option>
            {refs?.evidence.map((x) => (
              <option key={x.id} value={x.id}>
                {x.description}
              </option>
            ))}
          </select>
          <input
            value={featureMissing}
            onChange={(e) => setFeatureMissing(e.target.value)}
            placeholder="Or explicitly name missing source evidence"
            className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          />
          <button
            disabled={busy}
            className="rounded-lg bg-signal-cyan px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
          >
            Record draft feature
          </button>
        </form>

        <form
          className="space-y-3 rounded-xl border border-white/8 bg-white/[0.02] p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              await recordGeospatialOperationalAssessment({
                assessment_type: assessmentType,
                title: assessmentTitle,
                asset_id: assetId || undefined,
                site_id: siteId || undefined,
                recommendation_id: recommendationId || undefined,
                input_feature_ids: inputFeatureId ? [inputFeatureId] : [],
                crew_template_id: crewId || undefined,
                material_id: materialId || undefined,
                stock_site_id: stockSiteId || undefined,
                access_route_feature_id:
                  assessmentType === "access_route" ||
                  assessmentType === "crew_travel" ||
                  assessmentType === "remote_logistics"
                    ? inputFeatureId || undefined
                    : undefined,
                observed_distance: distance || undefined,
                distance_unit: distance ? distanceUnit : undefined,
                observed_travel_minutes: travelMinutes || undefined,
                exposure_rating: rating,
                basis,
                conclusion,
                evidence_item_ids: assessmentEvidence
                  ? [assessmentEvidence]
                  : [],
                missing_evidence: assessmentMissing ? [assessmentMissing] : [],
              });
              setAssessmentTitle("");
              setBasis("");
              setConclusion("");
              setAssessmentMissing("");
            });
          }}
        >
          <h3 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Route className="h-4 w-4 text-signal-cyan" />
            Record decision context
          </h3>
          <select
            aria-label="Assessment type"
            value={assessmentType}
            onChange={(e) =>
              setAssessmentType(e.target.value as GeospatialAssessmentType)
            }
            className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          >
            {ASSESSMENT_TYPES.map((x) => (
              <option key={x} value={x}>
                {label(x)}
              </option>
            ))}
          </select>
          <input
            required
            value={assessmentTitle}
            onChange={(e) => setAssessmentTitle(e.target.value)}
            placeholder="Assessment title"
            className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              aria-label="Assessment asset"
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              className="rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
            >
              <option value="">Any asset</option>
              {refs?.assets.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Assessment site"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className="rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
            >
              <option value="">Any site</option>
              {refs?.sites.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
          <select
            aria-label="Canonical recommendation"
            value={recommendationId}
            onChange={(e) => setRecommendationId(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          >
            <option value="">No recommendation link</option>
            {refs?.recommendations.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
          </select>
          <select
            aria-label="Verified geospatial input"
            value={inputFeatureId}
            onChange={(e) => setInputFeatureId(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          >
            <option value="">No verified feature selected</option>
            {workspace?.features
              .filter((x) => x.status === "verified")
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} · {label(x.feature_type)}
                </option>
              ))}
          </select>
          {assessmentType === "crew_travel" && (
            <select
              aria-label="Crew template"
              value={crewId}
              onChange={(e) => setCrewId(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
            >
              <option value="">Choose canonical crew</option>
              {refs?.crews.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
            </select>
          )}
          {assessmentType === "regional_spares" && (
            <div className="grid grid-cols-2 gap-2">
              <select
                aria-label="Material"
                value={materialId}
                onChange={(e) => setMaterialId(e.target.value)}
                className="rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
              >
                <option value="">Choose material</option>
                {refs?.materials.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.material_code}
                  </option>
                ))}
              </select>
              <select
                aria-label="Stock site"
                value={stockSiteId}
                onChange={(e) => setStockSiteId(e.target.value)}
                className="rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
              >
                <option value="">Choose stock site</option>
                {refs?.sites.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <input
              type="number"
              min="0"
              step="any"
              value={distance}
              onChange={(e) => setDistance(e.target.value)}
              placeholder="Observed distance"
              className="rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
            />
            <input
              value={distanceUnit}
              onChange={(e) => setDistanceUnit(e.target.value)}
              placeholder="Unit"
              className="rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
            />
            <input
              type="number"
              min="0"
              value={travelMinutes}
              onChange={(e) => setTravelMinutes(e.target.value)}
              placeholder="Observed minutes"
              className="rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
            />
          </div>
          <select
            aria-label="Exposure rating"
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          >
            {["unknown", "none", "low", "medium", "high", "critical"].map(
              (x) => (
                <option key={x}>{x}</option>
              ),
            )}
          </select>
          <textarea
            required
            minLength={20}
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
            placeholder="Evidence and calculation basis"
            className="min-h-20 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          />
          <textarea
            required
            minLength={20}
            value={conclusion}
            onChange={(e) => setConclusion(e.target.value)}
            placeholder="Bounded conclusion and limitations"
            className="min-h-20 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          />
          <select
            aria-label="Assessment evidence"
            value={assessmentEvidence}
            onChange={(e) => setAssessmentEvidence(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          >
            <option value="">No verified evidence selected</option>
            {refs?.evidence.map((x) => (
              <option key={x.id} value={x.id}>
                {x.description}
              </option>
            ))}
          </select>
          <input
            value={assessmentMissing}
            onChange={(e) => setAssessmentMissing(e.target.value)}
            placeholder="Or explicitly name missing decision evidence"
            className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          />
          <button
            disabled={busy}
            className="rounded-lg bg-signal-cyan px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
          >
            Record draft assessment
          </button>
        </form>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-white">Source features</h3>
          {workspace?.features.length ? (
            workspace.features.map((feature) => (
              <article
                key={feature.id}
                className="rounded-lg border border-white/8 p-3 text-sm"
              >
                <div className="flex justify-between gap-3">
                  <span className="font-medium text-white">{feature.name}</span>
                  <span className="text-xs uppercase text-slate-400">
                    {feature.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {label(feature.feature_type)} · {feature.source_system} ·{" "}
                  {feature.source_reference}
                </p>
                {feature.status === "draft" && (
                  <div className="mt-2 flex gap-2">
                    <input
                      aria-label={`Review ${feature.name}`}
                      value={reviewNotes[feature.id] ?? ""}
                      onChange={(e) =>
                        setReviewNotes((x) => ({
                          ...x,
                          [feature.id]: e.target.value,
                        }))
                      }
                      placeholder="Independent verification note"
                      className="min-w-0 flex-1 rounded border border-white/10 bg-slate-900 p-2 text-xs text-white"
                    />
                    <button
                      disabled={busy}
                      type="button"
                      onClick={() =>
                        void act(() =>
                          verifyGeospatialFeature(
                            feature.id,
                            reviewNotes[feature.id] ?? "",
                          ),
                        )
                      }
                      className="rounded border border-emerald-400/30 px-2 text-xs text-emerald-200"
                    >
                      <ShieldCheck className="inline h-3 w-3" /> Verify
                    </button>
                  </div>
                )}
              </article>
            ))
          ) : (
            <p className="text-sm text-slate-500">
              No source features recorded.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-white">
            Operational assessments
          </h3>
          {workspace?.assessments.length ? (
            workspace.assessments.map((assessment) => (
              <article
                key={assessment.id}
                className="rounded-lg border border-white/8 p-3 text-sm"
              >
                <div className="flex justify-between gap-3">
                  <span className="font-medium text-white">
                    {assessment.title}
                  </span>
                  <span className="text-xs uppercase text-slate-400">
                    {assessment.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  {label(assessment.assessment_type)} ·{" "}
                  {assessment.exposure_rating}
                </p>
                <p className="mt-2 text-xs leading-relaxed text-slate-300">
                  {assessment.conclusion}
                </p>
                {assessment.status === "draft" && (
                  <div className="mt-2 flex gap-2">
                    <input
                      aria-label={`Review ${assessment.title}`}
                      value={reviewNotes[assessment.id] ?? ""}
                      onChange={(e) =>
                        setReviewNotes((x) => ({
                          ...x,
                          [assessment.id]: e.target.value,
                        }))
                      }
                      placeholder="Independent verification note"
                      className="min-w-0 flex-1 rounded border border-white/10 bg-slate-900 p-2 text-xs text-white"
                    />
                    <button
                      disabled={busy}
                      type="button"
                      onClick={() =>
                        void act(() =>
                          verifyGeospatialOperationalAssessment(
                            assessment.id,
                            reviewNotes[assessment.id] ?? "",
                          ),
                        )
                      }
                      className="rounded border border-emerald-400/30 px-2 text-xs text-emerald-200"
                    >
                      <ShieldCheck className="inline h-3 w-3" /> Verify
                    </button>
                  </div>
                )}
              </article>
            ))
          ) : (
            <p className="text-sm text-slate-500">
              No geospatial decision assessments recorded.
            </p>
          )}
        </div>
      </div>
      <p className="text-xs text-slate-500">{workspace?.basis}</p>
    </section>
  );
}
