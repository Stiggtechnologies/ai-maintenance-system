import { useEffect, useMemo, useState } from "react";
import {
  Boxes,
  CheckCircle2,
  GitBranch,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  loadAssetFoundationWorkspace,
  proposeAssetFoundation,
  proposeAssetHierarchyNode,
  reviewAssetFoundation,
  reviewAssetHierarchyNode,
  type AssetLocationKind,
  type FoundationDecision,
  type FoundationScores,
} from "../services/assetFoundationService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const SCORE_DIMENSIONS: Array<{ key: keyof FoundationScores; label: string }> =
  [
    { key: "safety", label: "Safety" },
    { key: "environmental", label: "Environment" },
    { key: "production", label: "Production" },
    { key: "financial", label: "Financial" },
    { key: "regulatory", label: "Regulatory" },
  ];

const LOCATION_KINDS: Array<{ value: AssetLocationKind; label: string }> = [
  { value: "area", label: "Area" },
  { value: "unit", label: "Unit" },
  { value: "system", label: "System" },
  { value: "functional_location", label: "Functional location" },
];

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function AssetFoundationWorkbench() {
  const { data, loading, error, refetch } = useAsyncData(
    loadAssetFoundationWorkspace,
    [],
    { isEmpty: () => false },
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);

  const [siteId, setSiteId] = useState("");
  const [parentLocationId, setParentLocationId] = useState("");
  const [locationKind, setLocationKind] = useState<AssetLocationKind>("area");
  const [locationCode, setLocationCode] = useState("");
  const [locationName, setLocationName] = useState("");
  const [locationDescription, setLocationDescription] = useState("");
  const [locationEvidenceId, setLocationEvidenceId] = useState("");
  const [locationReviewId, setLocationReviewId] = useState("");
  const [locationReviewNote, setLocationReviewNote] = useState("");

  const [assetId, setAssetId] = useState("");
  const [hierarchyLocationId, setHierarchyLocationId] = useState("");
  const [scores, setScores] = useState<FoundationScores>({
    safety: 1,
    environmental: 1,
    production: 1,
    financial: 1,
    regulatory: 1,
  });
  const [criticalityBasis, setCriticalityBasis] = useState("");
  const [boundaryName, setBoundaryName] = useState("");
  const [includedEquipment, setIncludedEquipment] = useState("");
  const [excludedEquipment, setExcludedEquipment] = useState("");
  const [upstreamInterface, setUpstreamInterface] = useState("");
  const [downstreamInterface, setDownstreamInterface] = useState("");
  const [isolationPoints, setIsolationPoints] = useState("");
  const [boundaryBasis, setBoundaryBasis] = useState("");
  const [hierarchyEvidenceId, setHierarchyEvidenceId] = useState("");
  const [criticalityEvidenceId, setCriticalityEvidenceId] = useState("");
  const [boundaryEvidenceId, setBoundaryEvidenceId] = useState("");
  const [foundationReviewId, setFoundationReviewId] = useState("");
  const [foundationReviewNote, setFoundationReviewNote] = useState("");

  const verifiedLocations = useMemo(
    () =>
      data?.locations.filter((location) => location.status === "verified") ??
      [],
    [data],
  );
  const assignableLocations = useMemo(
    () =>
      verifiedLocations.filter(
        (location) =>
          location.kind === "system" || location.kind === "functional_location",
      ),
    [verifiedLocations],
  );
  const pendingLocations = useMemo(
    () =>
      data?.locations.filter((location) => location.status === "proposed") ??
      [],
    [data],
  );
  const pendingFoundations = useMemo(
    () =>
      data?.proposals.filter((proposal) => proposal.status === "proposed") ??
      [],
    [data],
  );
  const criticalityClass = useMemo(() => {
    const maximum = Math.max(...Object.values(scores));
    if (maximum === 5) return "critical";
    if (maximum === 4) return "high";
    if (maximum === 3) return "medium";
    return "low";
  }, [scores]);

  useEffect(() => {
    if (!siteId && data?.sites[0]) setSiteId(data.sites[0].id);
    if (!assetId && data?.assets[0]) setAssetId(data.assets[0].id);
    if (!hierarchyLocationId && assignableLocations[0]) {
      setHierarchyLocationId(assignableLocations[0].id);
    }
    if (!locationReviewId && pendingLocations[0]) {
      setLocationReviewId(pendingLocations[0].id);
    }
    if (!foundationReviewId && pendingFoundations[0]) {
      setFoundationReviewId(pendingFoundations[0].id);
    }
    const evidence = data?.verifiedEvidence ?? [];
    if (!locationEvidenceId && evidence[0])
      setLocationEvidenceId(evidence[0].id);
    if (!hierarchyEvidenceId && evidence[0])
      setHierarchyEvidenceId(evidence[0].id);
    if (!criticalityEvidenceId && evidence[1])
      setCriticalityEvidenceId(evidence[1].id);
    if (!boundaryEvidenceId && evidence[2])
      setBoundaryEvidenceId(evidence[2].id);
  }, [
    assetId,
    assignableLocations,
    boundaryEvidenceId,
    criticalityEvidenceId,
    data,
    foundationReviewId,
    hierarchyEvidenceId,
    hierarchyLocationId,
    locationEvidenceId,
    locationReviewId,
    pendingFoundations,
    pendingLocations,
    siteId,
  ]);

  async function act(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      setNotice({ kind: "ok", text: success });
      refetch();
    } catch (actionError) {
      setNotice({
        kind: "error",
        text:
          actionError instanceof Error
            ? actionError.message
            : "The governed action failed.",
      });
    } finally {
      setBusy(false);
    }
  }

  function submitLocation() {
    return act(
      () =>
        proposeAssetHierarchyNode({
          siteId,
          parentLocationId: parentLocationId || null,
          kind: locationKind,
          code: locationCode,
          name: locationName,
          description: locationDescription,
          evidenceItemId: locationEvidenceId,
        }),
      "Hierarchy node proposed. An independent named reviewer must verify it before it can anchor an asset.",
    );
  }

  function decideLocation(decision: FoundationDecision) {
    return act(
      () =>
        reviewAssetHierarchyNode({
          locationId: locationReviewId,
          decision,
          reviewNote: locationReviewNote,
        }),
      `Hierarchy proposal ${decision}.`,
    );
  }

  function submitFoundation() {
    return act(
      () =>
        proposeAssetFoundation({
          assetId,
          hierarchyLocationId,
          scores,
          criticalityBasis,
          boundary: {
            name: boundaryName,
            includedEquipment: splitList(includedEquipment),
            excludedEquipment: splitList(excludedEquipment),
            upstreamInterface,
            downstreamInterface,
            isolationPoints: splitList(isolationPoints),
            basis: boundaryBasis,
          },
          hierarchyEvidenceItemId: hierarchyEvidenceId,
          criticalityEvidenceItemId: criticalityEvidenceId,
          boundaryEvidenceItemId: boundaryEvidenceId,
        }),
      "Asset foundation proposed. The hierarchy, criticality and equipment boundary remain unverified until independent review.",
    );
  }

  function decideFoundation(decision: FoundationDecision) {
    return act(
      () =>
        reviewAssetFoundation({
          verificationId: foundationReviewId,
          decision,
          reviewNote: foundationReviewNote,
        }),
      `Asset foundation ${decision}. Verified decisions update the canonical asset record without creating operating authority.`,
    );
  }

  if (loading && !data)
    return <LoadingState label="Loading the governed asset foundation" />;
  if (error && !data) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <section className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-[#0a111c]">
      <div className="border-b border-white/8 bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.12),transparent_48%)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
              <GitBranch className="h-4 w-4" aria-hidden /> Asset foundation
            </div>
            <h2 className="text-xl font-semibold text-white">
              Verified hierarchy, criticality and equipment boundary
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Build one evidence-backed Site → Area/Unit → System/Functional
              Location → Asset structure. Criticality uses the highest of five
              consequences so averaging cannot hide a catastrophic dimension;
              equipment boundaries explicitly state inclusions, interfaces and
              isolation points.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            {[
              ["Verified nodes", verifiedLocations.length],
              [
                "Verified assets",
                data?.assets.filter((asset) => asset.foundationVerifiedAt)
                  .length ?? 0,
              ],
              [
                "Pending reviews",
                pendingLocations.length + pendingFoundations.length,
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-lg border border-white/8 bg-black/20 px-3 py-2"
              >
                <div className="text-lg font-semibold text-white">{value}</div>
                <div className="text-slate-500">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {notice && (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${notice.kind === "ok" ? "border-teal-400/25 bg-teal-400/8 text-teal-200" : "border-rose-400/25 bg-rose-400/8 text-rose-200"}`}
          >
            {notice.text}
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-2">
          <div className="space-y-4 rounded-xl border border-white/8 bg-white/[0.025] p-4">
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-cyan-300" aria-hidden />
              <h3 className="font-semibold text-white">
                1. Propose hierarchy node
              </h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Site"
                value={siteId}
                onChange={setSiteId}
                options={(data?.sites ?? []).map((site) => ({
                  value: site.id,
                  label: site.name,
                }))}
              />
              <Select
                label="Kind"
                value={locationKind}
                onChange={(value) =>
                  setLocationKind(value as AssetLocationKind)
                }
                options={LOCATION_KINDS}
              />
              <Select
                label="Verified parent"
                value={parentLocationId}
                onChange={setParentLocationId}
                options={[
                  { value: "", label: "None — site area" },
                  ...verifiedLocations
                    .filter((location) => location.siteId === siteId)
                    .map((location) => ({
                      value: location.id,
                      label: `${location.code} · ${location.name}`,
                    })),
                ]}
              />
              <Text
                label="Location code"
                value={locationCode}
                onChange={setLocationCode}
              />
              <Text
                label="Name"
                value={locationName}
                onChange={setLocationName}
              />
              <EvidenceSelect
                label="Hierarchy evidence"
                value={locationEvidenceId}
                onChange={setLocationEvidenceId}
                evidence={data?.verifiedEvidence ?? []}
              />
            </div>
            <Area
              label="Description and structural basis"
              value={locationDescription}
              onChange={setLocationDescription}
            />
            <ActionButton disabled={busy} onClick={submitLocation}>
              Propose node
            </ActionButton>
          </div>

          <div className="space-y-4 rounded-xl border border-white/8 bg-white/[0.025] p-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-teal-300" aria-hidden />
              <h3 className="font-semibold text-white">
                2. Independently review hierarchy
              </h3>
            </div>
            {pendingLocations.length === 0 ? (
              <p className="text-sm text-slate-500">
                No hierarchy proposal is awaiting review.
              </p>
            ) : (
              <>
                <Select
                  label="Pending node"
                  value={locationReviewId}
                  onChange={setLocationReviewId}
                  options={pendingLocations.map((location) => ({
                    value: location.id,
                    label: `${location.code} · ${location.name}`,
                  }))}
                />
                <Area
                  label="Independent review note"
                  value={locationReviewNote}
                  onChange={setLocationReviewNote}
                />
                <DecisionButtons busy={busy} onDecide={decideLocation} />
              </>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-white/[0.025] p-4">
          <div className="mb-4 flex items-center gap-2">
            <Boxes className="h-4 w-4 text-amber-300" aria-hidden />
            <h3 className="font-semibold text-white">
              3. Propose asset criticality and boundary
            </h3>
            <span className="ml-auto rounded-full bg-amber-400/10 px-2 py-1 text-xs font-semibold text-amber-200">
              Deterministic result: {criticalityClass}
            </span>
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <div className="space-y-3">
              <Select
                label="Asset"
                value={assetId}
                onChange={setAssetId}
                options={(data?.assets ?? []).map((asset) => ({
                  value: asset.id,
                  label: `${asset.tag ?? "No tag"} · ${asset.name}`,
                }))}
              />
              <Select
                label="Verified system / functional location"
                value={hierarchyLocationId}
                onChange={setHierarchyLocationId}
                options={assignableLocations.map((location) => ({
                  value: location.id,
                  label: `${location.code} · ${location.name}`,
                }))}
              />
              <EvidenceSelect
                label="Hierarchy evidence"
                value={hierarchyEvidenceId}
                onChange={setHierarchyEvidenceId}
                evidence={data?.verifiedEvidence ?? []}
              />
              <EvidenceSelect
                label="Criticality evidence"
                value={criticalityEvidenceId}
                onChange={setCriticalityEvidenceId}
                evidence={data?.verifiedEvidence ?? []}
              />
              <EvidenceSelect
                label="Boundary evidence"
                value={boundaryEvidenceId}
                onChange={setBoundaryEvidenceId}
                evidence={data?.verifiedEvidence ?? []}
              />
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {SCORE_DIMENSIONS.map((dimension) => (
                  <label
                    key={dimension.key}
                    className="text-xs font-semibold uppercase tracking-wide text-slate-400"
                  >
                    {dimension.label}
                    <select
                      aria-label={`${dimension.label} consequence score`}
                      value={scores[dimension.key]}
                      onChange={(event) =>
                        setScores((current) => ({
                          ...current,
                          [dimension.key]: Number(event.target.value),
                        }))
                      }
                      className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm normal-case text-white"
                    >
                      {[1, 2, 3, 4, 5].map((score) => (
                        <option key={score} value={score}>
                          {score}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <Area
                label="Criticality basis"
                value={criticalityBasis}
                onChange={setCriticalityBasis}
              />
            </div>
            <div className="space-y-3">
              <Text
                label="Boundary name"
                value={boundaryName}
                onChange={setBoundaryName}
              />
              <Text
                label="Included equipment (comma-separated)"
                value={includedEquipment}
                onChange={setIncludedEquipment}
              />
              <Text
                label="Excluded equipment (comma-separated)"
                value={excludedEquipment}
                onChange={setExcludedEquipment}
              />
              <Text
                label="Upstream interface"
                value={upstreamInterface}
                onChange={setUpstreamInterface}
              />
              <Text
                label="Downstream interface"
                value={downstreamInterface}
                onChange={setDownstreamInterface}
              />
              <Text
                label="Isolation points (comma-separated)"
                value={isolationPoints}
                onChange={setIsolationPoints}
              />
              <Area
                label="Boundary basis"
                value={boundaryBasis}
                onChange={setBoundaryBasis}
              />
            </div>
          </div>
          <div className="mt-4">
            <ActionButton
              disabled={busy || assignableLocations.length === 0}
              onClick={submitFoundation}
            >
              Propose asset foundation
            </ActionButton>
          </div>
        </div>

        <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
          <div className="space-y-4 rounded-xl border border-white/8 bg-white/[0.025] p-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-teal-300" aria-hidden />
              <h3 className="font-semibold text-white">
                4. Independently verify asset foundation
              </h3>
            </div>
            {pendingFoundations.length === 0 ? (
              <p className="text-sm text-slate-500">
                No asset-foundation proposal is awaiting review.
              </p>
            ) : (
              <>
                <Select
                  label="Pending proposal"
                  value={foundationReviewId}
                  onChange={setFoundationReviewId}
                  options={pendingFoundations.map((proposal) => {
                    const asset = data?.assets.find(
                      (item) => item.id === proposal.assetId,
                    );
                    return {
                      value: proposal.id,
                      label: `${asset?.tag ?? "Asset"} · revision ${proposal.revision} · ${proposal.criticalityClass}`,
                    };
                  })}
                />
                <Area
                  label="Independent review note"
                  value={foundationReviewNote}
                  onChange={setFoundationReviewNote}
                />
                <DecisionButtons busy={busy} onDecide={decideFoundation} />
              </>
            )}
          </div>
          <div className="rounded-xl border border-white/8 bg-black/15 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="font-semibold text-white">
                Verified asset register
              </h3>
              <button
                type="button"
                onClick={refetch}
                className="flex items-center gap-1.5 text-xs font-semibold text-cyan-300 hover:text-cyan-200"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Refresh
              </button>
            </div>
            <div className="space-y-2">
              {(data?.assets ?? []).map((asset) => (
                <div
                  key={asset.id}
                  className="grid gap-2 rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2 text-xs sm:grid-cols-[1.1fr_1fr_auto]"
                >
                  <div>
                    <div className="font-semibold text-slate-200">
                      {asset.tag ?? "No tag"} · {asset.name}
                    </div>
                    <div className="mt-1 text-slate-500">
                      {asset.functionalLocation ?? "Hierarchy not verified"}
                    </div>
                  </div>
                  <div className="text-slate-400">
                    {asset.area ?? "No area"} → {asset.system ?? "No system"}
                  </div>
                  <span
                    className={`self-start rounded-full px-2 py-1 font-semibold ${asset.foundationVerifiedAt ? "bg-teal-400/10 text-teal-300" : "bg-slate-400/10 text-slate-400"}`}
                  >
                    {asset.foundationVerifiedAt
                      ? `${asset.criticality} · verified`
                      : "unverified"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="text-xs leading-5 text-slate-500">
          Verification updates only the canonical asset identity, location and
          criticality. It never creates work, approves a recommendation, accepts
          risk, commits spend, changes operating limits or authorizes return to
          service.
        </p>
      </div>
    </section>
  );
}

function Text(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
      {props.label}
      <input
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm normal-case text-white"
      />
    </label>
  );
}

function Area(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
      {props.label}
      <textarea
        rows={3}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm normal-case text-white"
      />
    </label>
  );
}

function Select(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
      {props.label}
      <select
        aria-label={props.label}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm normal-case text-white"
      >
        <option value="">Select…</option>
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function EvidenceSelect(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  evidence: Array<{ id: string; description: string }>;
}) {
  return (
    <Select
      label={props.label}
      value={props.value}
      onChange={props.onChange}
      options={props.evidence.map((item) => ({
        value: item.id,
        label: item.description,
      }))}
    />
  );
}

function ActionButton(props: {
  disabled: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {props.children}
    </button>
  );
}

function DecisionButtons(props: {
  busy: boolean;
  onDecide: (decision: FoundationDecision) => void;
}) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={props.busy}
        onClick={() => props.onDecide("verified")}
        className="rounded-lg bg-teal-400 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
      >
        Verify
      </button>
      <button
        type="button"
        disabled={props.busy}
        onClick={() => props.onDecide("rejected")}
        className="rounded-lg border border-rose-400/30 px-3 py-2 text-sm font-semibold text-rose-200 disabled:opacity-50"
      >
        Reject
      </button>
    </div>
  );
}
