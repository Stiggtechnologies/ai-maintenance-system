import {
  TriangleAlert as AlertTriangle,
  Radio,
  Shield,
  Clock,
  Activity,
  Target,
} from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "../lib/supabase";
import { useAsyncData } from "../hooks/useAsyncData";
import { LoadingState } from "../components/ui/AsyncStates";
import { ResiliencePanel } from "../components/ResiliencePanel";

interface CriticalAlert {
  id: string;
  title: string | null;
  description: string | null;
  created_at: string;
}

async function getActiveCriticalAlerts(): Promise<CriticalAlert[]> {
  const { data, error } = await supabase
    .from("system_alerts")
    .select("id,title,description,created_at")
    .eq("severity", "critical")
    .eq("resolved", false)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as CriticalAlert[]) ?? [];
}

type IncidentSeverity = "critical" | "major" | "moderate";

/**
 * WHAT THIS PAGE NO LONGER CLAIMS.
 *
 * It rendered a fixed incident record — "INC-2026-0847", elapsed "2h 18min",
 * "$180K/hr exposure", escalation level 2, three affected assets — and then
 * overwrote only the TITLE with a real critical alert from `system_alerts`.
 * Everything a responder would read after the headline was a literal, shown
 * under a live alert as though it described that alert.
 *
 * Three of those literals are why this was the most serious fabrication in the
 * repository rather than another wrong number:
 *
 *  * `criticalControls` asserted "LOTO verified ✓ / Isolation confirmed ✓ /
 *    JSA completed ✓ / Spotter assigned ✓ / Rescue plan current ✓" with
 *    `status: true` hand-typed. Nothing writes them and nothing can: the value
 *    could never be false. That is a fabricated SAFETY ATTESTATION, displayed
 *    at exactly the moment somebody might rely on it, for isolation that
 *    nobody performed.
 *
 *  * `timeline` was captioned "Live Event Timeline" and was a minute-by-minute
 *    script — "04:13 AI confirmed failure signature — 97% confidence",
 *    "04:14 Emergency work order created automatically" — attributed to named
 *    agents. AGENTS.md prohibits making a demo appear autonomous; this is the
 *    clearest instance of it, and it is stronger than the seeded
 *    'Autonomous (< $5K)' row already deleted from the demo seed.
 *
 *  * `recoverySteps` gave a return-to-service time of 08:45 UTC for a repair
 *    nobody had scheduled.
 *
 * None of the three has a data source anywhere in the schema. Following the
 * precedent already set on this branch for `cost_of_downtime` — refuse rather
 * than compute from an invented constant — each panel now states what is not
 * recorded instead of showing a reassuring answer.
 */
interface ActiveIncident {
  id: string;
  title: string;
  severity: IncidentSeverity;
  startTime: string;
}

const severityConfig: Record<
  IncidentSeverity,
  { color: string; bg: string; border: string; label: string }
> = {
  critical: {
    color: "text-red-400",
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    label: "CRITICAL",
  },
  major: {
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    label: "MAJOR",
  },
  moderate: {
    color: "text-signal-cyan",
    bg: "bg-signal-cyan/10",
    border: "border-signal-cyan/20",
    label: "MODERATE",
  },
};


export function EmergencyMode() {
  const { data: alerts, loading } = useAsyncData<CriticalAlert[]>(
    () => getActiveCriticalAlerts(),
    [],
  );

  if (loading) return <LoadingState label="Checking for active incidents…" />;

  if (!alerts || alerts.length === 0) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Emergency Mode
        </h1>
        <p className="text-sm text-slate-400 mt-0.5 mb-6">
          Incident command view — activates automatically when a critical system
          alert is raised.
        </p>
        <div className="bg-[#0D1520] border border-teal-500/20 rounded-2xl p-10 text-center">
          <div className="text-teal-400 text-lg font-semibold">
            No active incidents
          </div>
          <p className="text-sm text-slate-400 mt-2 max-w-md mx-auto">
            All critical alerts are resolved. When an unresolved critical alert
            exists, this view becomes the incident command center with timeline,
            affected assets, and recovery tracking.
          </p>
        </div>
      </div>
    );
  }

  // Every field comes from the alert. Nothing is templated in behind it.
  const activeIncident: ActiveIncident = {
    id: `ALERT-${alerts[0].id.slice(0, 8)}`,
    title: alerts[0].title ?? "Untitled critical alert",
    severity: "critical",
    startTime: new Date(alerts[0].created_at).toLocaleString(),
  };
  const sc = severityConfig[activeIncident.severity];

  return (
    <div className="p-6 space-y-6">
      {/* Emergency Header */}
      <div className="bg-linear-to-r from-red-500/10 via-amber-500/5 to-transparent border border-red-500/20 rounded-2xl p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-xl bg-red-500/20 animate-pulse">
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-xs font-black uppercase tracking-wider ${sc.color}`}
                >
                  {sc.label} INCIDENT
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  {activeIncident.id}
                </span>
              </div>
              <h1 className="text-xl font-bold text-white">
                {activeIncident.title}
              </h1>
              <p className="text-sm text-slate-300 mt-1">
                {alerts[0].description ?? "No description recorded on this alert."}
              </p>
              <div className="flex items-center gap-4 mt-3 text-xs text-slate-400">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Raised:{" "}
                  {activeIncident.startTime}
                </span>
                <span className="flex items-center gap-1">
                  <Activity className="w-3 h-3 text-amber-400" />
                  {alerts.length} unresolved critical alert
                  {alerts.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          </div>
          <div
            className={`px-3 py-1.5 rounded-lg ${sc.bg} ${sc.border} border`}
          >
            <span className={`text-xs font-bold ${sc.color}`}>
              {/* No escalation ladder is modelled, so no level is claimed. */}
              Unresolved
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Every alert the query returned — the real ones, and only those. */}
        <div className="lg:col-span-2 bg-[#0D1520] border border-white/6 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2 mb-4">
            <Radio className="w-4 h-4 text-teal-400" /> Unresolved critical
            alerts
          </h3>
          <div className="space-y-3">
            {alerts.map((alert, i) => (
              <motion.div
                key={alert.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="flex items-start gap-3"
              >
                <div className="flex flex-col items-center shrink-0">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                  {i < alerts.length - 1 && (
                    <div className="w-px h-8 bg-white/6 mt-1" />
                  )}
                </div>
                <div className="flex-1 min-w-0 pb-2">
                  <span className="text-xs font-mono text-slate-400">
                    {new Date(alert.created_at).toLocaleString()}
                  </span>
                  <p className="text-sm text-slate-200 mt-0.5">
                    {alert.title ?? "Untitled critical alert"}
                  </p>
                  {alert.description && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      {alert.description}
                    </p>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
          <p className="mt-4 pt-3 border-t border-white/6 text-xs text-slate-500">
            This panel was a scripted &ldquo;Live Event Timeline&rdquo; —
            ten hand-written entries including an AI failure confirmation at
            97% confidence and a work order created automatically, neither of
            which happened. It now shows the alerts the platform actually
            holds.
          </p>
        </div>

        <div className="space-y-4">
          {/*
            REFUSALS, not blanks. Each of these panels asserted something the
            schema has no column for. Saying so is more use to a responder than
            a green tick that cannot go red.
          */}
          <div className="bg-[#0D1520] border border-white/6 rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-2 flex items-center gap-2">
              <Shield className="w-4 h-4 text-slate-500" /> Critical controls
            </h3>
            <p className="text-xs text-amber-300/90">
              Not recorded by this platform.
            </p>
            <p className="text-xs text-slate-400 mt-2">
              This panel used to show LOTO, isolation, JSA, spotter and rescue
              plan as verified. All five were hard-coded to true and no code
              path could ever set them false, so it reported a completed
              isolation for work nobody had done. Confirm permit and isolation
              status in the permit-to-work system of record.
            </p>
          </div>

          <div className="bg-[#0D1520] border border-white/6 rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-slate-200 mb-2 flex items-center gap-2">
              <Target className="w-4 h-4 text-slate-500" /> Recovery plan
            </h3>
            <p className="text-xs text-amber-300/90">
              No recovery plan is modelled.
            </p>
            <p className="text-xs text-slate-400 mt-2">
              The five steps and the 08:45 UTC return-to-service shown here
              were fixed text, not a schedule anyone had committed to.
            </p>
          </div>
        </div>
      </div>
      <ResiliencePanel />
    </div>
  );
}
