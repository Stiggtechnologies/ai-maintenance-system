/**
 * SafetyGatekeeperPanel — consequence screening with an enforced veto
 * (capability register C1.11, C8.24; guard for E2.13).
 *
 * Screening is deterministic and conservative: ambiguity flags for review,
 * never clears. Clearance is a human act requiring a substantive note, and
 * the veto itself is a database trigger — approval is impossible past an
 * unattested gate regardless of which path attempts it.
 */
import { useState } from "react";
import { ShieldAlert, ShieldCheck, ScanSearch } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import { LoadingState, ErrorState, EmptyState } from "./ui/AsyncStates";

interface Screening {
  id: string;
  recommendation_id: string;
  dimensions_hit: string[];
  requires_gatekeeper: boolean;
  screening_basis: string;
  gatekeeper_attested_at: string | null;
  gatekeeper_note: string | null;
  recommendations: { title: string; status: string } | null;
}

interface PendingRec {
  id: string;
  title: string;
}

async function getData(): Promise<{
  screenings: Screening[];
  unscreened: PendingRec[];
}> {
  const [s, r] = await Promise.all([
    supabase
      .from("recommendation_screenings")
      .select(
        "id, recommendation_id, dimensions_hit, requires_gatekeeper, screening_basis, gatekeeper_attested_at, gatekeeper_note, recommendations(title, status)",
      )
      .order("screened_at", { ascending: false })
      .limit(10),
    supabase
      .from("recommendations")
      .select("id, title")
      .eq("status", "pending")
      .limit(8),
  ]);
  if (s.error) throw new Error(s.error.message);
  if (r.error) throw new Error(r.error.message);
  const screenings = (s.data ?? []).map((row) => {
    const x = row as Screening & {
      recommendations:
        Screening["recommendations"] | Screening["recommendations"][];
    };
    return {
      ...x,
      recommendations: Array.isArray(x.recommendations)
        ? x.recommendations[0]
        : x.recommendations,
    };
  });
  const screenedIds = new Set(screenings.map((x) => x.recommendation_id));
  return {
    screenings,
    unscreened: ((r.data ?? []) as PendingRec[]).filter(
      (x) => !screenedIds.has(x.id),
    ),
  };
}

const GATEKEEPER_ROLES = new Set([
  "admin",
  "ai_admin",
  "maintenance_manager",
  "reliability_engineer",
]);

export function SafetyGatekeeperPanel() {
  const { profile } = useAuth();
  const { data, loading, error, refetch } = useAsyncData(getData, []);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const isGatekeeper = GATEKEEPER_ROLES.has((profile?.role as string) ?? "");

  const act = async (fn: () => Promise<{ error?: string } | undefined>) => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fn();
      if (r && r.error) setMessage(r.error);
      refetch();
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState label="Loading safety screenings" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;
  const { screenings, unscreened } = data ?? { screenings: [], unscreened: [] };
  const blocked = screenings.filter(
    (s) => s.requires_gatekeeper && !s.gatekeeper_attested_at,
  ).length;

  return (
    <section aria-labelledby="gatekeeper-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="gatekeeper-heading"
            className="flex items-center gap-2 text-lg font-semibold text-white"
          >
            <ShieldAlert className="h-5 w-5 text-red-400" aria-hidden />
            Safety Gatekeeper
            {blocked > 0 && (
              <span className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs text-red-300">
                {blocked} awaiting clearance
              </span>
            )}
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            Every consequential recommendation is screened against the twelve
            consequence dimensions. A hit on a safety dimension makes approval
            impossible until an accountable gatekeeper clears it — enforced by a
            database trigger, not by the interface.
          </p>
        </div>
        {unscreened.length > 0 && (
          <button
            disabled={busy}
            onClick={() =>
              act(async () => {
                for (const u of unscreened.slice(0, 5)) {
                  const { data: r, error: e } = await supabase.rpc(
                    "screen_recommendation_consequences",
                    { p_recommendation_id: u.id },
                  );
                  // Surface transport-level failures too — a silently
                  // swallowed error here would look like "nothing to screen".
                  if (e) return { error: e.message };
                  const payload = r as { error?: string } | null;
                  if (payload?.error) return { error: payload.error };
                }
                return undefined;
              })
            }
            className="inline-flex items-center gap-2 rounded-lg bg-signal-gold px-3 py-2 text-sm font-medium text-overlook-void hover:bg-signal-gold-soft disabled:opacity-40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-gold"
          >
            <ScanSearch className="h-4 w-4" aria-hidden />
            Screen {Math.min(unscreened.length, 5)} pending
          </button>
        )}
      </div>

      {message && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {message}
        </p>
      )}

      {screenings.length === 0 ? (
        <EmptyState message="No recommendations screened yet — screen the pending queue to see consequence coverage." />
      ) : (
        <ul className="space-y-3">
          {screenings.map((s) => {
            const cleared = !!s.gatekeeper_attested_at;
            const gated = s.requires_gatekeeper && !cleared;
            return (
              <li
                key={s.id}
                className={`rounded-xl border p-4 ${
                  gated
                    ? "border-red-500/30 bg-red-500/5"
                    : "border-white/6 bg-overlook-deep/40"
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-200">
                      {s.recommendations?.title ?? s.recommendation_id}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {(s.dimensions_hit ?? []).map((d) => (
                        <span
                          key={d}
                          className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-slate-300"
                        >
                          {d.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                  {gated ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-xs text-red-300">
                      <ShieldAlert className="h-3 w-3" aria-hidden /> approval
                      blocked
                    </span>
                  ) : (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-teal-500/30 bg-teal-500/10 px-2 py-0.5 text-xs text-teal-300">
                      <ShieldCheck className="h-3 w-3" aria-hidden />
                      {s.requires_gatekeeper ? "cleared" : "no gate required"}
                    </span>
                  )}
                </div>

                <p className="mt-2 text-xs text-slate-500">
                  {s.screening_basis}
                </p>

                {cleared && s.gatekeeper_note && (
                  <p className="mt-2 rounded-lg border border-teal-500/20 bg-teal-500/5 px-2.5 py-1.5 text-xs text-teal-200">
                    Clearance: {s.gatekeeper_note}
                  </p>
                )}

                {gated && isGatekeeper && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <input
                      aria-label="Clearance note"
                      value={note[s.id] ?? ""}
                      onChange={(e) =>
                        setNote((n) => ({ ...n, [s.id]: e.target.value }))
                      }
                      placeholder="What was reviewed and why it is safe to proceed…"
                      className="min-w-64 flex-1 rounded-lg border border-overlook-rule bg-overlook-void/60 px-3 py-1.5 text-xs text-overlook-paper focus:border-signal-cyan/70 focus:outline-hidden"
                    />
                    <button
                      disabled={busy || (note[s.id] ?? "").trim().length < 10}
                      onClick={() =>
                        act(async () => {
                          const { data: r, error: e } = await supabase.rpc(
                            "attest_safety_review",
                            {
                              p_recommendation_id: s.recommendation_id,
                              p_note: note[s.id],
                            },
                          );
                          if (e) return { error: e.message };
                          return r as { error?: string };
                        })
                      }
                      className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 hover:bg-red-500/20 disabled:opacity-40 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-red-300"
                    >
                      Clear safety gate
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
