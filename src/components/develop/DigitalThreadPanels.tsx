/**
 * Sync Develop Slice 5C — the digital thread (spec II.2, III.§26, III.§34).
 *
 *   D11.19  the Asset is the ONE anchor. Every object registered here names
 *           one row of the canonical asset hierarchy, and the enterprise
 *           identity (§26's enterprise_asset_id / functional_location) is
 *           recorded onto that same row — never onto a second asset table.
 *   D11.05  the Common Data Environment link model: ten object kinds in II.2's
 *           order, joined by forward hops with a mandatory basis.
 *   D11.06  exactly one authoritative revision per object, released by a
 *           named human (§70) and superseding rather than overwriting.
 *   D11.20  the continuity invariant. BREAKS and GAPS are shown apart, never
 *           summed, and the severance ledger says every place the thread was
 *           allowed to come apart and why.
 *   D11.07  downstream impact and change receipts. Unacknowledged is a STATE,
 *           and the traversal refuses on a gap rather than presenting what it
 *           reached as the whole affected set.
 *   D11.21  §34's nineteen relationships with the home each lives in, and the
 *           six that are honestly absent.
 *
 * THE SURFACE CONVENTION, unchanged from 5A/5B: a REFUSAL is an answer and is
 * rendered as prose, never as an error and never as a zero. Every number here
 * comes off the server; where the server refused to compute one, the panel
 * says so instead of printing 0.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link2, ShieldCheck, Inbox, Network } from "lucide-react";

import {
  SEVERANCE_ROUTES,
  THREAD_LINK_TYPES,
  THREAD_OBJECT_KINDS,
  chainPosition,
  hopDirection,
  readAuthoritativeVersion,
  readThreadContinuity,
  readThreadGraph,
  readThreadImpact,
  readThreadReceipts,
  readOrgThreadSeverances,
  readThreadSeverances,
  severanceWasADecision,
  liveThreadHops,
  threadCascade,
  threadKindLabel,
  threadNodeId,
  threadNodeLabel,
  type AuthoritativeVersionPayload,
  type OrgThreadSeverancesPayload,
  type ThreadContinuityPayload,
  type ThreadGraphPayload,
  type ThreadHopEdge,
  type ThreadImpactPayload,
  type ThreadObject,
  type ThreadReceiptsPayload,
  type ThreadSeverancesPayload,
} from "../../lib/develop/thread";
import {
  acknowledgeThreadReceipt,
  checkThreadContinuity,
  declareThreadVersionAuthoritative,
  getCaseThreadGraph,
  getCaseThreadImpact,
  getCaseThreadReceipts,
  getCaseThreadSeverances,
  getOrgThreadSeverances,
  linkThreadObjects,
  listBindableAssets,
  listCaseRequirements,
  reanchorThreadObject,
  recordThreadVersion,
  registerThreadObject,
  resolveThreadAuthoritativeVersion,
  retireThreadObject,
  severThreadLink,
  setAssetEnterpriseIdentity,
  type BindableAsset,
} from "../../services/developService";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";
const btnClass =
  "rounded-lg bg-signal-cyan/15 px-3 py-1.5 text-xs font-semibold text-signal-cyan hover:bg-signal-cyan/25 disabled:opacity-40";

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      </div>
      <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded border border-red-400/30 bg-red-400/10 px-2.5 py-1.5 text-xs text-red-300">
      {error}
    </div>
  );
}

/** A refusal is an ANSWER, so it is rendered as prose and never as an error. */
function Refusal({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className="rounded border border-amber-400/25 bg-amber-400/5 px-2.5 py-1.5 text-xs text-amber-200">
      {text}
    </div>
  );
}

/** A BREAK is not a backlog item. It gets the loudest tone on the screen. */
function BreakLine({ text }: { text: string }) {
  return (
    <div className="rounded border border-red-400/40 bg-red-400/10 px-2.5 py-1.5 text-xs text-red-200">
      {text}
    </div>
  );
}

function Note({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return <p className="text-[11px] leading-relaxed text-slate-400">{text}</p>;
}

const routeLabel = (key: string) =>
  SEVERANCE_ROUTES.find((r) => r.key === key)?.label ?? key;

/**
 * A live hop, named the way somebody choosing one would recognise it:
 * "<upstream ref> → <downstream ref> (link type)". The node ids in the graph
 * are `obj:<id>`, so the node list is what turns them back into references.
 */
function hopLabel(
  graph: ThreadGraphPayload | null,
  edge: ThreadHopEdge,
): string {
  return `${threadNodeLabel(graph, edge.supplier)} → ${threadNodeLabel(
    graph,
    edge.dependent,
  )}${edge.linkType ? ` (${edge.linkType})` : ""}`;
}

export interface DigitalThreadPanelProps {
  caseId: string;
  canPlan: boolean;
  reloadKey?: number;
}

export function DigitalThreadPanel({
  caseId,
  canPlan,
  reloadKey = 0,
}: DigitalThreadPanelProps) {
  const [graph, setGraph] = useState<ThreadGraphPayload | null>(null);
  const [continuity, setContinuity] = useState<ThreadContinuityPayload | null>(
    null,
  );
  const [receipts, setReceipts] = useState<ThreadReceiptsPayload | null>(null);
  const [severances, setSeverances] = useState<ThreadSeverancesPayload | null>(
    null,
  );
  const [orgSeverances, setOrgSeverances] =
    useState<OrgThreadSeverancesPayload | null>(null);
  const [assets, setAssets] = useState<BindableAsset[]>([]);
  const [requirements, setRequirements] = useState<
    { id: number; requirement_ref: string; requirement: string }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const [g, k, r, s, o, a, q] = await Promise.all([
        getCaseThreadGraph(caseId),
        checkThreadContinuity(caseId),
        getCaseThreadReceipts(caseId),
        getCaseThreadSeverances(caseId),
        getOrgThreadSeverances(),
        listBindableAssets().catch(() => [] as BindableAsset[]),
        listCaseRequirements(caseId).catch(() => []),
      ]);
      setGraph(g);
      setContinuity(k);
      setReceipts(r);
      setSeverances(s);
      setOrgSeverances(o);
      setAssets(a);
      setRequirements(
        q.map((x) => ({
          id: x.id,
          requirement_ref: x.requirement_ref,
          requirement: x.requirement,
        })),
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey, tick]);

  const refresh = () => setTick((n) => n + 1);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reading = useMemo(() => readThreadGraph(graph), [graph]);
  const continuityReading = useMemo(
    () => readThreadContinuity(continuity),
    [continuity],
  );
  const receiptsReading = useMemo(
    () => readThreadReceipts(receipts),
    [receipts],
  );
  const severanceReading = useMemo(
    () => readThreadSeverances(severances),
    [severances],
  );
  const orgSeveranceReading = useMemo(
    () => readOrgThreadSeverances(orgSeverances),
    [orgSeverances],
  );

  return (
    <div className="space-y-4">
      <ErrorLine error={error} />
      <ThreadRegister
        reading={reading}
        assets={assets}
        requirements={requirements}
        canPlan={canPlan}
        busy={busy}
        onRegister={(input) => run(() => registerThreadObject(caseId, input))}
        onLink={(u, d, t, b) => run(() => linkThreadObjects(u, d, t, b))}
        onEnterpriseIdentity={(assetId, eam, floc) =>
          run(() => setAssetEnterpriseIdentity(assetId, eam, floc))
        }
        onRetire={(id, reason) => run(() => retireThreadObject(id, reason))}
        onReanchor={(id, assetId, reason) =>
          run(() => reanchorThreadObject(id, assetId, reason))
        }
        graph={graph}
      />
      <VersionPanel
        objects={reading.objects}
        canPlan={canPlan}
        busy={busy}
        onRecord={(id, input) => run(() => recordThreadVersion(id, input))}
        onDeclare={(id, basis) =>
          run(() => declareThreadVersionAuthoritative(id, basis))
        }
      />
      <ContinuityPanel
        reading={continuityReading}
        severances={severanceReading}
        orgSeverances={orgSeveranceReading}
        links={graph}
        canPlan={canPlan}
        busy={busy}
        onSever={(id, reason) => run(() => severThreadLink(id, reason))}
      />
      <ImpactAndReceiptsPanel
        caseId={caseId}
        objects={reading.objects}
        receipts={receiptsReading}
        canPlan={canPlan}
        busy={busy}
        onAcknowledge={(id, disposition, note) =>
          run(() => acknowledgeThreadReceipt(id, disposition, note))
        }
      />
      <Spec34Panel reading={reading} />
    </div>
  );
}

/* ────────────────── D11.05 + D11.19 — register and link ─────────────────── */

function ThreadRegister({
  reading,
  graph,
  assets,
  requirements,
  canPlan,
  busy,
  onRegister,
  onLink,
  onEnterpriseIdentity,
  onRetire,
  onReanchor,
}: {
  reading: ReturnType<typeof readThreadGraph>;
  graph: ThreadGraphPayload | null;
  assets: BindableAsset[];
  requirements: { id: number; requirement_ref: string; requirement: string }[];
  canPlan: boolean;
  busy: boolean;
  onRegister: (input: {
    objectKind: string;
    objectRef: string;
    title: string;
    anchorAssetId: string;
    requirementId?: number;
  }) => void;
  onLink: (up: number, down: number, type: string, basis: string) => void;
  onEnterpriseIdentity: (
    assetId: string,
    enterpriseAssetId: string,
    functionalLocation: string,
  ) => void;
  onRetire: (objectId: number, reason: string) => void;
  onReanchor: (objectId: number, assetId: string, reason: string) => void;
}) {
  const [kind, setKind] = useState<string>(THREAD_OBJECT_KINDS[0].key);
  const [ref, setRef] = useState("");
  const [title, setTitle] = useState("");
  const [anchor, setAnchor] = useState("");
  const [requirementId, setRequirementId] = useState("");
  const [up, setUp] = useState("");
  const [down, setDown] = useState("");
  const [linkType, setLinkType] = useState<string>(THREAD_LINK_TYPES[0].key);
  const [basis, setBasis] = useState("");
  const [eamAsset, setEamAsset] = useState("");
  const [eamId, setEamId] = useState("");
  const [floc, setFloc] = useState("");
  const [retireId, setRetireId] = useState("");
  const [retireReason, setRetireReason] = useState("");
  const [moveId, setMoveId] = useState("");
  const [moveAsset, setMoveAsset] = useState("");
  const [moveReason, setMoveReason] = useState("");

  const live = reading.objects.filter((o) => o.status === "live");
  const upObj = live.find((o) => String(o.id) === up);
  const downObj = live.find((o) => String(o.id) === down);
  const direction =
    upObj && downObj
      ? hopDirection(upObj.objectKind, downObj.objectKind)
      : null;

  return (
    <Section
      icon={<Link2 className="h-4 w-4 text-signal-cyan" />}
      title="Common data environment — the digital thread"
      subtitle="Spec II.2's ten object kinds in one traceable thread, every object anchored to exactly one asset in the ONE canonical hierarchy (§26). A hop runs forward along the chain and carries the basis on which it holds."
    >
      {reading.refused ? (
        <Refusal text={reading.headline} />
      ) : (
        <Note text={reading.headline} />
      )}

      {reading.objects.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-[11px]">
            <thead className="text-slate-400">
              <tr>
                <th className="py-1 pr-3">#</th>
                <th className="py-1 pr-3">Kind</th>
                <th className="py-1 pr-3">Reference</th>
                <th className="py-1 pr-3">Anchor asset</th>
                <th className="py-1 pr-3">Authoritative</th>
                <th className="py-1 pr-3">Held</th>
                <th className="py-1 pr-3">Receipts</th>
              </tr>
            </thead>
            <tbody className="text-slate-200">
              {reading.objects.map((o) => (
                <tr key={o.id} className="border-t border-white/5">
                  <td className="py-1 pr-3 text-slate-400">
                    {o.chainPosition ?? chainPosition(o.objectKind) ?? "?"}
                  </td>
                  <td className="py-1 pr-3">{threadKindLabel(o.objectKind)}</td>
                  <td className="py-1 pr-3">
                    {o.objectRef}
                    {o.status === "retired" && (
                      <span className="ml-1 text-amber-300">(retired)</span>
                    )}
                  </td>
                  <td className="py-1 pr-3 text-slate-300">
                    {o.anchorAssetName ?? "—"}
                  </td>
                  <td className="py-1 pr-3">
                    {o.authoritativeVersion ?? (
                      <span className="text-amber-300">
                        none released
                        {o.draftVersions > 0
                          ? ` (${o.draftVersions} draft${o.draftVersions === 1 ? "" : "s"})`
                          : ""}
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-3 text-slate-400">
                    {o.registeredByReference ? "by reference" : o.canonicalHome}
                  </td>
                  <td className="py-1 pr-3">
                    {o.outstandingReceipts > 0 ? (
                      <span className="text-amber-300">
                        {o.outstandingReceipts} unanswered
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {graph && !reading.refused && (
        <Note
          text={`One graph: ${graph.threadEdgeCount} thread hop(s), ${graph.anchorEdgeCount} anchor edge(s) to the asset hierarchy and ${graph.assetEdgeCount} recorded asset dependency edge(s) among those assets — traversed by the same propagateLoss and singlePointsOfFailure the asset interdependency surface uses, not a second cascade model.`}
        />
      )}

      {canPlan && (
        <div className="space-y-3 border-t border-white/5 pt-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className={inputClass}
              aria-label="Object kind"
            >
              {THREAD_OBJECT_KINDS.map((k, i) => (
                <option key={k.key} value={k.key}>
                  {i + 1}. {k.label}
                </option>
              ))}
            </select>
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="Reference (tag, drawing no., PO line)"
              className={inputClass}
            />
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className={inputClass}
            />
            <select
              value={anchor}
              onChange={(e) => setAnchor(e.target.value)}
              className={inputClass}
              aria-label="Anchor asset"
            >
              <option value="">Anchor asset (required)</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            {kind === "requirement" ? (
              <select
                value={requirementId}
                onChange={(e) => setRequirementId(e.target.value)}
                className={inputClass}
                aria-label="Requirement"
              >
                <option value="">Requirement row (required)</option>
                {requirements.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.requirement_ref}
                  </option>
                ))}
              </select>
            ) : (
              <button
                onClick={() =>
                  onRegister({
                    objectKind: kind,
                    objectRef: ref,
                    title,
                    anchorAssetId: anchor,
                  })
                }
                disabled={busy}
                className={btnClass}
              >
                Register object
              </button>
            )}
          </div>
          {kind === "requirement" && (
            <button
              onClick={() =>
                onRegister({
                  objectKind: kind,
                  objectRef: ref,
                  title,
                  anchorAssetId: anchor,
                  requirementId: requirementId
                    ? Number(requirementId)
                    : undefined,
                })
              }
              disabled={busy}
              className={btnClass}
            >
              Register requirement into the thread
            </button>
          )}
          <Note text="An object with no anchor cannot be registered. That is the rule the continuity invariant is built on: a requirement written before anybody knows what equipment it lands on stays a requirement until then, and the continuity read counts it as outside the CDE rather than as threaded." />

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <select
              value={up}
              onChange={(e) => setUp(e.target.value)}
              className={inputClass}
              aria-label="Upstream object"
            >
              <option value="">Upstream object</option>
              {live.map((o) => (
                <option key={o.id} value={o.id}>
                  {threadKindLabel(o.objectKind)} {o.objectRef}
                </option>
              ))}
            </select>
            <select
              value={down}
              onChange={(e) => setDown(e.target.value)}
              className={inputClass}
              aria-label="Downstream object"
            >
              <option value="">Downstream object</option>
              {live.map((o) => (
                <option key={o.id} value={o.id}>
                  {threadKindLabel(o.objectKind)} {o.objectRef}
                </option>
              ))}
            </select>
            <select
              value={linkType}
              onChange={(e) => setLinkType(e.target.value)}
              className={inputClass}
              aria-label="Hop type"
            >
              {THREAD_LINK_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => onLink(Number(up), Number(down), linkType, basis)}
              disabled={busy || !up || !down}
              className={btnClass}
            >
              Make the hop
            </button>
          </div>
          <input
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
            placeholder="Why this hop holds (20 characters minimum)"
            className={inputClass}
          />
          {direction === "backward" && (
            <Refusal text="That hop runs against the spec II.2 chain. The downstream object must sit later in the chain than the upstream one — the server refuses it too, this is only the earlier warning." />
          )}

          <div className="grid grid-cols-1 gap-2 border-t border-white/5 pt-3 sm:grid-cols-4">
            <select
              value={eamAsset}
              onChange={(e) => setEamAsset(e.target.value)}
              className={inputClass}
              aria-label="Asset for enterprise identity"
            >
              <option value="">Asset</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <input
              value={eamId}
              onChange={(e) => setEamId(e.target.value)}
              placeholder="Enterprise asset id (SAP / Maximo)"
              className={inputClass}
            />
            <input
              value={floc}
              onChange={(e) => setFloc(e.target.value)}
              placeholder="Functional location"
              className={inputClass}
            />
            <button
              onClick={() => onEnterpriseIdentity(eamAsset, eamId, floc)}
              disabled={busy || !eamAsset}
              className={btnClass}
            >
              Record enterprise identity
            </button>
          </div>
          <Note text="§26's enterprise_asset_id and functional_location go onto the ONE asset row — the identity the operating system uses, so a change receipt can name which machine the change reached. There is no second asset table and never will be." />

          <div className="grid grid-cols-1 gap-2 border-t border-white/5 pt-3 sm:grid-cols-3">
            <select
              value={retireId}
              onChange={(e) => setRetireId(e.target.value)}
              className={inputClass}
              aria-label="Object to retire"
            >
              <option value="">Retire an object…</option>
              {live.map((o) => (
                <option key={o.id} value={o.id}>
                  {threadKindLabel(o.objectKind)} {o.objectRef}
                </option>
              ))}
            </select>
            <input
              value={retireReason}
              onChange={(e) => setRetireReason(e.target.value)}
              placeholder="Why it is out of the thread (20 characters minimum)"
              className={inputClass}
            />
            <button
              onClick={() => onRetire(Number(retireId), retireReason)}
              disabled={busy || !retireId}
              className={btnClass}
            >
              Retire (severs its hops, on the record)
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <select
              value={moveId}
              onChange={(e) => setMoveId(e.target.value)}
              className={inputClass}
              aria-label="Object to re-anchor"
            >
              <option value="">Move an object to another asset…</option>
              {live
                .filter((o) => o.objectKind !== "installed_equipment")
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {threadKindLabel(o.objectKind)} {o.objectRef}
                  </option>
                ))}
            </select>
            <select
              value={moveAsset}
              onChange={(e) => setMoveAsset(e.target.value)}
              className={inputClass}
              aria-label="New anchor asset"
            >
              <option value="">New anchor asset</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <input
              value={moveReason}
              onChange={(e) => setMoveReason(e.target.value)}
              placeholder="Why it belongs to a different asset (20 characters minimum)"
              className={inputClass}
            />
            <button
              onClick={() => onReanchor(Number(moveId), moveAsset, moveReason)}
              disabled={busy || !moveId || !moveAsset}
              className={btnClass}
            >
              Move the anchor
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

/* ─────────────────── D11.06 — the authoritative version ─────────────────── */

function VersionPanel({
  objects,
  canPlan,
  busy,
  onRecord,
  onDeclare,
}: {
  objects: ThreadObject[];
  canPlan: boolean;
  busy: boolean;
  onRecord: (
    objectId: number,
    input: {
      versionLabel: string;
      issuedOn?: string;
      contentRef?: string;
      changeSummary?: string;
    },
  ) => void;
  onDeclare: (versionId: number, basis: string) => void;
}) {
  const live = objects.filter((o) => o.status === "live");
  const [objectId, setObjectId] = useState("");
  const [label, setLabel] = useState("");
  const [contentRef, setContentRef] = useState("");
  const [summary, setSummary] = useState("");
  const [versionId, setVersionId] = useState("");
  const [basis, setBasis] = useState("");
  // The unreleased revisions of the object currently chosen for release.
  const drafts = useMemo(
    () => live.find((o) => String(o.id) === objectId)?.drafts ?? [],
    [live, objectId],
  );
  const [resolved, setResolved] = useState<AuthoritativeVersionPayload | null>(
    null,
  );
  const [resolveError, setResolveError] = useState<string | null>(null);

  const resolveOne = async (id: number) => {
    setResolveError(null);
    try {
      setResolved(await resolveThreadAuthoritativeVersion(id));
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : String(e));
    }
  };

  const resolvedReading = resolved ? readAuthoritativeVersion(resolved) : null;

  return (
    <Section
      icon={<ShieldCheck className="h-4 w-4 text-signal-cyan" />}
      title="Authoritative version"
      subtitle="Exactly one revision of each object is authoritative at a time — held by a partial unique index, not by a report. Recording a revision does not release it: declaring it is a separate act, and no AI or system identity may make it (§70)."
    >
      {live.length === 0 ? (
        <Refusal text="No live object is registered in the thread, so there is nothing to release a revision of." />
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {live.map((o) => (
              <button
                key={o.id}
                onClick={() => void resolveOne(o.id)}
                className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-slate-200 hover:bg-white/[0.06]"
              >
                {o.objectRef}
                {o.authoritativeVersion
                  ? ` · ${o.authoritativeVersion}`
                  : " · none released"}
              </button>
            ))}
          </div>
          <ErrorLine error={resolveError} />
          {resolvedReading &&
            (resolvedReading.resolved ? (
              <Note text={resolvedReading.headline} />
            ) : (
              <Refusal text={resolvedReading.headline} />
            ))}
        </div>
      )}

      {canPlan && live.length > 0 && (
        <div className="space-y-2 border-t border-white/5 pt-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <select
              value={objectId}
              onChange={(e) => {
                setObjectId(e.target.value);
                // Never carry another object's revision id across. A stale
                // selection would keep the release button live pointing at a
                // revision of a different object.
                setVersionId("");
              }}
              className={inputClass}
              aria-label="Object"
            >
              <option value="">Object</option>
              {live.map((o) => (
                <option key={o.id} value={o.id}>
                  {threadKindLabel(o.objectKind)} {o.objectRef}
                </option>
              ))}
            </select>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Revision (Rev C, issue 4)"
              className={inputClass}
            />
            <input
              value={contentRef}
              onChange={(e) => setContentRef(e.target.value)}
              placeholder="Where the document lives (optional)"
              className={inputClass}
            />
            <button
              onClick={() =>
                onRecord(Number(objectId), {
                  versionLabel: label,
                  contentRef: contentRef || undefined,
                  changeSummary: summary || undefined,
                })
              }
              disabled={busy || !objectId}
              className={btnClass}
            >
              Record revision (draft)
            </button>
          </div>
          <input
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="What changed from the previous revision (mandatory once it supersedes one)"
            className={inputClass}
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {/*
              A SELECT, not a free-text id. The revision to release is chosen
              from the drafts the server sends for the selected object: a
              typed-in id is a value the product never hands out, so the
              release — the central act of D11.06, and the only thing that
              raises a D11.07 receipt — would have been reachable from psql and
              from nowhere on this screen.
            */}
            <select
              value={versionId}
              onChange={(e) => setVersionId(e.target.value)}
              className={inputClass}
              aria-label="Revision to release"
              disabled={drafts.length === 0}
            >
              <option value="">
                {objectId === ""
                  ? "Choose an object first"
                  : drafts.length === 0
                    ? "No unreleased revision on this object"
                    : "Revision to release"}
              </option>
              {drafts.map((d) => (
                <option key={d.versionId} value={d.versionId}>
                  {d.versionLabel}
                </option>
              ))}
            </select>
            <input
              value={basis}
              onChange={(e) => setBasis(e.target.value)}
              placeholder="Basis for the release — who checked it, against what (20 characters minimum)"
              className={inputClass}
            />
            <button
              onClick={() => onDeclare(Number(versionId), basis)}
              disabled={busy || !versionId}
              className={btnClass}
            >
              Declare authoritative
            </button>
          </div>
          <Note text="Declaring supersedes the incumbent rather than overwriting it — both pointers are written, so 'what did this replace' and 'what replaced this' both have answers — and it raises one unanswered change receipt for every object downstream." />
        </div>
      )}
    </Section>
  );
}

/* ───────────────────── D11.20 — the continuity invariant ────────────────── */

function ContinuityPanel({
  reading,
  severances,
  orgSeverances,
  links,
  canPlan,
  busy,
  onSever,
}: {
  reading: ReturnType<typeof readThreadContinuity>;
  severances: ReturnType<typeof readThreadSeverances>;
  orgSeverances: ReturnType<typeof readOrgThreadSeverances>;
  links: ThreadGraphPayload | null;
  canPlan: boolean;
  busy: boolean;
  onSever: (linkId: number, reason: string) => void;
}) {
  const [linkId, setLinkId] = useState("");
  const [reason, setReason] = useState("");
  const [lossNode, setLossNode] = useState("");

  const liveHops = liveThreadHops(links);
  const cascade = lossNode ? threadCascade(links, lossNode) : null;

  return (
    <Section
      icon={<Network className="h-4 w-4 text-signal-cyan" />}
      title="Continuity — the thread must never break"
      subtitle="Spec §26. A BREAK is a state the database refuses: an object with no anchor, a live hop into a retired object, a hop that runs backwards, two current revisions. A GAP is legal incompleteness. They are shown apart and never summed."
    >
      {reading.refused ? (
        <Refusal text={reading.headline} />
      ) : (
        <>
          <div
            className={`rounded border px-2.5 py-1.5 text-xs ${
              reading.intact
                ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                : "border-red-400/40 bg-red-400/10 text-red-200"
            }`}
          >
            {reading.intact ? "Invariant holds" : "INVARIANT BROKEN"} —{" "}
            {reading.headline}
          </div>
          {reading.breaks.map((b, i) => (
            <BreakLine key={`${b.kind}-${i}`} text={b.detail} />
          ))}
          {reading.gaps.map((g, i) => (
            <Refusal key={`${g.kind}-${i}`} text={g.detail} />
          ))}
        </>
      )}

      <div className="border-t border-white/5 pt-3">
        <p className="text-[11px] font-semibold text-slate-300">
          Severance ledger
        </p>
        {severances.refused ? (
          <Refusal text={severances.headline} />
        ) : (
          <Note text={severances.headline} />
        )}
        {[...severances.byPerson, ...severances.byCascade].map((s) => (
          <div
            key={s.id}
            className="mt-1 rounded border border-white/8 bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-slate-300"
          >
            <span className="text-slate-100">{routeLabel(s.route)}</span> ·{" "}
            {s.subjectRef}
            {s.linksSevered > 0 ? ` · ${s.linksSevered} hop(s) cut` : ""} ·{" "}
            {severanceWasADecision(s.route)
              ? (s.severedBy ?? "a person, unnamed")
              : `a cascade${s.severedBy ? ` (session: ${s.severedBy})` : ""}`}
            <div className="text-slate-400">{s.reason}</div>
          </div>
        ))}
      </div>

      {/*
        THE TENANT LEDGER. The case-scoped read above resolves its development
        case and refuses when it is gone, so it can never show a `case_cascade`
        row — those exist BECAUSE that case was deleted. This is where they are
        visible, and D11.20's promise is that a permitted break is visible.
      */}
      {orgSeverances.orphaned.length > 0 && (
        <div className="border-t border-white/5 pt-3">
          <p className="text-[11px] font-semibold text-slate-300">
            Severances whose development case has been deleted
          </p>
          <Note text={orgSeverances.headline} />
          {orgSeverances.orphaned.map((s) => (
            <div
              key={s.id}
              className="mt-1 rounded border border-white/8 bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-slate-300"
            >
              <span className="text-slate-100">{routeLabel(s.route)}</span> ·{" "}
              {s.subjectRef}
              {s.linksSevered > 0 ? ` · ${s.linksSevered} hop(s) cut` : ""}
              <div className="text-slate-400">{s.reason}</div>
            </div>
          ))}
        </div>
      )}

      {canPlan && liveHops.length > 0 && (
        <div className="grid grid-cols-1 gap-2 border-t border-white/5 pt-3 sm:grid-cols-3">
          {/*
            A SELECT over the live hops the graph already carries. The link id
            was in the payload all along and rendered nowhere, so severing a
            hop — one of D11.20's three recorded acts — meant knowing an id the
            screen never showed.
          */}
          <select
            value={linkId}
            onChange={(e) => setLinkId(e.target.value)}
            className={inputClass}
            aria-label="Hop to sever"
          >
            <option value="">Hop to sever</option>
            {liveHops.map((e) => (
              <option
                key={e.linkId ?? `${e.supplier}-${e.dependent}`}
                value={e.linkId ?? ""}
              >
                {hopLabel(links, e)}
              </option>
            ))}
          </select>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this hop no longer holds (20 characters minimum)"
            className={inputClass}
          />
          <button
            onClick={() => onSever(Number(linkId), reason)}
            disabled={busy || !linkId}
            className={btnClass}
          >
            Sever the hop (recorded)
          </button>
        </div>
      )}

      {liveHops.length > 0 && (
        <div className="border-t border-white/5 pt-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select
              value={lossNode}
              onChange={(e) => setLossNode(e.target.value)}
              className={inputClass}
              aria-label="Node to lose"
            >
              <option value="">
                What stops if we lose… (the SHARED traversal)
              </option>
              {(links?.graph.nodes ?? []).map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name}
                </option>
              ))}
            </select>
          </div>
          {cascade &&
            (cascade.reliable ? (
              <Note
                text={`${cascade.lostCount} node(s) lost, ${cascade.degradedCount} degraded. ${cascade.reason}`}
              />
            ) : (
              <Refusal text={cascade.reason} />
            ))}
        </div>
      )}
    </Section>
  );
}

/* ────────────── D11.07 — downstream impact and change receipts ──────────── */

function ImpactAndReceiptsPanel({
  caseId,
  objects,
  receipts,
  canPlan,
  busy,
  onAcknowledge,
}: {
  caseId: string;
  objects: ThreadObject[];
  receipts: ReturnType<typeof readThreadReceipts>;
  canPlan: boolean;
  busy: boolean;
  onAcknowledge: (id: number, disposition: string, note: string) => void;
}) {
  const [impact, setImpact] = useState<ThreadImpactPayload | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  // KEYED BY RECEIPT ID, not one shared box. With three outstanding receipts a
  // single `note` state fills every input with the same text and submits
  // whichever one was typed last against whichever button is clicked — a WRONG
  // but attributable acknowledgement, on a record whose entire purpose is
  // "somebody looked and said what they did".
  const [notes, setNotes] = useState<Record<number, string>>({});
  const noteFor = (id: number) => notes[id] ?? "";
  const setNoteFor = (id: number, v: string) =>
    setNotes((prev) => ({ ...prev, [id]: v }));
  const live = objects.filter((o) => o.status === "live");

  const ask = async (objectId: number) => {
    setImpactError(null);
    try {
      setImpact(await getCaseThreadImpact(caseId, objectId));
    } catch (e) {
      setImpactError(e instanceof Error ? e.message : String(e));
    }
  };

  const impactReading = useMemo(() => readThreadImpact(impact), [impact]);

  return (
    <Section
      icon={<Inbox className="h-4 w-4 text-signal-cyan" />}
      title="Downstream impact and change receipts"
      subtitle="Spec II.2's last two questions. A traversal over a thread with a gap REFUSES and names the gap rather than reporting what it could reach as the whole affected set; an unanswered receipt is an explicit state, not an absence."
    >
      {live.length === 0 ? (
        <Refusal text="No live object is registered, so there is nothing to trace a change through." />
      ) : (
        <div className="flex flex-wrap gap-2">
          {live.map((o) => (
            <button
              key={o.id}
              onClick={() => void ask(o.id)}
              className="rounded border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-slate-200 hover:bg-white/[0.06]"
            >
              What does {o.objectRef} affect?
            </button>
          ))}
        </div>
      )}
      <ErrorLine error={impactError} />
      {impact &&
        (impactReading.refused ? (
          <>
            <Refusal text={impactReading.headline} />
            {impactReading.gaps.map((g, i) => (
              <Refusal key={`${g.kind}-${i}`} text={g.detail} />
            ))}
            {impactReading.reached.length > 0 && (
              <Note
                text={`It reached ${impactReading.reached.length} object(s) — ${impactReading.reached.map((a) => a.objectRef).join(", ")} — and that is a FLOOR, deliberately not reported as a count.`}
              />
            )}
          </>
        ) : (
          <>
            <Note text={impactReading.headline} />
            <div className="flex flex-wrap gap-1">
              {impactReading.reached.map((a) => (
                <span
                  key={a.objectId}
                  className="rounded border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] text-slate-300"
                >
                  {a.objectRef} · {a.hops} hop{a.hops === 1 ? "" : "s"}
                  {a.outstandingReceipts > 0
                    ? ` · ${a.outstandingReceipts} unanswered`
                    : ""}
                </span>
              ))}
            </div>
            <Note
              text={`Node ${threadNodeId(impact.objectId)} in the shared graph — the same node space the plant's dependencies use.`}
            />
          </>
        ))}

      <div className="border-t border-white/5 pt-3">
        {receipts.refused ? (
          <Refusal text={receipts.headline} />
        ) : (
          <Note text={receipts.headline} />
        )}
        {receipts.outstanding.map((r) => (
          <div
            key={r.id}
            className="mt-1 rounded border border-amber-400/25 bg-amber-400/5 px-2.5 py-1.5 text-[11px] text-amber-100"
          >
            <div>
              <span className="font-semibold">{r.objectRef}</span> must answer{" "}
              {r.sourceObjectRef} {r.sourceVersionLabel}: {r.changeSummary}
            </div>
            {r.regionGapped === true && (
              <div className="mt-1 text-[11px] text-amber-300/90">
                Raised over a GAPPED region — answering it does not mean the
                change landed everywhere. {r.regionGapNote ?? ""}
              </div>
            )}
            {canPlan && (
              <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-3">
                <input
                  value={noteFor(r.id)}
                  onChange={(e) => setNoteFor(r.id, e.target.value)}
                  placeholder="What you did about it (20 characters minimum)"
                  className={inputClass}
                  aria-label={`What you did about ${r.objectRef}`}
                />
                <button
                  onClick={() =>
                    onAcknowledge(r.id, "acknowledged", noteFor(r.id))
                  }
                  disabled={busy}
                  className={btnClass}
                >
                  Acknowledged
                </button>
                <button
                  onClick={() =>
                    onAcknowledge(r.id, "not_applicable", noteFor(r.id))
                  }
                  disabled={busy}
                  className={btnClass}
                >
                  Not applicable
                </button>
              </div>
            )}
          </div>
        ))}
        {receipts.answered.map((r) => (
          <div
            key={r.id}
            className="mt-1 rounded border border-white/8 bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-slate-300"
          >
            {r.objectRef} · {r.status.replace("_", " ")} by{" "}
            {r.acknowledgedBy ?? "—"}: {r.acknowledgementNote}
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ───────────────────────── D11.21 — §34's nineteen ──────────────────────── */

function Spec34Panel({
  reading,
}: {
  reading: ReturnType<typeof readThreadGraph>;
}) {
  const { onThread, elsewhere, absent } = reading.spec34;
  const total = onThread.length + elsewhere.length + absent.length;
  if (total === 0) return null;
  return (
    <Section
      icon={<Network className="h-4 w-4 text-signal-cyan" />}
      title="Core graph relationships (spec §34)"
      subtitle="All nineteen, with the canonical home each lives in today. None of the nineteen is asset→asset, which is why none of them can move into asset_dependencies — the reconciliation is one graph payload and one honest ledger, not a migration of edges."
    >
      {[
        { label: "On this thread", rows: onThread },
        { label: "Live in another canonical home", rows: elsewhere },
        { label: "Absent — the object itself is not built", rows: absent },
      ].map((group) => (
        <div key={group.label}>
          <p className="text-[11px] font-semibold text-slate-300">
            {group.label} ({group.rows.length})
          </p>
          {group.rows.map((e) => (
            <div
              key={e.edge}
              className="mt-1 rounded border border-white/8 bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-slate-300"
            >
              <span className="text-slate-100">{e.edge}</span> · {e.home}
              {e.caseCount != null ? ` · ${e.caseCount} on this case` : ""}
              {e.note ? <div className="text-slate-400">{e.note}</div> : null}
            </div>
          ))}
        </div>
      ))}
    </Section>
  );
}
