import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSearch, ShieldAlert } from "lucide-react";
import { useAuth } from "./AuthProvider";
import {
  assembleRegulatoryEvidencePack,
  getRegulatoryEvidenceWorkspace,
  releaseRegulatoryEvidencePack,
  withdrawRegulatoryEvidencePack,
  type RegulatoryEvidenceActResult,
  type RegulatoryEvidenceDossier,
  type RegulatoryEvidenceWorkspace,
  type RegulatoryRequirementRow,
} from "../services/regulatoryEvidenceService";

const EDITOR_ROLES = new Set([
  "admin",
  "executive",
  "maintenance_manager",
  "reliability_engineer",
]);

const control =
  "mt-1 w-full rounded border border-white/10 bg-overlook-deep px-2 py-2 text-sm text-slate-100";

function noAuthority(result: RegulatoryEvidenceActResult) {
  if (
    result.legalComplianceDetermined !== false ||
    result.workAuthorized !== false ||
    result.riskAccepted !== false ||
    result.operatingLimitChanged !== false ||
    result.returnToServiceAuthorized !== false
  ) {
    throw new Error("Unexpected authority response from the governed writer.");
  }
}

function requirementValue(requirement: RegulatoryRequirementRow) {
  return `${requirement.layerId}::${requirement.key}`;
}

function postureCopy(posture: RegulatoryRequirementRow["posture"]) {
  switch (posture) {
    case "gap":
      return "No current released dossier";
    case "assembled_unreleased":
      return "Assembled and not released";
    case "covered":
      return "Released for inspection";
    case "applicability_undetermined":
      return "Applicability is still undetermined, so no dossier is expected.";
    case "not_required":
      return "Absence is not treated as a mandatory gap.";
  }
}

export function RegulatoryEvidencePacks() {
  const { profile } = useAuth();
  const [workspace, setWorkspace] =
    useState<RegulatoryEvidenceWorkspace | null>(null);
  const [layerKey, setLayerKey] = useState("");
  const [title, setTitle] = useState("");
  const [purpose, setPurpose] = useState("");
  const [evidenceId, setEvidenceId] = useState("");
  const [citationBasis, setCitationBasis] = useState("");
  const [citations, setCitations] = useState<
    { evidenceItemId: string; citationBasis: string; description: string }[]
  >([]);
  const [releaseBasis, setReleaseBasis] = useState("");
  const [withdrawalReason, setWithdrawalReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canEdit = EDITOR_ROLES.has(profile?.role ?? "");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setWorkspace(await getRegulatoryEvidenceWorkspace());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Regulatory evidence could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const assemblable = useMemo(
    () =>
      (workspace?.requirements ?? []).filter((requirement) =>
        ["gap", "not_required", "covered"].includes(requirement.posture),
      ),
    [workspace],
  );
  const selected = assemblable.find(
    (requirement) => requirementValue(requirement) === layerKey,
  );

  useEffect(() => {
    if (!layerKey && assemblable[0])
      setLayerKey(requirementValue(assemblable[0]));
  }, [assemblable, layerKey]);

  const currentReleased = useMemo(() => {
    if (!selected) return null;
    return (
      workspace?.dossiers.find(
        (dossier) =>
          dossier.current &&
          dossier.layerId === selected.layerId &&
          dossier.requirementKey === selected.key,
      ) ?? null
    );
  }, [selected, workspace]);

  function addCitation() {
    const evidence = workspace?.verifiedEvidence.find(
      (item) => item.id === evidenceId,
    );
    if (!evidence) {
      setError("Choose independently verified canonical evidence.");
      return;
    }
    if (citationBasis.trim().length < 20) {
      setError(
        "Each citation needs a 20 character basis written for this requirement.",
      );
      return;
    }
    if (citations.some((item) => item.evidenceItemId === evidence.id)) {
      setError("Each evidence item can be cited once.");
      return;
    }
    setCitations((current) => [
      ...current,
      {
        evidenceItemId: evidence.id,
        citationBasis: citationBasis.trim(),
        description: evidence.description ?? evidence.id,
      },
    ]);
    setCitationBasis("");
    setError(null);
  }

  async function assemble() {
    if (!selected) {
      setError("Choose an adopted jurisdiction requirement.");
      return;
    }
    if (selected.posture === "covered" && !currentReleased) {
      setError("Refresh before assembling the next version.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await assembleRegulatoryEvidencePack({
        capabilityPackLayerId: selected.layerId,
        expectedLayerVersion: selected.layerVersion,
        requirementKey: selected.key,
        title,
        purpose,
        supersedesId: currentReleased?.id ?? null,
        items: citations.map(({ evidenceItemId, citationBasis: basis }) => ({
          evidenceItemId,
          citationBasis: basis,
        })),
      });
      noAuthority(result);
      setNotice(
        result.revised
          ? "Unreleased dossier revised. No legal outcome was decided."
          : "Dossier assembled for inspection. No legal outcome was decided.",
      );
      setCitations([]);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The dossier was not assembled.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function release(dossier: RegulatoryEvidenceDossier) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await releaseRegulatoryEvidencePack({
        dossierId: dossier.id,
        expectedVersion: dossier.version,
        releaseBasis,
      });
      noAuthority(result);
      setNotice(
        "Dossier released for inspection. No legal outcome was decided.",
      );
      setReleaseBasis("");
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The dossier was not released.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(dossier: RegulatoryEvidenceDossier) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await withdrawRegulatoryEvidencePack({
        dossierId: dossier.id,
        expectedVersion: dossier.version,
        reason: withdrawalReason,
      });
      noAuthority(result);
      setNotice("Unreleased dossier withdrawn. No legal outcome was decided.");
      setWithdrawalReason("");
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The dossier was not withdrawn.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-[#0D1520] border border-white/6 rounded-xl p-4 space-y-4">
      <div className="flex items-start gap-3">
        <FileSearch className="w-5 h-5 text-teal-300 mt-0.5" />
        <div>
          <h2 className="text-lg font-semibold text-white">
            Regulatory evidence
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Assemble an inspection dossier from evidence your organization has
            already verified against a jurisdiction requirement it has already
            adopted. This product does not supply jurisdiction rules.
          </p>
        </div>
      </div>

      {loading && (
        <p className="text-sm text-slate-400">Loading regulatory evidence…</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {notice && <p className="text-sm text-teal-300">{notice}</p>}

      {workspace && (
        <>
          <p className="text-sm text-slate-300">{workspace.decisionBoundary}</p>
          <p className="text-sm text-slate-400">
            {workspace.coverage.gaps} mandatory{" "}
            {workspace.coverage.gaps === 1
              ? "requirement has"
              : "requirements have"}{" "}
            no current released dossier.
            {workspace.jurisdiction
              ? ` Jurisdiction context: ${workspace.jurisdiction}.`
              : " No jurisdiction is recorded for this organization."}
          </p>
          {workspace.requirements.length === 0 && (
            <p className="text-sm text-amber-200">
              No adopted jurisdiction requirement is available. Adopt one before
              assembling a dossier. This product does not supply jurisdiction
              rules.
            </p>
          )}
          <ul className="space-y-2">
            {workspace.requirements.map((requirement) => (
              <li
                key={requirementValue(requirement)}
                className="rounded border border-white/8 px-3 py-2 text-sm"
              >
                <span className="text-white">{requirement.title}</span>
                <span className="text-slate-400">
                  {" "}
                  — {postureCopy(requirement.posture)}
                </span>
              </li>
            ))}
          </ul>

          {canEdit && assemblable.length > 0 && (
            <form
              className="grid gap-3 md:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                void assemble();
              }}
            >
              <label className="text-xs text-slate-400">
                Adopted requirement
                <select
                  aria-label="Adopted requirement"
                  className={control}
                  value={layerKey}
                  onChange={(event) => setLayerKey(event.target.value)}
                >
                  {assemblable.map((requirement) => (
                    <option
                      key={requirementValue(requirement)}
                      value={requirementValue(requirement)}
                    >
                      {requirement.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-400">
                Dossier title
                <input
                  aria-label="Dossier title"
                  className={control}
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label className="text-xs text-slate-400 md:col-span-2">
                Inspection purpose
                <textarea
                  aria-label="Inspection purpose"
                  className={control}
                  value={purpose}
                  onChange={(event) => setPurpose(event.target.value)}
                />
              </label>
              <label className="text-xs text-slate-400">
                Verified evidence
                <select
                  aria-label="Verified evidence"
                  className={control}
                  value={evidenceId}
                  onChange={(event) => setEvidenceId(event.target.value)}
                >
                  <option value="">Choose evidence</option>
                  {workspace.verifiedEvidence.map((evidence) => (
                    <option key={evidence.id} value={evidence.id}>
                      {evidence.description ?? evidence.id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-slate-400">
                Citation basis
                <input
                  aria-label="Citation basis"
                  className={control}
                  value={citationBasis}
                  onChange={(event) => setCitationBasis(event.target.value)}
                />
              </label>
              <div className="md:col-span-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="px-3 py-2 rounded border border-white/10 text-sm text-slate-200"
                  onClick={addCitation}
                >
                  Add cited evidence
                </button>
                <button
                  type="submit"
                  disabled={busy || citations.length === 0}
                  className="px-3 py-2 rounded bg-teal-700 text-sm text-white disabled:opacity-50"
                >
                  Assemble dossier
                </button>
              </div>
              {citations.length > 0 && (
                <ul className="md:col-span-2 text-sm text-slate-300">
                  {citations.map((citation) => (
                    <li key={citation.evidenceItemId}>
                      {citation.description}
                    </li>
                  ))}
                </ul>
              )}
            </form>
          )}

          <div className="space-y-3">
            {workspace.dossiers
              .filter((dossier) => dossier.status === "assembled")
              .map((dossier) => (
                <article
                  key={dossier.id}
                  className="rounded border border-white/8 p-3 space-y-2"
                >
                  <h3 className="text-sm text-white">{dossier.title}</h3>
                  <p className="text-xs text-slate-400">
                    {dossier.items.length} cited evidence item
                    {dossier.items.length === 1 ? "" : "s"}. Assembled and not
                    released.
                  </p>
                  {canEdit && profile?.id === dossier.assembledBy && (
                    <>
                      <p className="text-sm text-amber-200 flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4" />A different person
                        must release this dossier.
                      </p>
                      <label className="block text-xs text-slate-400">
                        Withdrawal reason
                        <textarea
                          aria-label="Withdrawal reason"
                          className={control}
                          value={withdrawalReason}
                          onChange={(event) =>
                            setWithdrawalReason(event.target.value)
                          }
                        />
                      </label>
                      <button
                        type="button"
                        disabled={busy}
                        className="px-3 py-2 rounded border border-white/10 text-sm text-slate-200"
                        onClick={() => void withdraw(dossier)}
                      >
                        Withdraw unreleased dossier
                      </button>
                    </>
                  )}
                  {canEdit && profile?.id !== dossier.assembledBy && (
                    <>
                      <label className="block text-xs text-slate-400">
                        Release basis
                        <textarea
                          aria-label="Release basis"
                          className={control}
                          value={releaseBasis}
                          onChange={(event) =>
                            setReleaseBasis(event.target.value)
                          }
                        />
                      </label>
                      <button
                        type="button"
                        disabled={busy}
                        className="px-3 py-2 rounded bg-teal-700 text-sm text-white"
                        onClick={() => void release(dossier)}
                      >
                        Release for inspection
                      </button>
                    </>
                  )}
                </article>
              ))}
          </div>
        </>
      )}
    </section>
  );
}
