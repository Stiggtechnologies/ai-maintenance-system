import { useCallback, useEffect, useState } from "react";
import { CloudLightning, ShieldCheck } from "lucide-react";
import {
  CLIMATE_DECISION_FAMILIES,
  CLIMATE_EXPOSURE_HAZARDS,
  createClimateExposure,
  getClimateExposureReferences,
  getClimateExposureWorkspace,
  recordClimateHazard,
  reviewClimateExposure,
  type ClimateDecisionFamily,
  type ClimateExposureHazard,
  type ClimateExposureReferences,
  type ClimateExposureWorkspace,
} from "../services/climateHazardExposureService";

const label = (value: string) => value.replaceAll("_", " ");
const emptyEffects = () =>
  Object.fromEntries(CLIMATE_DECISION_FAMILIES.map((x) => [x, ""])) as Record<
    ClimateDecisionFamily,
    string
  >;

export function ClimateHazardExposurePanel() {
  const [workspace, setWorkspace] = useState<ClimateExposureWorkspace | null>(
    null,
  );
  const [refs, setRefs] = useState<ClimateExposureReferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [assessmentId, setAssessmentId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [assessmentRef, setAssessmentRef] = useState("");
  const [basis, setBasis] = useState("");
  const [sourceAsOf, setSourceAsOf] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [evidenceId, setEvidenceId] = useState("");
  const [featureId, setFeatureId] = useState("");
  const [missingEvidence, setMissingEvidence] = useState("");
  const [hazard, setHazard] = useState<ClimateExposureHazard>("heat");
  const [futureCondition, setFutureCondition] = useState("");
  const [exposure, setExposure] = useState("");
  const [response, setResponse] = useState("");
  const [residualGap, setResidualGap] = useState("");
  const [effects, setEffects] = useState(emptyEffects);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    try {
      const [nextWorkspace, nextRefs] = await Promise.all([
        getClimateExposureWorkspace(),
        getClimateExposureReferences(),
      ]);
      setWorkspace(nextWorkspace);
      setRefs(nextRefs);
      const firstDraft = nextWorkspace.assessments.find(
        (x) => x.status === "draft",
      );
      if (firstDraft) setAssessmentId((current) => current || firstDraft.id);
      setError("");
    } catch (nextError) {
      setError(
        nextError instanceof Error ? nextError.message : String(nextError),
      );
    }
  }, []);

  useEffect(() => void reload(), [reload]);

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
      aria-labelledby="climate-exposure-heading"
    >
      <div className="flex gap-3">
        <CloudLightning
          className="mt-0.5 h-5 w-5 shrink-0 text-signal-cyan"
          aria-hidden
        />
        <div>
          <h2
            id="climate-exposure-heading"
            className="text-lg font-semibold text-white"
          >
            Natural-hazard and climate exposure
          </h2>
          <p className="mt-1 max-w-4xl text-sm text-slate-300">
            Evaluate all thirteen enterprise hazards against verified evidence,
            then show how each may affect design, maintenance intervals, spares,
            emergency plans and renewal.
          </p>
          <p className="mt-2 text-xs text-amber-200">
            SyncAI does not invent projections or approve decisions. Independent
            review confirms evidence completeness only; accountable people
            retain every operational authority.
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
              const result = (await createClimateExposure({
                asset_id: assetId || undefined,
                site_id: siteId || undefined,
                assessment_ref: assessmentRef,
                future_conditions_basis: basis,
                source_as_of: new Date(sourceAsOf).toISOString(),
                valid_until: validUntil
                  ? new Date(validUntil).toISOString()
                  : undefined,
                evidence_item_ids: evidenceId ? [evidenceId] : [],
                geospatial_feature_ids: featureId ? [featureId] : [],
                missing_evidence: missingEvidence ? [missingEvidence] : [],
              })) as { assessment_id: string };
              setAssessmentId(result.assessment_id);
              setAssessmentRef("");
              setBasis("");
              setMissingEvidence("");
            });
          }}
        >
          <h3 className="text-sm font-semibold text-white">
            Open a governed assessment
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <select
              aria-label="Asset"
              value={assetId}
              onChange={(e) => setAssetId(e.target.value)}
              className="rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
            >
              <option value="">Asset (optional)</option>
              {refs?.assets.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Site"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              className="rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
            >
              <option value="">Site (optional)</option>
              {refs?.sites.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </div>
          <input
            required
            value={assessmentRef}
            onChange={(e) => setAssessmentRef(e.target.value)}
            placeholder="Assessment reference"
            className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          />
          <textarea
            required
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
            placeholder="Source, scenario and time-horizon basis"
            className="min-h-20 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              required
              type="datetime-local"
              aria-label="Source observed at"
              value={sourceAsOf}
              onChange={(e) => setSourceAsOf(e.target.value)}
              className="rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
            />
            <input
              type="datetime-local"
              aria-label="Valid until"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
              className="rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
            />
          </div>
          <select
            aria-label="Verified evidence"
            value={evidenceId}
            onChange={(e) => setEvidenceId(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          >
            <option value="">Verified evidence (or name a gap)</option>
            {refs?.evidence.map((x) => (
              <option key={x.id} value={x.id}>
                {x.description}
              </option>
            ))}
          </select>
          <select
            aria-label="Verified geospatial feature"
            value={featureId}
            onChange={(e) => setFeatureId(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          >
            <option value="">Verified map/hazard layer (optional)</option>
            {refs?.features.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {label(x.feature_type)}
              </option>
            ))}
          </select>
          <input
            value={missingEvidence}
            onChange={(e) => setMissingEvidence(e.target.value)}
            placeholder="Missing evidence (explicit gap)"
            className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          />
          <button
            disabled={busy || (!assetId && !siteId)}
            className="rounded-lg bg-signal-cyan px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
          >
            Create draft
          </button>
        </form>

        <form
          className="space-y-3 rounded-xl border border-white/8 bg-white/[0.02] p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              await recordClimateHazard(assessmentId, {
                hazard,
                future_condition: futureCondition,
                exposure_statement: exposure,
                design_response: response,
                residual_gap: residualGap,
                decision_effects: effects,
                evidence_item_id: evidenceId,
                geospatial_feature_ids: featureId ? [featureId] : [],
                missing_evidence: missingEvidence ? [missingEvidence] : [],
              });
              setFutureCondition("");
              setExposure("");
              setResponse("");
              setResidualGap("");
              setEffects(emptyEffects());
            });
          }}
        >
          <h3 className="text-sm font-semibold text-white">
            Record one hazard and its decision effects
          </h3>
          <select
            required
            aria-label="Draft assessment"
            value={assessmentId}
            onChange={(e) => setAssessmentId(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          >
            <option value="">Select a draft assessment</option>
            {workspace?.assessments
              .filter((x) => x.status === "draft")
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.assessment_ref} · {x.missing_hazards.length} hazards
                  missing
                </option>
              ))}
          </select>
          <select
            aria-label="Hazard"
            value={hazard}
            onChange={(e) => setHazard(e.target.value as ClimateExposureHazard)}
            className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          >
            {CLIMATE_EXPOSURE_HAZARDS.map((x) => (
              <option key={x} value={x}>
                {label(x)}
              </option>
            ))}
          </select>
          <textarea
            required
            value={futureCondition}
            onChange={(e) => setFutureCondition(e.target.value)}
            placeholder="Evidence-backed future condition"
            className="min-h-16 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          />
          <textarea
            required
            value={exposure}
            onChange={(e) => setExposure(e.target.value)}
            placeholder="How this asset/site is exposed"
            className="min-h-16 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          />
          <textarea
            required
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder="Engineering response under consideration"
            className="min-h-16 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          />
          {CLIMATE_DECISION_FAMILIES.map((family) => (
            <textarea
              required
              key={family}
              value={effects[family]}
              onChange={(e) =>
                setEffects((current) => ({
                  ...current,
                  [family]: e.target.value,
                }))
              }
              placeholder={`${label(family)} effect (or evidence-backed no change)`}
              className="min-h-14 w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
            />
          ))}
          <input
            required
            value={residualGap}
            onChange={(e) => setResidualGap(e.target.value)}
            placeholder="Residual uncertainty or gap"
            className="w-full rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
          />
          <button
            disabled={busy || !assessmentId || !evidenceId}
            className="rounded-lg bg-signal-cyan px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
          >
            Record hazard
          </button>
        </form>
      </div>

      <div className="space-y-3">
        {workspace?.assessments.map((assessment) => (
          <article
            key={assessment.id}
            className="rounded-xl border border-white/8 bg-white/[0.02] p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-white">
                  {assessment.assessment_ref} · revision {assessment.revision}
                </h3>
                <p className="mt-1 text-xs text-slate-400">
                  {assessment.hazards.length}/13 hazards · {assessment.status}
                </p>
              </div>
              <span
                className={`rounded-full px-2 py-1 text-xs ${assessment.status === "reviewed" ? "bg-emerald-400/15 text-emerald-200" : "bg-amber-400/15 text-amber-200"}`}
              >
                {assessment.status}
              </span>
            </div>
            <p className="mt-3 text-sm text-slate-300">
              {assessment.future_conditions_basis}
            </p>
            {assessment.missing_hazards.length > 0 && (
              <p className="mt-2 text-xs text-amber-200">
                Missing: {assessment.missing_hazards.map(label).join(", ")}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {assessment.hazards.map((x) => (
                <span
                  key={x.hazard}
                  title={x.exposure_statement}
                  className="rounded-full border border-white/10 px-2 py-1 text-xs text-slate-300"
                >
                  {label(x.hazard)}
                </span>
              ))}
            </div>
            {assessment.status === "draft" && (
              <div className="mt-4 flex gap-2">
                <input
                  value={reviewNotes[assessment.id] ?? ""}
                  onChange={(e) =>
                    setReviewNotes((current) => ({
                      ...current,
                      [assessment.id]: e.target.value,
                    }))
                  }
                  placeholder="Independent review method and conclusion"
                  className="min-w-0 flex-1 rounded-lg border border-white/10 bg-slate-900 p-2 text-sm text-white"
                />
                <button
                  disabled={busy || assessment.missing_hazards.length > 0}
                  onClick={() =>
                    void act(() =>
                      reviewClimateExposure(
                        assessment.id,
                        reviewNotes[assessment.id] ?? "",
                      ),
                    )
                  }
                  className="flex items-center gap-2 rounded-lg border border-emerald-400/30 px-3 py-2 text-sm text-emerald-200 disabled:opacity-40"
                >
                  <ShieldCheck className="h-4 w-4" />
                  Review
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
