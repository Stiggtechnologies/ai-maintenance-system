import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, Network } from "lucide-react";
import { useAuth } from "./AuthProvider";
import {
  listAssetServiceLevels,
  listServiceLevelAssets,
  listServiceLevelEvidence,
  recordAssetServiceLevel,
  verifyAssetServiceLevel,
  type AssetServiceLevel,
  type ServiceConsequenceClass,
  type ServiceLevelAsset,
  type ServiceLevelEvidence,
} from "../services/assetServiceLevelService";

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
  const { profile } = useAuth();
  const role = String(profile?.role ?? "").toLowerCase();
  const canWrite = [
    "reliability_engineer",
    "maintenance_manager",
    "executive",
    "admin",
  ].includes(role);
  const [assets, setAssets] = useState<ServiceLevelAsset[]>([]);
  const [levels, setLevels] = useState<AssetServiceLevel[]>([]);
  const [evidence, setEvidence] = useState<ServiceLevelEvidence[]>([]);
  const [assetId, setAssetId] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [reviewNote, setReviewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => levels.find((entry) => entry.asset_id === assetId) ?? null,
    [assetId, levels],
  );

  const load = useCallback(async () => {
    const [assetRows, levelRows] = await Promise.all([
      listServiceLevelAssets(),
      listAssetServiceLevels(),
    ]);
    setAssets(assetRows);
    setLevels(levelRows);
    setAssetId((current) => current || assetRows[0]?.id || "");
  }, []);

  useEffect(() => {
    void load().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, [load]);

  useEffect(() => {
    if (!assetId) {
      setEvidence([]);
      return;
    }
    void listServiceLevelEvidence(assetId)
      .then(setEvidence)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      );
  }, [assetId]);

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
  }, [selected]);

  async function saveDraft() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await recordAssetServiceLevel({
        assetId,
        serviceName: form.serviceName,
        beneficiary: form.beneficiary,
        tolerableDowntimeHours: nullableNumber(form.tolerableDowntimeHours),
        consequenceClass: form.consequenceClass,
        restorationRank: nullableNumber(form.restorationRank),
        notes: form.notes,
        basis: form.basis,
        evidenceItemId: form.evidenceItemId,
        expectedVersion: selected?.version ?? 0,
      });
      setMessage(
        "Draft saved. It remains outside cascade and restoration analysis until a different named human verifies it.",
      );
      await load();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function verifyDraft() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await verifyAssetServiceLevel(assetId, selected.version, reviewNote);
      setReviewNote("");
      setMessage(
        "Independently verified. This consequence now informs dependency and restoration analysis.",
      );
      await load();
      onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
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
            {selected.status === "verified"
              ? "Included in analysis"
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
              disabled={busy || !validDraft}
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
            disabled={busy || reviewNote.trim().length < 20}
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
    </section>
  );
}
