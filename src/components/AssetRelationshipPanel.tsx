import { useEffect, useState, type FormEvent } from "react";
import { BadgeCheck, Handshake, UsersRound } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  listConditionAssets,
  listConditionEvidence,
} from "../services/conditionStateService";
import {
  getAssetRelationshipWorkspace,
  listRelationshipStakeholders,
  recordAssetPartyRole,
  recordAssetRelationship,
  verifyAssetPartyRole,
  verifyAssetRelationship,
  type AssetPartyRole,
  type AssetRelationshipType,
} from "../services/assetRelationshipService";
import { useAuth } from "./AuthProvider";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const RELATIONSHIP_LABELS: Record<AssetRelationshipType, string> = {
  owned: "Owned",
  leased: "Leased",
  rented: "Rented",
  concession: "Concession",
  oem_maintained: "OEM maintained",
  third_party: "Third party",
  shared: "Shared",
  ppp: "Public-private partnership",
  customer_owned: "Customer owned",
  supplier_managed: "Supplier managed",
};

const PARTY_ROLE_LABELS: Record<AssetPartyRole, string> = {
  owner: "Owner",
  operator: "Operator",
  maintainer: "Maintainer",
  engineering_authority: "Engineering authority",
  risk_owner: "Risk owner",
  regulator: "Regulator",
  insurer: "Insurer",
  warranty_provider: "Warranty provider",
  payer: "Payer",
};

const REVIEW_ROLES = new Set([
  "reliability_engineer",
  "maintenance_manager",
  "executive",
  "admin",
]);

export function AssetRelationshipPanel() {
  const { profile } = useAuth();
  const workspace = useAsyncData(getAssetRelationshipWorkspace, []);
  const assets = useAsyncData(listConditionAssets, []);
  const stakeholders = useAsyncData(listRelationshipStakeholders, []);
  const [mode, setMode] = useState<"relationship" | "party">("relationship");
  const [assetId, setAssetId] = useState("");
  const evidence = useAsyncData(
    () => (assetId ? listConditionEvidence(assetId) : Promise.resolve([])),
    [assetId],
  );
  const [evidenceIds, setEvidenceIds] = useState<string[]>([]);
  const [tenure, setTenure] = useState<AssetRelationshipType>("owned");
  const [stakeholderId, setStakeholderId] = useState("");
  const [partyRole, setPartyRole] = useState<AssetPartyRole>("owner");
  const [basis, setBasis] = useState("");
  const [agreement, setAgreement] = useState("");
  const [maintenance, setMaintenance] = useState<
    "site" | "counterparty" | "shared" | ""
  >("");
  const [strategyConstraint, setStrategyConstraint] = useState("");
  const [startsOn, setStartsOn] = useState("");
  const [endsOn, setEndsOn] = useState("");
  const [historyVisible, setHistoryVisible] = useState(true);
  const [reviewTarget, setReviewTarget] = useState<{
    kind: "relationship" | "party";
    id: string;
  } | null>(null);
  const [reviewDecision, setReviewDecision] = useState<
    "verified" | "superseded"
  >("verified");
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => setEvidenceIds([]), [assetId]);
  useEffect(() => {
    if (tenure === "owned") setStakeholderId("");
  }, [tenure]);

  if (
    (workspace.loading && !workspace.data) ||
    (assets.loading && !assets.data) ||
    (stakeholders.loading && !stakeholders.data)
  ) {
    return <LoadingState label="Loading asset relationships" />;
  }
  if (workspace.error || assets.error || stakeholders.error) {
    return (
      <ErrorState
        message={
          workspace.error ??
          assets.error ??
          stakeholders.error ??
          "Asset relationships unavailable"
        }
        onRetry={() => {
          workspace.refetch();
          assets.refetch();
          stakeholders.refetch();
        }}
      />
    );
  }

  const canReview = REVIEW_ROLES.has(profile?.role ?? "");
  const relationships = workspace.data?.relationships ?? [];
  const assignments = workspace.data?.assignments ?? [];

  function toggleEvidence(id: string) {
    setEvidenceIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFlash(null);
    try {
      if (mode === "relationship") {
        await recordAssetRelationship({
          assetId,
          tenure,
          relationshipBasis: basis,
          counterpartyStakeholderId: stakeholderId || null,
          agreementReference: agreement || null,
          maintenanceResponsibility: maintenance || null,
          historyVisibleToSite: historyVisible,
          strategyConstraint: strategyConstraint || null,
          startsOn: startsOn || null,
          endsOn: endsOn || null,
          evidenceItemIds: evidenceIds,
        });
        setFlash("Draft asset relationship recorded for independent review.");
      } else {
        await recordAssetPartyRole({
          assetId,
          stakeholderId,
          partyRole,
          responsibilityScope: basis,
          effectiveFrom: startsOn,
          effectiveTo: endsOn || null,
          agreementReference: agreement || null,
          evidenceItemIds: evidenceIds,
        });
        setFlash(
          "Draft accountable party role recorded for independent review.",
        );
      }
      setBasis("");
      setAgreement("");
      setStrategyConstraint("");
      setEvidenceIds([]);
      workspace.refetch();
    } catch (caught) {
      setFlash((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function review(event: FormEvent) {
    event.preventDefault();
    if (!reviewTarget) return;
    setBusy(true);
    setFlash(null);
    try {
      if (reviewTarget.kind === "relationship") {
        await verifyAssetRelationship(reviewTarget.id, reviewNote);
      } else {
        await verifyAssetPartyRole(reviewTarget.id, reviewDecision, reviewNote);
      }
      setReviewTarget(null);
      setReviewNote("");
      setFlash("Independent responsibility disposition recorded.");
      workspace.refetch();
    } catch (caught) {
      setFlash((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      data-testid="asset-relationship-workspace"
      aria-labelledby="asset-relationship-heading"
      className="space-y-4 rounded-xl border border-white/8 bg-overlook-deep/40 p-4"
    >
      <div>
        <h3
          id="asset-relationship-heading"
          className="flex items-center gap-2 text-sm font-semibold text-white"
        >
          <Handshake className="h-4 w-4 text-signal-cyan" aria-hidden />
          Asset relationships &amp; accountability
        </h3>
        <p className="mt-1 max-w-4xl text-xs leading-relaxed text-slate-400">
          {workspace.data?.basis}
        </p>
      </div>

      {flash ? (
        <p className="rounded-lg border border-signal-cyan/20 bg-signal-cyan/5 p-2 text-xs text-slate-200">
          {flash}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <div className="space-y-3">
          <div>
            <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
              <BadgeCheck className="h-4 w-4" aria-hidden /> Relationships
            </h4>
            {relationships.length === 0 ? (
              <p className="mt-2 rounded-lg border border-white/6 bg-white/2 p-3 text-xs text-slate-400">
                No asset relationship is recorded. SyncAI will not assume that
                an unclassified asset is owned or maintained by the site.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {relationships.map((row) => (
                  <article
                    key={row.asset_id}
                    className="rounded-lg border border-white/6 bg-white/2 p-3"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-slate-100">
                          {row.asset}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {row.basis ??
                            "Legacy relationship: re-attestation required before verification."}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <span className="rounded-full border border-signal-cyan/25 px-2 py-0.5 text-[11px] text-signal-cyan">
                          {RELATIONSHIP_LABELS[row.tenure]}
                        </span>
                        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-slate-400">
                          {row.status}
                        </span>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {row.counterparty ?? "No counterparty"} ·{" "}
                      {row.maintenance_responsibility ??
                        "maintenance responsibility unstated"}
                    </p>
                    {canReview && row.status === "draft" && row.recorded_by ? (
                      <button
                        type="button"
                        className="mt-2 text-xs font-medium text-signal-cyan hover:underline"
                        onClick={() =>
                          setReviewTarget({
                            kind: "relationship",
                            id: row.asset_id,
                          })
                        }
                      >
                        Independently review
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </div>

          <div>
            <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
              <UsersRound className="h-4 w-4" aria-hidden /> Accountable parties
            </h4>
            {assignments.length === 0 ? (
              <p className="mt-2 rounded-lg border border-white/6 bg-white/2 p-3 text-xs text-slate-400">
                No accountable party roles are recorded. A relationship label
                alone does not identify who owns, operates, maintains, insures,
                regulates, warrants, pays for, or holds engineering and risk
                authority.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {assignments.map((row) => (
                  <article
                    key={row.id}
                    className="rounded-lg border border-white/6 bg-white/2 p-3"
                  >
                    <div className="flex flex-wrap justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-slate-100">
                          {row.asset} · {row.stakeholder}
                        </p>
                        <p className="mt-1 text-xs text-slate-400">
                          {row.responsibility_scope}
                        </p>
                      </div>
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] text-slate-300">
                        {PARTY_ROLE_LABELS[row.party_role]} · {row.status}
                      </span>
                    </div>
                    {canReview && row.status === "draft" ? (
                      <button
                        type="button"
                        className="mt-2 text-xs font-medium text-signal-cyan hover:underline"
                        onClick={() =>
                          setReviewTarget({ kind: "party", id: row.id })
                        }
                      >
                        Independently review
                      </button>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>

        <form
          className="space-y-3 rounded-lg border border-white/8 bg-black/10 p-3"
          onSubmit={submit}
        >
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-white/3 p-1">
            {(["relationship", "party"] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={mode === item}
                onClick={() => setMode(item)}
                className={`rounded-md px-2 py-1.5 text-xs ${mode === item ? "bg-signal-cyan/15 text-signal-cyan" : "text-slate-400"}`}
              >
                {item === "relationship" ? "Relationship" : "Party role"}
              </button>
            ))}
          </div>
          <label className="block text-xs text-slate-400">
            Asset
            <select
              required
              value={assetId}
              onChange={(event) => setAssetId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-industrial-black p-2 text-slate-200"
            >
              <option value="">Select asset…</option>
              {(assets.data ?? []).map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.tag ? `${asset.tag} — ` : ""}
                  {asset.name}
                </option>
              ))}
            </select>
          </label>
          {mode === "relationship" ? (
            <label className="block text-xs text-slate-400">
              Relationship
              <select
                value={tenure}
                onChange={(event) =>
                  setTenure(event.target.value as AssetRelationshipType)
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-industrial-black p-2 text-slate-200"
              >
                {(workspace.data?.relationship_types ?? []).map((item) => (
                  <option key={item} value={item}>
                    {RELATIONSHIP_LABELS[item]}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="block text-xs text-slate-400">
              Party role
              <select
                value={partyRole}
                onChange={(event) =>
                  setPartyRole(event.target.value as AssetPartyRole)
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-industrial-black p-2 text-slate-200"
              >
                {(workspace.data?.party_roles ?? []).map((item) => (
                  <option key={item} value={item}>
                    {PARTY_ROLE_LABELS[item]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(mode === "party" || tenure !== "owned") && (
            <label className="block text-xs text-slate-400">
              Canonical stakeholder{" "}
              {mode === "party" ? "party" : "counterparty"}
              <select
                required
                value={stakeholderId}
                onChange={(event) => setStakeholderId(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-industrial-black p-2 text-slate-200"
              >
                <option value="">Select stakeholder…</option>
                {(stakeholders.data ?? []).map((party) => (
                  <option key={party.id} value={party.id}>
                    {party.name}
                    {party.external_organization
                      ? ` — ${party.external_organization}`
                      : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {mode === "relationship" ? (
            <label className="block text-xs text-slate-400">
              Maintenance responsibility
              <select
                value={maintenance}
                onChange={(event) =>
                  setMaintenance(event.target.value as typeof maintenance)
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-industrial-black p-2 text-slate-200"
              >
                <option value="">Unstated</option>
                <option value="site">Site</option>
                <option value="counterparty">Counterparty</option>
                <option value="shared">Shared</option>
              </select>
            </label>
          ) : null}
          <label className="block text-xs text-slate-400">
            {mode === "relationship"
              ? "Basis and limitations"
              : "Responsibility scope and limitations"}
            <textarea
              required
              minLength={20}
              value={basis}
              onChange={(event) => setBasis(event.target.value)}
              className="mt-1 min-h-20 w-full rounded-lg border border-white/10 bg-industrial-black p-2 text-slate-200"
            />
          </label>
          <label className="block text-xs text-slate-400">
            Agreement reference (optional)
            <input
              value={agreement}
              onChange={(event) => setAgreement(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-industrial-black p-2 text-slate-200"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-slate-400">
              Effective from{mode === "party" ? "" : " (optional)"}
              <input
                type="date"
                required={mode === "party"}
                value={startsOn}
                onChange={(event) => setStartsOn(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-industrial-black p-2 text-slate-200"
              />
            </label>
            <label className="block text-xs text-slate-400">
              Effective to{tenure === "rented" ? "" : " (optional)"}
              <input
                type="date"
                required={mode === "relationship" && tenure === "rented"}
                value={endsOn}
                onChange={(event) => setEndsOn(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-industrial-black p-2 text-slate-200"
              />
            </label>
          </div>
          {mode === "relationship" ? (
            <>
              <label className="block text-xs text-slate-400">
                Strategy constraint (optional)
                <input
                  value={strategyConstraint}
                  onChange={(event) =>
                    setStrategyConstraint(event.target.value)
                  }
                  className="mt-1 w-full rounded-lg border border-white/10 bg-industrial-black p-2 text-slate-200"
                />
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={historyVisible}
                  onChange={(event) => setHistoryVisible(event.target.checked)}
                />
                Maintenance history is visible to the site
              </label>
            </>
          ) : null}
          {(evidence.data ?? []).length > 0 ? (
            <fieldset className="space-y-1 rounded-lg border border-white/6 p-2">
              <legend className="px-1 text-xs text-slate-400">
                Canonical evidence (optional)
              </legend>
              {(evidence.data ?? []).map((item) => (
                <label
                  key={item.id}
                  className="flex items-start gap-2 text-xs text-slate-400"
                >
                  <input
                    type="checkbox"
                    checked={evidenceIds.includes(item.id)}
                    onChange={() => toggleEvidence(item.id)}
                  />
                  <span>
                    {item.description} · {item.verification_status}
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-signal-cyan px-3 py-2 text-xs font-semibold text-industrial-black disabled:opacity-50"
          >
            Record draft{" "}
            {mode === "relationship" ? "relationship" : "party role"}
          </button>
        </form>
      </div>

      {reviewTarget ? (
        <form
          onSubmit={review}
          className="space-y-2 rounded-lg border border-signal-cyan/20 bg-signal-cyan/5 p-3"
        >
          <p className="text-xs font-semibold text-slate-200">
            Independent disposition
          </p>
          {reviewTarget.kind === "party" ? (
            <select
              aria-label="Review decision"
              value={reviewDecision}
              onChange={(event) =>
                setReviewDecision(
                  event.target.value as "verified" | "superseded",
                )
              }
              className="rounded-lg border border-white/10 bg-industrial-black p-2 text-xs text-slate-200"
            >
              <option value="verified">Verify</option>
              <option value="superseded">Supersede</option>
            </select>
          ) : null}
          <textarea
            aria-label="Independent review note"
            required
            minLength={20}
            value={reviewNote}
            onChange={(event) => setReviewNote(event.target.value)}
            className="min-h-20 w-full rounded-lg border border-white/10 bg-industrial-black p-2 text-xs text-slate-200"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-signal-cyan px-3 py-1.5 text-xs font-semibold text-industrial-black"
            >
              Record disposition
            </button>
            <button
              type="button"
              onClick={() => setReviewTarget(null)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
