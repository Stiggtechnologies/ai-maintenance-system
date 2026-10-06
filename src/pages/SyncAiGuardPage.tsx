/**
 * SyncAI Guard. Rail decisions are audit_events. Anomaly findings are
 * recommendations with evidence and a required approval. Approve and reject
 * go through the existing operating-loop service, so the named human,
 * decision, work action, and learning event stay on that path.
 * Direct plant execution is not a control on this page.
 */
import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "../components/ui/AsyncStates";
import { supabase } from "../lib/supabase";
import {
  approveRecommendation,
  setRecommendationStatus,
} from "../services/operatingLoopService";
import type { RecommendationRow } from "../types/operating";

interface RailEvent {
  id: string;
  created_at: string;
  actor: string | null;
  event_data: {
    stage?: string;
    action?: string;
    rail?: string;
    reason?: string;
    provider?: string;
    excerpt?: string | null;
    plant_execution?: string;
  } | null;
}

interface GuardSnapshot {
  enabled: boolean;
  events: RailEvent[];
  findings: RecommendationRow[];
  error: string | null;
}

function isGuardAdmin(role: unknown): boolean {
  return role === "admin" || role === "ai_admin";
}

async function loadGuardSnapshot(): Promise<GuardSnapshot> {
  const flag = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("flag_key", "syncai_guard")
    .maybeSingle();
  const events = await supabase
    .from("audit_events")
    .select("id, created_at, actor, event_data")
    .eq("entity_type", "syncai_guard_rail")
    .order("created_at", { ascending: false })
    .limit(50);
  const findings = await supabase
    .from("recommendations")
    .select("*")
    .like("source_finding_id", "syncai-guard:%")
    .order("created_at", { ascending: false })
    .limit(50);

  const problem = flag.error ?? events.error ?? findings.error;
  return {
    enabled: !flag.error && flag.data?.enabled === true,
    events: (events.data ?? []) as RailEvent[],
    findings: (findings.data ?? []) as RecommendationRow[],
    error: problem ? problem.message : null,
  };
}

export function SyncAiGuardPage() {
  const { profile } = useAuth();
  const admin = isGuardAdmin(profile?.role);
  const [snapshot, setSnapshot] = useState<GuardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await loadGuardSnapshot();
    setSnapshot(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onToggle() {
    if (!snapshot) return;
    setBusy("flag");
    setNotice(null);
    const { data, error } = await supabase.rpc("set_syncai_guard_enabled", {
      p_enabled: !snapshot.enabled,
    });
    const payload = data as { error?: string; enabled?: boolean } | null;
    if (error || payload?.error) {
      setNotice(
        error?.message ?? payload?.error ?? "Could not change the flag.",
      );
    } else {
      setNotice(
        payload?.enabled
          ? "SyncAI Guard is on for this organization. Plant execution stays disabled."
          : "SyncAI Guard is off. The assistant path is unchanged.",
      );
    }
    setBusy(null);
    await refresh();
  }

  async function onScan() {
    setBusy("scan");
    setNotice(null);
    const { data, error } = await supabase.rpc("raise_syncai_guard_findings", {
      p_z_threshold: 3,
      p_include_synthetic: true,
    });
    const payload = data as {
      error?: string | null;
      created?: number;
      skipped_existing?: number;
    } | null;
    if (error || payload?.error) {
      setNotice(error?.message ?? payload?.error ?? "Scan failed.");
    } else {
      setNotice(
        `Scan created ${payload?.created ?? 0} finding(s) and skipped ${payload?.skipped_existing ?? 0} already recorded today. Nothing was sent to plant equipment.`,
      );
    }
    setBusy(null);
    await refresh();
  }

  async function onApprove(rec: RecommendationRow) {
    setBusy(rec.id);
    setNotice(null);
    try {
      await approveRecommendation(rec);
      setNotice(
        `Approved ${rec.title}. The named approver is the signed-in user. Plant equipment was not commanded.`,
      );
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Approval failed.");
    } finally {
      setBusy(null);
    }
  }

  async function onReject(rec: RecommendationRow) {
    setBusy(rec.id);
    setNotice(null);
    try {
      await setRecommendationStatus(rec, "rejected");
      setNotice(`Rejected ${rec.title}. No work action was created.`);
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Rejection failed.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <LoadingState label="Loading SyncAI Guard" />;
  if (!snapshot)
    return (
      <ErrorState message="SyncAI Guard did not load." onRetry={refresh} />
    );
  if (snapshot.error) {
    return <ErrorState message={snapshot.error} onRetry={refresh} />;
  }

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-teal-300" aria-hidden />
            <h1 className="text-2xl font-semibold text-white">SyncAI Guard</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-slate-300">
            Rails on the Sync assistant, and anomaly findings that stay pending
            until a named person approves them. Plant execution is disabled.
            Without an NVIDIA API key the rails use the local mock.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {admin && (
            <button
              type="button"
              onClick={() => void onToggle()}
              disabled={busy !== null}
              className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              {snapshot.enabled ? "Turn Guard off" : "Turn Guard on"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void onScan()}
            disabled={!snapshot.enabled || busy !== null}
            className="rounded-lg border border-teal-700 px-3 py-1.5 text-sm text-teal-100 hover:bg-teal-950 disabled:opacity-50"
          >
            Scan telemetry
          </button>
        </div>
      </div>

      <p className="text-sm text-slate-300" role="status">
        {snapshot.enabled
          ? "SyncAI Guard is on for this organization."
          : "SyncAI Guard is off. Assistant calls are not railed until an administrator turns it on."}
      </p>
      {notice && <p className="text-sm text-amber-100">{notice}</p>}

      <section className="space-y-2">
        <h2 className="text-lg font-medium text-white">Rail events</h2>
        {snapshot.events.length === 0 ? (
          <EmptyState message="No rail decisions recorded yet." />
        ) : (
          <ul className="space-y-2">
            {snapshot.events.map((event) => {
              const data = event.event_data ?? {};
              return (
                <li
                  key={event.id}
                  className="rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200"
                >
                  <span className="font-medium text-white">
                    {data.action ?? "unknown"} · {data.rail ?? "none"} ·{" "}
                    {data.stage ?? "n/a"}
                  </span>
                  <span className="mt-1 block text-slate-400">
                    {data.provider ?? "unknown provider"}
                    {data.reason ? ` — ${data.reason}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-medium text-white">Anomaly findings</h2>
        {snapshot.findings.length === 0 ? (
          <EmptyState message="No Guard findings yet. A scan reads this organization's seeded telemetry and can add one synthetic access event." />
        ) : (
          <ul className="space-y-2">
            {snapshot.findings.map((rec) => (
              <li
                key={rec.id}
                className="rounded-xl border border-white/10 px-3 py-3 text-sm text-slate-200"
              >
                <div className="font-medium text-white">{rec.title}</div>
                <p className="mt-1 text-slate-400">{rec.issue}</p>
                <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
                  {rec.status} · plant execution disabled
                </p>
                {rec.status === "pending" && (
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void onApprove(rec)}
                      disabled={busy !== null}
                      className="rounded-lg bg-teal-800 px-3 py-1 text-sm text-white disabled:opacity-50"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => void onReject(rec)}
                      disabled={busy !== null}
                      className="rounded-lg border border-slate-600 px-3 py-1 text-sm text-slate-200 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
