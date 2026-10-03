import { useCallback, useEffect, useState } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Loader2,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import {
  decideMaintenanceChangeControl,
  getMaintenanceChangeControlWorkspace,
  requestCriticalWorkDeferral,
  requestSafetyCriticalReschedule,
  requestSafetyCriticalWork,
  type MaintenanceChangeControlWorkspace,
  type MaintenanceControlAction,
} from "../services/maintenanceChangeControlService";

const ACTION_LABELS: Record<MaintenanceControlAction, string> = {
  defer_critical_work: "Defer critical work",
  create_safety_critical_work: "Create safety-critical work",
  reschedule_safety_critical_work: "Reschedule safety-critical work",
};

function toIso(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error("Enter a valid future date.");
  return parsed.toISOString();
}

export function MaintenanceChangeControlPanel() {
  const [workspace, setWorkspace] =
    useState<MaintenanceChangeControlWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [action, setAction] =
    useState<MaintenanceControlAction>("defer_critical_work");
  const [workOrderId, setWorkOrderId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [proposedDate, setProposedDate] = useState("");
  const [reason, setReason] = useState("");
  const [consequence, setConsequence] = useState("");
  const [validation, setValidation] = useState("");
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>(
    {},
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await getMaintenanceChangeControlWorkspace();
      setWorkspace(next);
      setWorkOrderId((current) => current || next.workOrders[0]?.id || "");
      setAssetId((current) => current || next.assets[0]?.id || "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load change control.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submitRequest() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const common = {
        proposedDate: toIso(proposedDate),
        reason,
        consequenceOfWrong: consequence,
        requiredValidation: validation,
      };
      if (action === "defer_critical_work") {
        await requestCriticalWorkDeferral({ ...common, workOrderId });
      } else if (action === "create_safety_critical_work") {
        await requestSafetyCriticalWork({
          ...common,
          assetId,
          title,
          description,
        });
      } else {
        await requestSafetyCriticalReschedule({ ...common, workOrderId });
      }
      setNotice("Request recorded for an independent maintenance-manager decision.");
      setReason("");
      setConsequence("");
      setValidation("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The request was refused.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(
    approvalId: string,
    outcome: "approved" | "rejected",
  ) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await decideMaintenanceChangeControl({
        approvalId,
        outcome,
        note: decisionNotes[approvalId] ?? "",
      });
      setNotice(`Request ${outcome}. The canonical work record is the source of truth.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The decision was refused.");
    } finally {
      setBusy(false);
    }
  }

  if (loading && !workspace) {
    return (
      <div className="rounded-2xl border border-white/8 bg-[#0D1520] p-5 text-sm text-slate-400">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading governed
        maintenance changes…
      </div>
    );
  }

  return (
    <section className="space-y-4 rounded-2xl border border-amber-400/20 bg-[#0D1520] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-amber-300">
            <ShieldAlert className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-[0.16em]">
              Human approval boundary
            </span>
          </div>
          <h2 className="text-lg font-semibold text-white">
            Maintenance Change Control
          </h2>
          <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-400">
            {workspace?.control}
          </p>
        </div>
        <CalendarClock className="h-6 w-6 text-slate-500" />
      </div>

      {error && (
        <div className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-teal-400/20 bg-teal-500/10 px-3 py-2 text-xs text-teal-300">
          {notice}
        </div>
      )}

      {workspace?.canRequest && (
        <div className="rounded-xl border border-white/8 bg-black/10 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-200">
            Route a bounded change
          </h3>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-xs text-slate-400">
              Governed action
              <select
                aria-label="Governed action"
                value={action}
                onChange={(event) =>
                  setAction(event.target.value as MaintenanceControlAction)
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#111B28] px-3 py-2 text-sm text-slate-200"
              >
                {Object.entries(ACTION_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {action === "create_safety_critical_work" ? (
              <label className="text-xs text-slate-400">
                Asset
                <select
                  aria-label="Asset"
                  value={assetId}
                  onChange={(event) => setAssetId(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-[#111B28] px-3 py-2 text-sm text-slate-200"
                >
                  {workspace.assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.tag ? `${asset.tag} — ` : ""}
                      {asset.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="text-xs text-slate-400">
                Work order
                <select
                  aria-label="Work order"
                  value={workOrderId}
                  onChange={(event) => setWorkOrderId(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-[#111B28] px-3 py-2 text-sm text-slate-200"
                >
                  {workspace.workOrders
                    .filter((work) =>
                      action === "reschedule_safety_critical_work"
                        ? work.safetyFlag
                        : true,
                    )
                    .map((work) => (
                      <option key={work.id} value={work.id}>
                        {work.number ? `${work.number} — ` : ""}
                        {work.title}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {action === "create_safety_critical_work" && (
              <>
                <input
                  aria-label="Work title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Safety-critical work title"
                  className="rounded-lg border border-white/10 bg-[#111B28] px-3 py-2 text-sm text-slate-200"
                />
                <textarea
                  aria-label="Work description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Bounded work scope and safety function"
                  className="rounded-lg border border-white/10 bg-[#111B28] px-3 py-2 text-sm text-slate-200"
                />
              </>
            )}
            <label className="text-xs text-slate-400">
              Proposed date
              <input
                aria-label="Proposed date"
                type="datetime-local"
                value={proposedDate}
                onChange={(event) => setProposedDate(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#111B28] px-3 py-2 text-sm text-slate-200"
              />
            </label>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why is this change needed?"
              className="rounded-lg border border-white/10 bg-[#111B28] px-3 py-2 text-sm text-slate-200"
            />
            <textarea
              value={consequence}
              onChange={(event) => setConsequence(event.target.value)}
              placeholder="Consequence if the decision is wrong"
              className="rounded-lg border border-white/10 bg-[#111B28] px-3 py-2 text-sm text-slate-200"
            />
            <textarea
              value={validation}
              onChange={(event) => setValidation(event.target.value)}
              placeholder="Required validation"
              className="rounded-lg border border-white/10 bg-[#111B28] px-3 py-2 text-sm text-slate-200"
            />
          </div>
          <button
            disabled={busy}
            onClick={() => void submitRequest()}
            className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-200 disabled:opacity-40"
          >
            Route for independent approval
          </button>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-200">Governed requests</h3>
        {workspace?.requests.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/10 px-4 py-5 text-xs text-slate-500">
            No maintenance changes have been routed in this tenant.
          </div>
        )}
        {workspace?.requests.map((request) => {
          const pending = ["required", "pending"].includes(request.status);
          const mayDecide =
            pending && workspace.canDecide && !request.isOwnRequest;
          return (
            <article
              key={request.id}
              className="rounded-xl border border-white/8 bg-black/10 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-amber-300">
                    {ACTION_LABELS[request.action]}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-100">
                    {request.workOrderTitle}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Requested by {request.requestedBy ?? "named tenant member"} ·{" "}
                    {new Date(request.requestedAt).toLocaleString()}
                  </div>
                </div>
                <span className="rounded-full border border-white/10 px-2 py-1 text-[11px] uppercase text-slate-400">
                  {request.status}
                </span>
              </div>
              <dl className="mt-3 grid gap-2 text-xs text-slate-400 md:grid-cols-2">
                <div>
                  <dt className="text-slate-500">Proposed effective date</dt>
                  <dd>{new Date(request.proposedEffectiveAt).toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Reason</dt>
                  <dd>{request.reason}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Consequence if wrong</dt>
                  <dd>{request.consequenceOfWrong}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Required validation</dt>
                  <dd>{request.requiredValidation}</dd>
                </div>
              </dl>
              {request.action === "defer_critical_work" &&
                !request.riskAcceptanceReady &&
                pending && (
                  <p className="mt-3 text-xs text-amber-300">
                    Approval is locked until this deciding manager holds a current
                    acceptance of the linked residual risk.
                  </p>
                )}
              {mayDecide && (
                <div className="mt-3 border-t border-white/6 pt-3">
                  <label className="text-xs text-slate-400">
                    Decision basis for {request.workOrderTitle}
                    <textarea
                      aria-label={`Decision basis for ${request.workOrderTitle}`}
                      value={decisionNotes[request.id] ?? ""}
                      onChange={(event) =>
                        setDecisionNotes((current) => ({
                          ...current,
                          [request.id]: event.target.value,
                        }))
                      }
                      className="mt-1 w-full rounded-lg border border-white/10 bg-[#111B28] px-3 py-2 text-sm text-slate-200"
                    />
                  </label>
                  <div className="mt-2 flex gap-2">
                    <button
                      disabled={
                        busy ||
                        (request.action === "defer_critical_work" &&
                          !request.riskAcceptanceReady)
                      }
                      onClick={() => void decide(request.id, "approved")}
                      className="flex items-center gap-1.5 rounded-lg border border-teal-400/30 bg-teal-500/10 px-3 py-2 text-xs font-semibold text-teal-300 disabled:opacity-40"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" /> Approve request
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void decide(request.id, "rejected")}
                      className="flex items-center gap-1.5 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-300 disabled:opacity-40"
                    >
                      <XCircle className="h-3.5 w-3.5" /> Reject request
                    </button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
