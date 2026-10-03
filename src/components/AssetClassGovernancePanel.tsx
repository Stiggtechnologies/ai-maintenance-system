import {
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Calculator, FileCheck2, Landmark, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { useAsyncData } from "../hooks/useAsyncData";
import { normaliseRate, type ClassProfile } from "../lib/asset-ontology";
import {
  assignAssetClassProfile,
  listOntologyAssets,
  listOntologyEvidence,
} from "../services/assetOntologyService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

interface ProfileRow extends ClassProfile {
  registerRef: string;
  identityBasis: string;
  conditionBasis: string;
  assetCount: number;
}

export function AssetClassGovernancePanel({
  profiles,
  onAssigned,
}: {
  profiles: ProfileRow[];
  onAssigned: () => void;
}) {
  const assets = useAsyncData(listOntologyAssets, []);
  const [assetId, setAssetId] = useState("");
  const [classKey, setClassKey] = useState("");
  const profile = profiles.find((candidate) => candidate.classKey === classKey);
  const evidence = useAsyncData(
    () => (assetId ? listOntologyEvidence(assetId) : Promise.resolve([])),
    [assetId],
  );
  const [evidenceItemId, setEvidenceItemId] = useState("");
  const [basis, setBasis] = useState("");
  const [failureCount, setFailureCount] = useState("");
  const [exposure, setExposure] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setFailureCount("");
    setExposure("");
  }, [classKey]);

  const rate = useMemo(() => {
    if (!profile) return null;
    if (
      profile.measurementBasis !== "structure" &&
      profile.measurementBasis !== "natural" &&
      (failureCount.trim() === "" || exposure.trim() === "")
    ) {
      return null;
    }
    return normaliseRate(
      profile.measurementBasis,
      Number(failureCount || 0),
      Number(exposure || 0),
      profile.exposureUnit,
    );
  }, [exposure, failureCount, profile]);

  if (assets.loading)
    return <LoadingState label="Loading governed asset classes" />;
  if (assets.error) {
    return <ErrorState message={assets.error} onRetry={assets.refetch} />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await assignAssetClassProfile({
        assetId,
        classKey,
        basis,
        evidenceItemId,
      });
      setMessage(
        "Asset class recorded from verified evidence. Condition and engineering determinations remain separate governed acts.",
      );
      await assets.refetch();
      onAssigned();
    } catch (caught) {
      setMessage(
        caught instanceof Error
          ? caught.message
          : "Could not assign asset class",
      );
    } finally {
      setBusy(false);
    }
  }

  const isStructure = profile?.measurementBasis === "structure";

  function selectAsset(event: ChangeEvent<HTMLSelectElement>) {
    const nextAssetId = event.target.value;
    const nextAsset = (assets.data ?? []).find(
      (asset) => asset.id === nextAssetId,
    );
    setAssetId(nextAssetId);
    setClassKey(nextAsset?.assignment?.class_key ?? "");
    setBasis(nextAsset?.assignment?.basis ?? "");
    setEvidenceItemId("");
    setMessage(null);
  }

  return (
    <section
      className="rounded-2xl border border-cyan-400/15 bg-cyan-400/4 p-5"
      aria-labelledby="asset-class-governance-heading"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-cyan-400/10 p-2 text-cyan-300">
          <Landmark className="h-5 w-5" aria-hidden />
        </div>
        <div>
          <h3
            id="asset-class-governance-heading"
            className="text-sm font-semibold text-white"
          >
            Governed asset classification
          </h3>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-slate-400">
            A named human maps a canonical asset to the analysis basis supported
            by verified evidence. Classification selects valid mathematics; it
            does not assert condition, structural capacity, safety or approval.
          </p>
        </div>
      </div>

      {message ? (
        <p className="mt-4 rounded-lg border border-cyan-400/20 bg-cyan-400/5 p-3 text-xs text-slate-200">
          {message}
        </p>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <form className="space-y-3" onSubmit={submit}>
          <label className="block text-xs font-semibold text-slate-300">
            Canonical asset
            <select
              required
              value={assetId}
              onChange={selectAsset}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
            >
              <option value="">Select an asset</option>
              {(assets.data ?? []).map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                  {asset.tag ? ` · ${asset.tag}` : ""}
                  {asset.assignment
                    ? ` · ${asset.assignment.class_key.replaceAll("_", " ")}`
                    : " · unclassified"}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-semibold text-slate-300">
            Class profile
            <select
              required
              value={classKey}
              onChange={(event) => setClassKey(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
            >
              <option value="">Select a governed profile</option>
              {profiles.map((candidate) => (
                <option key={candidate.classKey} value={candidate.classKey}>
                  {candidate.label} · {candidate.measurementBasis}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-semibold text-slate-300">
            Verified canonical evidence
            <select
              required
              value={evidenceItemId}
              disabled={!assetId || evidence.loading}
              onChange={(event) => setEvidenceItemId(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white disabled:opacity-45"
            >
              <option value="">
                {evidence.loading
                  ? "Loading verified evidence…"
                  : "Select verified evidence"}
              </option>
              {(evidence.data ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.evidence_class ?? "UNCLASSIFIED"} · {item.description}
                </option>
              ))}
            </select>
          </label>
          {assetId &&
          !evidence.loading &&
          (evidence.data ?? []).length === 0 ? (
            <p className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-2 text-xs text-amber-200">
              No applicable verified evidence is available. Record and
              verify measured, inspected, documented or expert evidence before
              classifying this asset.
            </p>
          ) : null}

          <label className="block text-xs font-semibold text-slate-300">
            Classification basis and limitations
            <textarea
              required
              minLength={20}
              value={basis}
              onChange={(event) => setBasis(event.target.value)}
              placeholder="Identify the source, observed asset identity and any unresolved limitation."
              className="mt-1.5 min-h-24 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
            />
          </label>

          <button
            type="submit"
            disabled={
              busy ||
              !assetId ||
              !classKey ||
              !evidenceItemId ||
              basis.trim().length < 20
            }
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-400 px-4 py-2 text-xs font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ShieldCheck className="h-4 w-4" aria-hidden />
            {busy ? "Recording…" : "Record governed classification"}
          </button>
        </form>

        <div className="space-y-3">
          <div className="rounded-xl border border-white/8 bg-black/10 p-4">
            <h4 className="flex items-center gap-2 text-xs font-semibold text-white">
              <Calculator className="h-4 w-4 text-cyan-300" aria-hidden />
              Rate applicability guard
            </h4>
            {!profile ? (
              <p className="mt-2 text-xs text-slate-500">
                Select a class profile to see the measurement basis and the
                analyses SyncAI must refuse.
              </p>
            ) : (
              <>
                <dl className="mt-3 space-y-2 text-xs">
                  <div>
                    <dt className="text-slate-500">Condition basis</dt>
                    <dd className="text-slate-200">{profile.conditionBasis}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Failure means</dt>
                    <dd className="text-slate-200">{profile.failureMeaning}</dd>
                  </div>
                </dl>
                {!isStructure && profile.measurementBasis !== "natural" ? (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className="text-xs text-slate-400">
                      Recorded failures
                      <input
                        aria-label="Recorded failures"
                        type="number"
                        min="0"
                        step="1"
                        value={failureCount}
                        onChange={(event) =>
                          setFailureCount(event.target.value)
                        }
                        className="mt-1 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
                      />
                    </label>
                    <label className="text-xs text-slate-400">
                      Recorded exposure
                      <input
                        aria-label="Recorded exposure"
                        type="number"
                        min="0"
                        step="any"
                        value={exposure}
                        onChange={(event) => setExposure(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-white/10 bg-[#0A131E] px-3 py-2 text-sm text-white"
                      />
                    </label>
                  </div>
                ) : null}
                {rate ? (
                  <p
                    className={`mt-3 rounded-lg border p-3 text-xs leading-relaxed ${rate.rate == null ? "border-amber-400/20 bg-amber-400/5 text-amber-100" : "border-teal-400/20 bg-teal-400/5 text-teal-100"}`}
                  >
                    {rate.reason}
                  </p>
                ) : (
                  <p className="mt-3 text-xs text-slate-500">
                    Enter the recorded count and exposure to normalize a rate;
                    SyncAI will refuse a denominator that does not fit the
                    class.
                  </p>
                )}
              </>
            )}
          </div>

          {isStructure ? (
            <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
              <h4 className="flex items-center gap-2 text-xs font-semibold text-amber-100">
                <FileCheck2 className="h-4 w-4" aria-hidden />
                Civil and structural operating path
              </h4>
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-slate-300">
                <li>
                  Record a condition rating against its approved owner scale.
                </li>
                <li>Bind the qualified inspection and canonical evidence.</li>
                <li>
                  Run the governed civil specialist against an owned risk.
                </li>
                <li>
                  Obtain independent qualified review before any decision.
                </li>
              </ol>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  to="/reliability"
                  className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-cyan-300/30"
                >
                  Record condition state
                </Link>
                <Link
                  to="/risk"
                  className="rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-cyan-300/30"
                >
                  Open civil specialist
                </Link>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
                SyncAI does not invent rating scales, deterioration rates,
                structural capacity, legal loads or safety certification and
                cannot close, restrict or reopen an asset.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
