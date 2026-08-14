/**
 * NotificationScreening — report a fault, screen what was reported, convert it
 * into work, and confirm duplicates (capability register C9.02, C5.06, C6.08).
 *
 * The migrations behind this shipped first and sat unreachable: the screening
 * lifecycle in 20260904090000 (open | in_planning | converted | rejected |
 * merged) had never had a single transition written from the product, and the
 * duplicate detector had no surface on which a human could confirm anything.
 *
 * Two rules from those migrations are load-bearing here and are enforced in the
 * database, not merely honoured by this screen:
 *
 *   - Duplicates are shown as PAIRS, never as a cluster with a merge-all
 *     control. Similarity is not transitive, so chaining A~B~C would merge two
 *     genuinely different faults through an intermediate report.
 *   - Merging is a human act. Nothing here, and nothing autonomous anywhere,
 *     merges without a person confirming this pair.
 *
 * Response class is asked at conversion because that is the only moment anyone
 * knows the answer. Leaving it unset is a legitimate choice and reports as
 * unclassified rather than being defaulted to "scheduled", which would report
 * zero emergency work for a site that simply was not asked.
 */
import { useState } from "react";
import { AlertTriangle, Copy, Plus, Wrench } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { LoadingState, ErrorState } from "../components/ui/AsyncStates";

interface Notification {
  id: string;
  notification_no: string | null;
  description: string;
  notification_type: string;
  reported_by: string | null;
  reported_at: string;
  status: string;
  asset_id: string | null;
  asset_name: string | null;
  work_order_id: string | null;
}

interface Candidate {
  keep_id: string;
  keep_no: string | null;
  keep_description: string;
  duplicate_id: string;
  duplicate_no: string | null;
  duplicate_description: string;
  hours_apart: number;
  similarity: number;
  rationale: string;
}

interface AssetOption {
  id: string;
  name: string;
}

const RESPONSE_CLASSES = ["emergency", "urgent", "scheduled"] as const;

export default function NotificationScreening() {
  const [flash, setFlash] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [assetId, setAssetId] = useState("");
  const [description, setDescription] = useState("");
  const [notificationType, setNotificationType] = useState("fault");
  const [busy, setBusy] = useState(false);

  const queue = useAsyncData<Notification[]>(async () => {
    const { data, error } = await supabase.rpc("get_open_notifications", {});
    if (error) throw new Error(error.message);
    return (data ?? []) as Notification[];
  }, []);

  const duplicates = useAsyncData<Candidate[]>(async () => {
    const { data, error } = await supabase.rpc(
      "get_duplicate_notification_candidates",
      {},
    );
    if (error) throw new Error(error.message);
    return (data ?? []) as Candidate[];
  }, []);

  const assets = useAsyncData<AssetOption[]>(async () => {
    const { data, error } = await supabase
      .from("assets")
      .select("id,name")
      .order("name");
    if (error) throw new Error(error.message);
    return (data ?? []) as AssetOption[];
  }, []);

  // Every write goes through an RPC that returns {error} rather than throwing,
  // so a refusal reads as the sentence the database wrote — "these are on
  // different equipment", "say why it was rejected" — instead of being
  // flattened into a generic failure toast.
  const call = async (fn: string, args: Record<string, unknown>) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc(fn, args);
      if (error) throw new Error(error.message);
      const result = data as { error?: string } | null;
      if (result?.error) {
        setFlash(result.error);
        return false;
      }
      queue.refetch();
      duplicates.refetch();
      return true;
    } catch (e) {
      setFlash(e instanceof Error ? e.message : "That did not work.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const report = async () => {
    const ok = await call("raise_maintenance_notification", {
      p_asset_id: assetId || null,
      p_description: description,
      p_notification_type: notificationType,
    });
    if (ok) {
      setShowReport(false);
      setDescription("");
      setAssetId("");
      setFlash("Reported.");
    }
  };

  const screen = async (id: string, status: string) => {
    const reason =
      status === "rejected"
        ? window.prompt("Why is this being rejected? The reporter needs to know whether to raise it again.")
        : null;
    if (status === "rejected" && !reason) return;
    if (await call("screen_maintenance_notification", { p_id: id, p_status: status, p_reason: reason }))
      setFlash(status === "rejected" ? "Rejected." : "Accepted into planning.");
  };

  const convert = async (n: Notification) => {
    const title = window.prompt("Work order title", n.description.slice(0, 60));
    if (!title) return;
    const responseClass = window.prompt(
      `Response class — ${RESPONSE_CLASSES.join(" / ")}. Leave blank if unknown; it will report as unclassified rather than be guessed.`,
      "",
    );
    if (await call("convert_notification_to_work_order", {
      p_id: n.id,
      p_title: title,
      p_priority: "medium",
      p_work_type: "corrective",
      p_response_class: responseClass?.trim() ? responseClass.trim() : null,
    }))
      setFlash("Converted to a work order.");
  };

  const merge = async (c: Candidate) => {
    const label = c.duplicate_no ?? c.duplicate_id.slice(0, 8);
    const keep = c.keep_no ?? c.keep_id.slice(0, 8);
    if (!window.confirm(`Confirm ${label} is a duplicate of ${keep}?\n\n${c.rationale}`)) return;
    if (await call("merge_maintenance_notification", {
      p_duplicate_id: c.duplicate_id,
      p_keep_id: c.keep_id,
      p_note: null,
    }))
      setFlash("Merged. The duplicate is kept, marked, and linked to the survivor.");
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl text-slate-100">Notifications</h1>
          <p className="mt-1 text-sm text-slate-400">
            Faults as reported, before they become work. Screening decides what
            is real; conversion decides what gets done.
          </p>
        </div>
        <button
          onClick={() => setShowReport(true)}
          className="flex items-center gap-2 rounded-lg border border-signal-cyan/40 bg-signal-cyan/10 px-3 py-2 text-sm text-signal-cyan"
        >
          <Plus className="h-4 w-4" /> Report a fault
        </button>
      </div>

      {flash && (
        <div className="rounded-lg border border-white/10 bg-overlook-deep/60 px-4 py-3 text-sm text-slate-300">
          {flash}
        </div>
      )}

      {showReport && (
        <div className="rounded-xl border border-white/10 bg-overlook-deep/40 p-4">
          <p className="text-sm text-slate-300">Report a fault</p>
          <div className="mt-3 space-y-3">
            <div>
              <label htmlFor="notif-asset" className="block text-xs text-slate-400">
                Equipment
              </label>
              <select
                id="notif-asset"
                value={assetId}
                onChange={(e) => setAssetId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-overlook-rule bg-overlook-void/60 px-3 py-2 text-sm text-slate-100"
              >
                <option value="">Select equipment…</option>
                {(assets.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="notif-type" className="block text-xs text-slate-400">Type</label>
              <select
                id="notif-type"
                value={notificationType}
                onChange={(e) => setNotificationType(e.target.value)}
                className="mt-1 w-full rounded-lg border border-overlook-rule bg-overlook-void/60 px-3 py-2 text-sm text-slate-100"
              >
                {["fault", "observation", "request", "safety"].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="notif-desc" className="block text-xs text-slate-400">
                What was observed
              </label>
              <textarea
                id="notif-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="In your own words — coding happens later, at planning."
                className="mt-1 w-full rounded-lg border border-overlook-rule bg-overlook-void/60 px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={report}
                disabled={busy}
                className="rounded-lg border border-signal-cyan/40 bg-signal-cyan/10 px-3 py-2 text-sm text-signal-cyan disabled:opacity-50"
              >
                Report
              </button>
              <button
                onClick={() => setShowReport(false)}
                className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-400"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Duplicates first: screening a report that is already known wastes the
          planner's time and, worse, creates the second work order. */}
      <section>
        <div className="flex items-center gap-2">
          <Copy className="h-4 w-4 text-amber-300" />
          <h2 className="text-sm text-slate-200">Possible duplicates</h2>
        </div>
        {duplicates.loading ? (
          <LoadingState />
        ) : duplicates.error ? (
          <ErrorState message={duplicates.error} onRetry={duplicates.refetch} />
        ) : (duplicates.data ?? []).length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">
            No candidates. Reports are only paired when they are on the same
            equipment, close in time, and similarly worded.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            {(duplicates.data ?? []).map((c) => (
              <div
                key={`${c.keep_id}-${c.duplicate_id}`}
                className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4"
              >
                <p className="text-xs text-amber-200">
                  {(c.keep_no ?? c.keep_id.slice(0, 8))} · {(c.duplicate_no ?? c.duplicate_id.slice(0, 8))} —{" "}
                  {c.hours_apart}h apart, {Math.round(c.similarity * 100)}% similar
                </p>
                <p className="mt-2 text-sm text-slate-300">{c.keep_description}</p>
                <p className="mt-1 text-sm text-slate-400">{c.duplicate_description}</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">{c.rationale}</p>
                <button
                  onClick={() => merge(c)}
                  disabled={busy}
                  className="mt-3 rounded-lg border border-amber-400/40 px-3 py-1.5 text-xs text-amber-200 disabled:opacity-50"
                >
                  Confirm duplicate
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm text-slate-200">Open queue</h2>
        </div>
        {queue.loading ? (
          <LoadingState />
        ) : queue.error ? (
          <ErrorState message={queue.error} onRetry={queue.refetch} />
        ) : (queue.data ?? []).length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">Nothing open.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {(queue.data ?? []).map((n) => (
              <div key={n.id} className="rounded-xl border border-white/6 bg-overlook-deep/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      {n.asset_name ?? "unassigned"} · {n.notification_type} · {n.status}
                    </p>
                    <p className="mt-1 whitespace-pre-line text-sm text-slate-200">{n.description}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {n.reported_by ?? "unknown"} · {new Date(n.reported_at).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {n.status === "open" && (
                    <>
                      <button
                        onClick={() => screen(n.id, "in_planning")}
                        disabled={busy}
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 disabled:opacity-50"
                      >
                        Accept into planning
                      </button>
                      <button
                        onClick={() => screen(n.id, "rejected")}
                        disabled={busy}
                        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => convert(n)}
                    disabled={busy}
                    className="flex items-center gap-1.5 rounded-lg border border-signal-cyan/40 px-3 py-1.5 text-xs text-signal-cyan disabled:opacity-50"
                  >
                    <Wrench className="h-3 w-3" /> Convert to work order
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
