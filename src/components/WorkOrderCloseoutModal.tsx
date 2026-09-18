/** Type-aware closeout: corrective work captures FRACAS evidence, preventive
 * work captures a direct PM finding against its governed target mechanism,
 * and other work captures general completion evidence. */
import { useEffect, useState } from "react";
import { ClipboardCheck, Loader2, X } from "lucide-react";
import {
  closeWorkOrder,
  getPmTargetMechanism,
  type CloseoutInput,
  type PmMechanismOption,
} from "../services/workOrderCloseout";

interface Props {
  workOrderId: string;
  workOrderTitle: string;
  isAiGenerated: boolean;
  workOrderType?: string;
  onClose: () => void;
  onClosedOut: () => void;
}

export function WorkOrderCloseoutModal({
  workOrderId,
  workOrderTitle,
  isAiGenerated,
  workOrderType,
  onClose,
  onClosedOut,
}: Props) {
  const [form, setForm] = useState({
    actualFailureMode: "",
    actualCause: "",
    correctiveAction: "",
    laborHours: "",
    downtimeHours: "",
    partsUsed: "",
    technicianComments: "",
  });
  const [aiUseful, setAiUseful] = useState<boolean | null>(null);
  const [pmTarget, setPmTarget] = useState<PmMechanismOption | null>(null);
  const [findingOutcome, setFindingOutcome] = useState<"no_finding" | "degradation_found" | "defect_found" | "">("");
  const [findingDetail, setFindingDetail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Legacy and human-created work orders may not yet carry work_type. The
  // canonical ingestion contract defines blank as corrective, so preserve
  // FRACAS closeout rather than silently downgrading them to a general note.
  const isCorrective = !workOrderType || workOrderType === "corrective";
  const isPreventive = workOrderType === "preventive";

  useEffect(() => {
    if (!isPreventive) return;
    getPmTargetMechanism(workOrderId).then((target) => {
      setPmTarget(target);
      if (!target) setError("This PM has no prospective target mechanism on its adopted job plan. Configure the plan before closeout.");
    }).catch((caught) => setError((caught as Error).message));
  }, [isPreventive, workOrderId]);

  const requiredComplete =
    (!isCorrective || (form.actualFailureMode.trim() && form.actualCause.trim() && form.correctiveAction.trim())) &&
    (!isPreventive || (pmTarget && findingOutcome && findingDetail.trim().length >= 10)) &&
    ((isCorrective || isPreventive) || form.technicianComments.trim().length >= 10) &&
    form.laborHours !== "" &&
    form.downtimeHours !== "" &&
    (!isAiGenerated || aiUseful !== null);

  const submit = async () => {
    if (!requiredComplete) return;
    setSaving(true);
    setError(null);
    try {
      const input: CloseoutInput = {
        actualFailureMode: form.actualFailureMode.trim(),
        actualCause: form.actualCause.trim(),
        correctiveAction: form.correctiveAction.trim(),
        laborHours: Number(form.laborHours),
        downtimeHours: Number(form.downtimeHours),
        partsUsed: form.partsUsed.trim() || undefined,
        technicianComments: form.technicianComments.trim() || undefined,
        aiAlertUseful: isAiGenerated ? aiUseful : null,
        findingOutcome: findingOutcome || undefined,
        findingDetail: findingDetail.trim() || undefined,
      };
      await closeWorkOrder(workOrderId, input);
      onClosedOut();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Closeout failed.");
      setSaving(false);
    }
  };

  const textField = (
    label: string,
    key: keyof typeof form,
    placeholder: string,
    required = true,
  ) => (
    <div>
      <label className="block text-xs font-medium text-slate-300">
        {label}
        {required && <span className="ml-1 text-amber-300">*</span>}
      </label>
      <input
        type="text"
        value={form[key]}
        onChange={(e) => set(key)(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-400 focus:border-teal-400 focus:outline-hidden focus:ring-1 focus:ring-teal-400"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4">
      <div className="mt-[6%] max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-teal-300" aria-hidden />
            <h2 className="text-lg font-semibold text-white">
              Close out work order
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="text-slate-400 hover:text-white focus:outline-hidden focus-visible:ring-2 focus-visible:ring-teal-300"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-400">{workOrderTitle}</p>
        <p className="mt-1 text-xs text-slate-400">
          Complete closeout data drives FRACAS learning, spares strategy and
          availability tracking — required fields marked{" "}
          <span className="text-amber-300">*</span>.
        </p>

        <div className="mt-4 space-y-3">
          {isCorrective && <>
            {textField("Actual failure mode", "actualFailureMode", "e.g. Mechanical seal leakage")}
            {textField("Actual cause", "actualCause", "e.g. Dry running after suction upset")}
            {textField("Corrective action", "correctiveAction", "e.g. Replaced seal, verified flush plan")}
          </>}
          {isPreventive && <div className="space-y-3 rounded-lg border border-teal-500/20 bg-teal-500/5 p-3">
            <div className="text-xs text-slate-300">Prospective target mechanism<span className="ml-1 text-amber-300">*</span>
              <div className="mt-1 rounded-md border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-white">
                {pmTarget?.name ?? "Not configured on an adopted job plan"}
              </div>
              <p className="mt-1 text-[11px] text-slate-500">Fixed by the adopted job plan before execution; it cannot be changed at closeout.</p>
            </div>
            <label className="block text-xs font-medium text-slate-300">PM finding<span className="ml-1 text-amber-300">*</span>
              <select value={findingOutcome} onChange={(event)=>setFindingOutcome(event.target.value as typeof findingOutcome)} className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white">
                <option value="">Select the observed outcome</option><option value="no_finding">No degradation or defect found</option><option value="degradation_found">Degradation found</option><option value="defect_found">Defect found</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-300">Inspection evidence<span className="ml-1 text-amber-300">*</span>
              <textarea value={findingDetail} onChange={(event)=>setFindingDetail(event.target.value)} rows={3} placeholder="Record the measurement, condition, or observation supporting this outcome." className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white" />
            </label>
          </div>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300">
                Labour hours<span className="ml-1 text-amber-300">*</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={form.laborHours}
                onChange={(e) => set("laborHours")(e.target.value)}
                aria-label="Labour hours"
                className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:border-teal-400 focus:outline-hidden focus:ring-1 focus:ring-teal-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300">
                Downtime hours<span className="ml-1 text-amber-300">*</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={form.downtimeHours}
                onChange={(e) => set("downtimeHours")(e.target.value)}
                aria-label="Downtime hours"
                className="mt-1 w-full rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:border-teal-400 focus:outline-hidden focus:ring-1 focus:ring-teal-400"
              />
            </div>
          </div>
          {textField(
            "Parts used",
            "partsUsed",
            "Part numbers / consumables",
            false,
          )}
          {textField(
            "Technician comments",
            "technicianComments",
            "Field observations worth keeping",
            false,
          )}

          {isAiGenerated && (
            <div>
              <p className="text-xs font-medium text-slate-300">
                Was the SyncAI alert useful?
                <span className="ml-1 text-amber-300">*</span>
              </p>
              <div className="mt-1 flex gap-2">
                <button
                  onClick={() => setAiUseful(true)}
                  aria-pressed={aiUseful === true}
                  className={`rounded-md border px-3 py-1.5 text-sm focus:outline-hidden focus-visible:ring-2 focus-visible:ring-teal-300 ${
                    aiUseful === true
                      ? "border-teal-400 bg-teal-500/15 text-teal-300"
                      : "border-slate-600 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  Yes — it caught the problem
                </button>
                <button
                  onClick={() => setAiUseful(false)}
                  aria-pressed={aiUseful === false}
                  className={`rounded-md border px-3 py-1.5 text-sm focus:outline-hidden focus-visible:ring-2 focus-visible:ring-teal-300 ${
                    aiUseful === false
                      ? "border-amber-400 bg-amber-500/15 text-amber-300"
                      : "border-slate-600 text-slate-300 hover:bg-slate-800"
                  }`}
                >
                  No — not useful
                </button>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-teal-300"
            >
              Cancel
            </button>
            <button
              onClick={() => void submit()}
              disabled={saving || !requiredComplete}
              data-testid="submit-closeout"
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-emerald-300"
            >
              {saving && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              )}
              Complete work order
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
