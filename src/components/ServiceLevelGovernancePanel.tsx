import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, Network } from "lucide-react";
import { useAuth } from "./AuthProvider";
import {
  listAssetServiceLevels,
  listServiceLevelAssets,
  listServiceLevelEvidence,
  listServiceLevelHistory,
  recordAssetServiceLevel,
  verifyAssetServiceLevel,
  reconcileAssetServiceLevelCommand,
  ServiceLevelRefusal,
  type AssetServiceLevel,
  type ServiceConsequenceClass,
  type ServiceLevelAsset,
  type ServiceLevelEvidence,
  type ServiceLevelCommandTarget,
  type ServiceLevelHistory,
} from "../services/assetServiceLevelService";
import { recordServiceLevelCommandTarget, verifyServiceLevelCommandTarget } from "../services/assetServiceLevelCommands";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";
const buttonClass =
  "rounded-lg bg-signal-cyan/15 px-3 py-2 text-xs font-semibold text-signal-cyan hover:bg-signal-cyan/25 disabled:opacity-40";

const EMPTY_FORM = {
  serviceName: "",
  beneficiary: "",
  tolerableDowntimeHours: "",
  consequenceClass: "production" as ServiceConsequenceClass,
  restorationRank: "",
  notes: "",
  basis: "",
  evidenceItemId: "",
};

interface Props {
  onChanged: () => void;
}

function nullableNumber(value: string): number | null {
  return value.trim() === "" ? null : Number(value);
}

export function ServiceLevelGovernancePanel({ onChanged }: Props) {
  const { user, profile } = useAuth();
  const org = (profile as unknown as { organization_id?: string } | null)?.organization_id;
  const role = String(profile?.role ?? "").toLowerCase();
  // Observed context, not authority: SQL rereads and locks current membership.
  // Remount discards ALL local data, late responses and editor input on any change.
  if (!user || !profile || user.id !== profile.id || !org) {
    return <p>A current named workspace membership is required.</p>;
  }
  return <ScopedServiceLevelPanel key={`${user.id}:${org}:${role}`} onChanged={onChanged} role={role} actorId={user.id} organizationId={org} />;
}

function ScopedServiceLevelPanel({ onChanged, role, actorId, organizationId }: Props & { role: string; actorId: string; organizationId: string }) {
  const canWrite = [
    "reliability_engineer",
    "maintenance_manager",
    "executive",
    "admin",
  ].includes(role);
  const [assets, setAssets] = useState<ServiceLevelAsset[]>([]);
  const [levels, setLevels] = useState<AssetServiceLevel[]>([]);
  const [evidence, setEvidence] = useState<ServiceLevelEvidence[]>([]);
  const [history, setHistory] = useState<ServiceLevelHistory[]>([]);
  const [assetId, setAssetId] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Ephemeral observed outcome, never a parallel receipt store. A validated ACK
  // cannot become unknown merely because a later read is unavailable.
  const [pendingCommand, setPendingCommand] = useState<({ commandId: string; knownCommitted: boolean } & ServiceLevelCommandTarget) | null>(null);
  const scope = useMemo(() => ({ actorId, organizationId }), [actorId, organizationId]);
  const mounted = useRef(true);
  const submitting = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const selected = useMemo(
    () => levels.find((entry) => entry.asset_id === assetId) ?? null,
    [assetId, levels],
  );

  const load = useCallback(async () => {
    const [assetRows, levelRows] = await Promise.all([
      listServiceLevelAssets(scope),
      listAssetServiceLevels(scope),
    ]);
    if (!mounted.current) return;
    setAssets(assetRows);
    setLevels(levelRows);
    setAssetId((current) => current || assetRows[0]?.id || "");
  }, [scope]);

  useEffect(() => {
    void load().catch((cause: unknown) =>
      mounted.current && setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [load]);

  useEffect(() => {
    let active = true;
    setEvidence([]);
    setHistory([]);
    if (!assetId) {
      setEvidence([]);
      return;
    }
    void listServiceLevelEvidence(assetId, scope)
      .then((rows) => { if (active && mounted.current) setEvidence(rows); })
      .catch((cause: unknown) =>
        active && mounted.current && setError(cause instanceof Error ? cause.message : String(cause)),
      );
    void listServiceLevelHistory(assetId, scope)
      .then(rows => { if (active && mounted.current) setHistory(rows); })
      .catch((cause: unknown) => active && mounted.current && setError(cause instanceof Error ? cause.message : String(cause)));
    return () => { active = false; };
  }, [assetId, scope, levels]);

  useEffect(() => {
    setReviewNote("");
    if (!selected) {
      setForm(EMPTY_FORM);
      return;
    }
    setForm({
      serviceName: selected.service_name,
      beneficiary: selected.beneficiary ?? "",
      tolerableDowntimeHours:
        selected.tolerable_downtime_hours == null
          ? ""
          : String(selected.tolerable_downtime_hours),
      consequenceClass: selected.consequence_class ?? "production",
      restorationRank:
        selected.restoration_rank == null
          ? ""
          : String(selected.restoration_rank),
      notes: selected.notes ?? "",
      basis: selected.basis ?? "",
      evidenceItemId: selected.evidence_item_id ?? "",
    });
  }, [assetId, selected]);

  async function saveDraft() {
    if (submitting.current || pendingCommand) return;
    submitting.current = true;
    const commandId = crypto.randomUUID();
    const input = {
      assetId, serviceName: form.serviceName, beneficiary: form.beneficiary,
      tolerableDowntimeHours: nullableNumber(form.tolerableDowntimeHours),
      consequenceClass: form.consequenceClass, restorationRank: nullableNumber(form.restorationRank),
      notes: form.notes, basis: form.basis, evidenceItemId: form.evidenceItemId,
      expectedVersion: selected?.version ?? 0, commandId,
      observedActorId: actorId, observedOrganizationId: organizationId,
    };
    setPendingCommand({ commandId, knownCommitted: false, ...recordServiceLevelCommandTarget(input) });
    setBusy(true);
    setError(null);
    setMessage(null);
    let committed = false;
    try {
      await recordAssetServiceLevel(input);
      committed = true;
      if (!mounted.current) return;
      setPendingCommand(current => current?.commandId === commandId ? { ...current, knownCommitted: true } : current);
      await load();
      if (!mounted.current) return;
      setPendingCommand(null);
      setMessage("Draft saved. It remains outside cascade and restoration analysis until a different named human verifies it.");
      onChanged();
    } catch (cause) {
      if (!mounted.current) return;
      if (committed) {
        setError("Submission committed, but workspace refresh failed. Reconcile the receipt and refresh before another write; do not repeat the command.");
      } else if (cause instanceof ServiceLevelRefusal) {
        setPendingCommand(null);
        setError(cause.message);
      } else {
        setError("Submission outcome is unknown. Reconcile the canonical receipt before any further write; do not resubmit.");
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function verifyDraft() {
    if (!selected || submitting.current || pendingCommand) return;
    submitting.current = true;
    const commandId = crypto.randomUUID();
    setPendingCommand({ commandId, knownCommitted: false, ...verifyServiceLevelCommandTarget(assetId, selected.version, reviewNote, commandId, scope) });
    setBusy(true);
    setError(null);
    setMessage(null);
    let committed = false;
    try {
      await verifyAssetServiceLevel(assetId, selected.version, reviewNote, commandId, scope);
      committed = true;
      if (!mounted.current) return;
      setReviewNote("");
      setPendingCommand(current => current?.commandId === commandId ? { ...current, knownCommitted: true } : current);
      await load();
      if (!mounted.current) return;
      setPendingCommand(null);
      setMessage("Independently verified. Analysis admission still requires the exact live evidence basis to retain current standing.");
      onChanged();
    } catch (cause) {
      if (!mounted.current) return;
      if (committed) {
        setError("Submission committed, but workspace refresh failed. Reconcile the receipt and refresh before another write; do not repeat the command.");
      } else if (cause instanceof ServiceLevelRefusal) {
        setPendingCommand(null);
        setError(cause.message);
      } else {
        setError("Submission outcome is unknown. Reconcile the canonical receipt before any further write; do not resubmit.");
      }
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function reconcileSubmission() {
    if (!pendingCommand || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    setMessage(null);
    let committed = pendingCommand.knownCommitted;
    let refreshing = false;
    try {
      const receipt = await reconcileAssetServiceLevelCommand(pendingCommand.commandId, scope, pendingCommand);
      if (!mounted.current) return;
      if (receipt.outcome !== "committed") {
        setError(committed
          ? "Submission committed. Its receipt is not currently visible for reconciliation; keep the command frozen and do not resubmit."
          : "Submission outcome is unknown. No receipt is visible yet; absence is not permission to replay.");
        return;
      }
      committed = true;
      setPendingCommand(current => current?.commandId === pendingCommand.commandId ? { ...current, knownCommitted: true } : current);
      refreshing = true;
      await load();
      if (!mounted.current) return;
      setPendingCommand(null);
      setError(null);
      setMessage("Committed submission reconciled from the canonical audit receipt. No command was resent.");
      onChanged();
    } catch {
      if (mounted.current) setError(committed
        ? refreshing
          ? "Submission committed, but workspace refresh failed. Retain the canonical receipt target and reconcile before another write; do not resubmit."
          : "Submission committed. Read-only reconciliation failed; keep the command frozen and do not resubmit."
        : "Submission outcome is unknown. Read-only reconciliation failed; do not resubmit.");
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const validDraft =
    assetId.length > 0 &&
    form.serviceName.trim().length >= 3 &&
    form.beneficiary.trim().length >= 3 &&
    form.notes.trim().length >= 10 &&
    form.basis.trim().length >= 20 &&
    form.evidenceItemId.length > 0;

  return (
    <section
      aria-labelledby="service-level-governance-heading"
      className="space-y-4 rounded-xl border border-white/6 bg-[#0D1520] p-5"
    >
      <div>
        <h3
          id="service-level-governance-heading"
          className="flex items-center gap-2 text-sm font-semibold text-white"
        >
          <Network className="h-4 w-4 text-signal-cyan" aria-hidden />
          Service consequence governance
        </h3>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
          State what service this asset enables and what its loss means. Leave
          tolerable downtime or restoration rank blank when the evidence does
          not establish them—unknown values are never invented.
        </p>
        <p className="mt-2 text-xs text-amber-200">Unfinished operational-evidence rail: document-backed claims, normative downtime limits and restoration priority await the shared approved-source/primary-obligation contract. They are not supported by this scaffold and cannot be admitted by filling these fields.</p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200"
        >
          {error}
        </div>
      )}
      {message && (
        <div className="rounded border border-signal-cyan/25 bg-signal-cyan/5 px-3 py-2 text-xs text-signal-cyan">
          {message}
        </div>
      )}

      {pendingCommand && !busy && <button type="button" onClick={() => void reconcileSubmission()} className={buttonClass}>Reconcile submission</button>}

      <fieldset disabled={busy || pendingCommand !== null} className="space-y-4">

      <label className="block text-xs text-slate-400">
        Asset
        <select
          aria-label="Asset"
          value={assetId}
          onChange={(event) => {
            setMessage(null);
            setAssetId(event.target.value);
          }}
          className={`mt-1 ${inputClass}`}
        >
          <option value="">Choose an asset…</option>
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.tag ? `${asset.tag} — ` : ""}
              {asset.name}
            </option>
          ))}
        </select>
      </label>

      {selected && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={`rounded px-2 py-1 font-semibold ${selected.status === "verified" ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-200"}`}
          >
            {selected.status.toUpperCase()} · VERSION {selected.version}
          </span>
          <span className="text-slate-500">
            {selected.status === "verified" && selected.analysis_eligible === true
              ? "Included in analysis against the current evidence basis"
              : selected.status === "verified"
                ? "Excluded from analysis: current evidence standing is not established"
                : "Excluded from analysis pending independent verification"}
          </span>
        </div>
      )}

      {canWrite ? (
        <div className="grid gap-3 md:grid-cols-2">
          <input
            aria-label="Service name"
            value={form.serviceName}
            onChange={(event) =>
              setForm({ ...form, serviceName: event.target.value })
            }
            placeholder="Delivered service"
            className={inputClass}
          />
          <input
            aria-label="Beneficiary"
            value={form.beneficiary}
            onChange={(event) =>
              setForm({ ...form, beneficiary: event.target.value })
            }
            placeholder="Beneficiary / receiving system"
            className={inputClass}
          />
          <label className="text-xs text-slate-400">
            Tolerable downtime hours — optional
            <input
              aria-label="Tolerable downtime hours"
              type="number"
              min="0"
              step="any"
              value={form.tolerableDowntimeHours}
              onChange={(event) =>
                setForm({ ...form, tolerableDowntimeHours: event.target.value })
              }
              className={`mt-1 ${inputClass}`}
            />
          </label>
          <label className="text-xs text-slate-400">
            Restoration rank — optional
            <input
              aria-label="Restoration rank"
              type="number"
              min="1"
              step="1"
              value={form.restorationRank}
              onChange={(event) =>
                setForm({ ...form, restorationRank: event.target.value })
              }
              className={`mt-1 ${inputClass}`}
            />
          </label>
          <select
            aria-label="Consequence class"
            value={form.consequenceClass}
            onChange={(event) =>
              setForm({
                ...form,
                consequenceClass: event.target.value as ServiceConsequenceClass,
              })
            }
            className={inputClass}
          >
            <option value="safety">Safety</option>
            <option value="environmental">Environmental</option>
            <option value="regulatory">Regulatory</option>
            <option value="customer">Customer</option>
            <option value="production">Production</option>
            <option value="financial">Financial</option>
          </select>
          <select
            aria-label="Verified evidence"
            value={form.evidenceItemId}
            onChange={(event) =>
              setForm({ ...form, evidenceItemId: event.target.value })
            }
            className={inputClass}
          >
            <option value="">Verified supporting evidence…</option>
            {evidence.map((item) => (
              <option key={item.id} value={item.id}>
                {item.description}
              </option>
            ))}
          </select>
          <textarea
            aria-label="Consequence notes"
            value={form.notes}
            onChange={(event) =>
              setForm({ ...form, notes: event.target.value })
            }
            placeholder="Consequence and important limitations"
            className={inputClass}
          />
          <textarea
            aria-label="Evidence basis"
            value={form.basis}
            onChange={(event) =>
              setForm({ ...form, basis: event.target.value })
            }
            placeholder="Source, method and limitations (20+ characters)"
            className={inputClass}
          />
          <div className="md:col-span-2">
            <button
              type="button"
            disabled={busy || pendingCommand !== null || !validDraft}
              onClick={() => void saveDraft()}
              className={buttonClass}
            >
              {selected
                ? "Save new draft version"
                : "Record draft service consequence"}
            </button>
            {selected?.status === "verified" && (
              <p className="mt-2 text-[11px] text-amber-200">
                Any edit invalidates this verification and removes the
                consequence from analysis until it is independently verified
                again.
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          A named reliability engineer or accountable manager is required to
          record or verify this consequence.
        </p>
      )}

      {canWrite && selected?.status === "draft" && (
        <div className="space-y-2 rounded-lg border border-white/6 p-3">
          <p className="flex items-center gap-2 text-xs font-semibold text-slate-200">
            <BadgeCheck className="h-4 w-4 text-emerald-300" aria-hidden />
            Independent verification
          </p>
          <textarea
            aria-label="Independent review note"
            value={reviewNote}
            onChange={(event) => setReviewNote(event.target.value)}
            placeholder="State how the evidence, consequence and any unknown values were independently checked (20+ characters)"
            className={inputClass}
          />
          <button
            type="button"
            disabled={busy || pendingCommand !== null || reviewNote.trim().length < 20}
            onClick={() => void verifyDraft()}
            className={buttonClass}
          >
            Verify current version
          </button>
          <p className="text-[11px] text-slate-500">
            The author cannot verify their own record. Verification changes
            analysis eligibility only; it does not authorize work, operation,
            risk acceptance or restoration.
          </p>
        </div>
      )}
      </fieldset>
      <section aria-label="Canonical service consequence history" className="space-y-2 border-t border-white/10 pt-3">
        <h4 className="text-xs font-semibold text-slate-200">Visible canonical decision history</h4>
        <p className="text-[11px] text-slate-500">Access-filtered immutable receipts, not a rewritten latest-version summary. Historical review does not establish current evidence standing.</p>
        {history.length === 0 && <p className="text-xs text-slate-500">No history is visible for this asset.</p>}
        {history.map(entry => <details key={entry.id} className="rounded border border-white/10 p-2 text-xs text-slate-300">
          <summary>{entry.created_at} · {entry.entity_type} · Actor {entry.actor}</summary>
          <p className="mt-2">Previous canonical record</p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(entry.previous_state, null, 2)}</pre>
          <p>New canonical record</p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(entry.new_state, null, 2)}</pre>
          <p>Canonical receipt context</p>
          <pre className="overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify({ id: entry.id, event_data: entry.event_data, approval_reference: entry.approval_reference }, null, 2)}</pre>
        </details>)}
      </section>
    </section>
  );
}
