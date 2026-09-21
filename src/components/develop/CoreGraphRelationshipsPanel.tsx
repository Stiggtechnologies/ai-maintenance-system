import { useCallback, useEffect, useMemo, useState } from "react";
import { GitMerge } from "lucide-react";
import type { WorkspaceEvidence } from "../../lib/develop";
import {
  getCaseSpec34Relationships,
  linkAssetToObjective,
  linkContractToAsset,
  type Spec34RelationshipWorkspace,
} from "../../services/spec34RelationshipService";

const field =
  "rounded-lg border border-white/10 bg-[#09111B] px-3 py-2 text-xs text-slate-200 outline-none focus:border-cyan-400/40";

export function CoreGraphRelationshipsPanel({
  caseId,
  canLink,
  evidence,
}: {
  caseId: string;
  canLink: boolean;
  evidence: WorkspaceEvidence[];
}) {
  const [model, setModel] = useState<Spec34RelationshipWorkspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [contractId, setContractId] = useState("");
  const [contractAssetId, setContractAssetId] = useState("");
  const [contractEvidenceId, setContractEvidenceId] = useState("");
  const [contractBasis, setContractBasis] = useState("");
  const [objectiveAssetId, setObjectiveAssetId] = useState("");
  const [objectiveEvidenceId, setObjectiveEvidenceId] = useState("");
  const [objectiveBasis, setObjectiveBasis] = useState("");
  const verifiedEvidence = useMemo(
    () => evidence.filter((item) => item.verificationStatus === "verified"),
    [evidence],
  );
  const load = useCallback(async () => {
    try {
      setModel(await getCaseSpec34Relationships(caseId));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [caseId]);
  useEffect(() => void load(), [load]);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
      <div className="flex items-start gap-3">
        <GitMerge className="mt-0.5 h-4 w-4 text-signal-cyan" />
        <div>
          <h2 className="text-sm font-semibold text-white">
            Core graph relationships (§34)
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            Evidence-backed links between the canonical Contract, Asset and
            Objective records. These are associations—not duplicate objects.
          </p>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-xs text-rose-300">
          {error}
        </p>
      )}
      {model && (
        <>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <div className="rounded-lg border border-white/8 p-3">
              <h3 className="text-xs font-semibold text-slate-200">
                Contract PROVIDES Asset
              </h3>
              {model.contractProvidesAsset.length === 0 ? (
                <p className="mt-2 text-[11px] text-amber-200">
                  No awarded contract is evidenced as providing a case asset.
                </p>
              ) : (
                <ul className="mt-2 space-y-1 text-[11px] text-slate-300">
                  {model.contractProvidesAsset.map((link) => (
                    <li key={link.id}>
                      {link.packageCode} → {link.asset} · {link.basis}
                    </li>
                  ))}
                </ul>
              )}
              {canLink && (
                <div className="mt-3 grid gap-2">
                  <select aria-label="Awarded contract" className={field} value={contractId} onChange={(event) => setContractId(event.target.value)}>
                    <option value="">Awarded contract…</option>
                    {model.contracts.filter((item) => item.awarded).map((item) => <option key={item.id} value={item.id}>{item.packageCode} · {item.title}</option>)}
                  </select>
                  <select aria-label="Provided asset" className={field} value={contractAssetId} onChange={(event) => setContractAssetId(event.target.value)}>
                    <option value="">Provided asset…</option>
                    {model.assets.map((item) => <option key={item.id} value={item.id}>{item.tag ?? "untagged"} · {item.name}</option>)}
                  </select>
                  <select aria-label="Contract relationship evidence" className={field} value={contractEvidenceId} onChange={(event) => setContractEvidenceId(event.target.value)}>
                    <option value="">Independently verified evidence…</option>
                    {verifiedEvidence.map((item) => <option key={item.id} value={item.id}>{item.description ?? item.id}</option>)}
                  </select>
                  <input className={field} value={contractBasis} onChange={(event) => setContractBasis(event.target.value)} placeholder="Relationship basis (20+ characters)" />
                  <button className="rounded-lg bg-cyan-400/15 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40" disabled={busy || !contractId || !contractAssetId || !contractEvidenceId || contractBasis.trim().length < 20} onClick={() => void act(() => linkContractToAsset({caseId,contractPackageId:Number(contractId),assetId:contractAssetId,evidenceItemId:contractEvidenceId,basis:contractBasis}))}>
                    Record contract → asset
                  </button>
                </div>
              )}
            </div>
            <div className="rounded-lg border border-white/8 p-3">
              <h3 className="text-xs font-semibold text-slate-200">
                Asset SUPPORTS Objective
              </h3>
              <p className="mt-1 text-[11px] text-slate-500">
                {model.objective ? model.objective.description : "This case has no adopted objective to link."}
              </p>
              {model.assetSupportsObjective.length === 0 ? (
                <p className="mt-2 text-[11px] text-amber-200">
                  No case asset is evidenced as supporting this objective.
                </p>
              ) : (
                <ul className="mt-2 space-y-1 text-[11px] text-slate-300">
                  {model.assetSupportsObjective.map((link) => (
                    <li key={link.id}>
                      {link.asset} → {link.objective} · {link.basis}
                    </li>
                  ))}
                </ul>
              )}
              {canLink && model.objective && (
                <div className="mt-3 grid gap-2">
                  <select aria-label="Supporting asset" className={field} value={objectiveAssetId} onChange={(event) => setObjectiveAssetId(event.target.value)}>
                    <option value="">Supporting asset…</option>
                    {model.assets.map((item) => <option key={item.id} value={item.id}>{item.tag ?? "untagged"} · {item.name}</option>)}
                  </select>
                  <select aria-label="Objective relationship evidence" className={field} value={objectiveEvidenceId} onChange={(event) => setObjectiveEvidenceId(event.target.value)}>
                    <option value="">Independently verified evidence…</option>
                    {verifiedEvidence.map((item) => <option key={item.id} value={item.id}>{item.description ?? item.id}</option>)}
                  </select>
                  <input className={field} value={objectiveBasis} onChange={(event) => setObjectiveBasis(event.target.value)} placeholder="Relationship basis (20+ characters)" />
                  <button className="rounded-lg bg-cyan-400/15 px-3 py-2 text-xs font-semibold text-cyan-200 disabled:opacity-40" disabled={busy || !objectiveAssetId || !objectiveEvidenceId || objectiveBasis.trim().length < 20} onClick={() => void act(() => linkAssetToObjective({caseId,assetId:objectiveAssetId,objectiveId:model.objective!.id,evidenceItemId:objectiveEvidenceId,basis:objectiveBasis}))}>
                    Record asset → objective
                  </button>
                </div>
              )}
            </div>
          </div>
          <p className="mt-4 text-[11px] text-slate-500">
            {model.decisionBoundary}
          </p>
        </>
      )}
    </section>
  );
}
