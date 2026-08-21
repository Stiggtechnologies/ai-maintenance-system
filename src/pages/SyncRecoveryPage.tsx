import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  DollarSign,
  GitBranch,
  Layers3,
  LockKeyhole,
  PackageCheck,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  TimerReset,
  Users,
  Wrench,
  XCircle,
} from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import { supabase } from "../lib/supabase";
import {
  getRecoveryBoard,
  getRecoveryEvent,
  getRecoveryOpportunities,
  getRecoveryQualityChecks,
  recoveryActions,
  recoveryCache,
  type RecoveryBoard,
  type RecoveryBlocker,
  type RecoveryConstraint,
  type RecoveryEventDetail,
  type RecoveryOpportunities,
  type RecoveryQualityCheck,
  type RecoveryScopeItem,
} from "../services/syncRecoveryService";

type View = "board" | "workspace" | "timeline" | "opportunities" | "execution" | "value";
type AssetOption = { id: string; name: string; tag: string | null; asset_class: string | null };

type CompletionDraft = {
  eventWorkId: string;
  actualHours: string;
  note: string;
  checks: RecoveryQualityCheck[];
  passed: Set<string>;
};

const views: Array<{ id: View; label: string }> = [
  { id: "board", label: "Fleet Down Board" },
  { id: "workspace", label: "Event Workspace" },
  { id: "timeline", label: "Integrated Timeline" },
  { id: "opportunities", label: "Opportunity Work" },
  { id: "execution", label: "Live Execution" },
  { id: "value", label: "Value Report" },
];

const inputClass =
  "w-full rounded-lg border border-industrial-border bg-industrial-slate px-3 py-2 text-sm text-industrial-text outline-none focus:border-teal-500";
const cardClass = "rounded-xl border border-industrial-border bg-industrial-graphite";

function fmtDate(value: string | null | undefined) {
  if (!value) return "Not available";
  return new Date(value).toLocaleString();
}

function fmtHours(value: number | null | undefined) {
  return value == null ? "—" : `${Number(value).toFixed(1)} h`;
}

function fmtMoney(value: number | null | undefined) {
  return value == null
    ? "Not computable"
    : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function statusTone(status: string) {
  if (["released", "complete", "satisfied", "closed", "approved"].includes(status))
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  if (["blocked", "critical", "rejected"].includes(status))
    return "border-red-500/30 bg-red-500/10 text-red-300";
  if (["approval", "pending", "unknown", "candidate"].includes(status))
    return "border-amber-500/30 bg-amber-500/10 text-amber-300";
  return "border-slate-500/30 bg-slate-500/10 text-slate-300";
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${tone ?? "border-industrial-border text-slate-300"}`}>
      {children}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-industrial-border p-6 text-sm text-slate-400">{children}</div>;
}

export default function SyncRecoveryPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const role = String(profile?.role ?? "").toLowerCase();
  const [view, setView] = useState<View>("board");
  const [board, setBoard] = useState<RecoveryBoard | null>(null);
  const [detail, setDetail] = useState<RecoveryEventDetail | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [boardDegraded, setBoardDegraded] = useState(false);
  const [eventDegraded, setEventDegraded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const degraded = boardDegraded || eventDegraded;
  const canOpen = ["planner", "supervisor", "maintenance_manager", "reliability_engineer", "operator", "admin", "ai_admin"].includes(role);
  const canPlan = ["planner", "maintenance_manager", "reliability_engineer", "admin", "ai_admin"].includes(role);
  const canScope = ["planner", "supervisor", "maintenance_manager", "reliability_engineer", "admin", "ai_admin"].includes(role);
  const canExecute = ["technician", "supervisor", "maintenance_manager", "admin", "ai_admin"].includes(role);
  const canRts = ["operator", "maintenance_manager", "admin", "ai_admin"].includes(role);
  const canRelease = ["planner", "maintenance_manager", "admin", "ai_admin"].includes(role);

  const [openAssetId, setOpenAssetId] = useState("");
  const [openReason, setOpenReason] = useState("");
  const [openType, setOpenType] = useState("planned");
  const [baselineAt, setBaselineAt] = useState("");
  const [baselineMethod, setBaselineMethod] = useState("original_approved_schedule");
  const [baselineBasis, setBaselineBasis] = useState("");
  const [selectedParallel, setSelectedParallel] = useState<Set<string>>(new Set());
  const [parallelGroup, setParallelGroup] = useState("");
  const [parallelBasis, setParallelBasis] = useState("");
  const [constraintKind, setConstraintKind] = useState("resource");
  const [constraintPhase, setConstraintPhase] = useState("planning");
  const [constraintDescription, setConstraintDescription] = useState("");
  const [constraintBasis, setConstraintBasis] = useState("");
  const [constraintHard, setConstraintHard] = useState(true);
  const [opportunityWindow, setOpportunityWindow] = useState("24");
  const [opportunities, setOpportunities] = useState<RecoveryOpportunities | null>(null);
  const [blockerCategory, setBlockerCategory] = useState("parts");
  const [blockerDescription, setBlockerDescription] = useState("");
  const [blockerOwner, setBlockerOwner] = useState("");
  const [blockerSeverity, setBlockerSeverity] = useState("medium");
  const [completion, setCompletion] = useState<CompletionDraft | null>(null);
  const [closeNote, setCloseNote] = useState("");

  async function loadBoard(preferredEventId?: string | null) {
    try {
      const next = await getRecoveryBoard();
      setBoard(next);
      setBoardDegraded(false);
      const wanted = preferredEventId ?? selectedEventId;
      if (!wanted && next.events.length) setSelectedEventId(next.events[0].id);
    } catch (e) {
      const cached = recoveryCache.read<RecoveryBoard>(recoveryCache.boardKey);
      if (cached) {
        setBoard(cached);
        setBoardDegraded(true);
      } else {
        throw e;
      }
    }
  }

  async function loadDetail(eventId: string) {
    try {
      const next = await getRecoveryEvent(eventId);
      setDetail(next);
      setEventDegraded(false);
    } catch (e) {
      const cached = recoveryCache.read<RecoveryEventDetail>(recoveryCache.eventKey(eventId));
      if (cached) {
        setDetail(cached);
        setEventDegraded(true);
      } else {
        throw e;
      }
    }
  }

  async function loadAssets() {
    const { data, error: assetError } = await supabase
      .from("assets")
      .select("id,name,tag,asset_class")
      .order("name")
      .limit(500);
    if (!assetError) setAssets((data ?? []) as AssetOption[]);
  }

  async function refreshAll() {
    setLoading(true);
    setError(null);
    try {
      await loadBoard();
      if (selectedEventId) await loadDetail(selectedEventId);
      await loadAssets();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedEventId) {
      setDetail(null);
      return;
    }
    setEventDegraded(false);
    setOpportunities(null);
    setSelectedParallel(new Set());
    void loadDetail(selectedEventId).catch((e) => setError((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!document.hidden && !working && !degraded) {
        void loadBoard();
        if (selectedEventId) void loadDetail(selectedEventId);
      }
    }, 30_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId, working, degraded]);

  async function runAction(action: () => Promise<unknown>, success: string) {
    if (degraded) {
      setError("Recovery is showing a cached read-only snapshot. Writes are disabled until the live control plane is reachable.");
      return;
    }
    setWorking(true);
    setError(null);
    setMessage(null);
    try {
      await action();
      setMessage(success);
      await loadBoard();
      if (selectedEventId) await loadDetail(selectedEventId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }

  async function openEvent(assetId: string, reason: string, eventType: string) {
    let createdId: string | null = null;
    await runAction(async () => {
      const result = await recoveryActions.openEvent(assetId, reason, eventType);
      createdId = String(result.event_id ?? "") || null;
      if (createdId) setSelectedEventId(createdId);
    }, "Restoration event opened.");
    if (createdId) {
      setView("workspace");
      setOpenReason("");
      await loadBoard(createdId);
      await loadDetail(createdId);
    }
  }

  const selectedBoardEvent = useMemo(
    () => board?.events.find((e) => e.id === selectedEventId) ?? null,
    [board, selectedEventId],
  );

  if (loading && !board) {
    return <div className="flex min-h-[60vh] items-center justify-center text-slate-400">Loading Sync Recovery…</div>;
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 px-4 py-5 lg:px-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-teal-400">
            <TimerReset className="h-4 w-4" /> Sync Recovery · Event Orchestrator
          </div>
          <h1 className="text-3xl font-bold text-industrial-text">Return-to-service control room</h1>
          <p className="mt-2 max-w-4xl text-sm text-slate-400">
            Coordinate the downtime event as one governed restoration plan. Scheduling, constraints, critical path and economics are deterministic; AI may explain context but never overrides safety, authority or evidence gates.
          </p>
        </div>
        <button
          onClick={() => void refreshAll()}
          disabled={working}
          className="inline-flex items-center gap-2 rounded-lg border border-industrial-border px-3 py-2 text-sm text-slate-300 hover:bg-industrial-slate disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${working ? "animate-spin" : ""}`} /> Refresh
        </button>
      </header>

      {degraded && (
        <div className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <div className="font-semibold">Degraded mode — cached read-only snapshot</div>
            <div className="mt-1 text-amber-100/80">The live backend could not be reached. Recovery does not queue or simulate operational writes offline; all action controls are disabled until connectivity returns.</div>
          </div>
        </div>
      )}
      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
      {message && <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">{message}</div>}

      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-industrial-border bg-industrial-graphite p-1">
        {views.map((item) => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${view === item.id ? "bg-teal-500/15 text-teal-300" : "text-slate-400 hover:bg-industrial-slate hover:text-slate-200"}`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {view !== "board" && (
        <div className={`${cardClass} flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between`}>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-500">Active event</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="font-semibold text-industrial-text">{selectedBoardEvent?.event_code ?? detail?.event.event_code ?? "Select an event"}</span>
              {detail && <Pill tone={statusTone(detail.event.status)}>{detail.event.status}</Pill>}
              {selectedBoardEvent && <span className="text-sm text-slate-400">{selectedBoardEvent.asset}</span>}
            </div>
          </div>
          <select className={`${inputClass} max-w-md`} value={selectedEventId ?? ""} onChange={(e) => setSelectedEventId(e.target.value || null)}>
            <option value="">Select event</option>
            {(board?.events ?? []).map((event) => (
              <option key={event.id} value={event.id}>{event.event_code} · {event.asset}</option>
            ))}
          </select>
        </div>
      )}

      {view === "board" && (
        <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
          <section className={`${cardClass} p-5`}>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-industrial-text">Active restoration events</h2>
                <p className="text-sm text-slate-400">One operating picture per affected asset.</p>
              </div>
              <Pill>{board?.events.length ?? 0} active</Pill>
            </div>
            <div className="space-y-3">
              {(board?.events ?? []).map((event) => (
                <button
                  key={event.id}
                  onClick={() => { setSelectedEventId(event.id); setView("workspace"); }}
                  className="w-full rounded-xl border border-industrial-border bg-industrial-slate/50 p-4 text-left hover:border-teal-500/40"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-industrial-text">{event.asset}</span>
                        <span className="text-sm text-slate-500">{event.tag}</span>
                        <Pill tone={statusTone(event.status)}>{event.status}</Pill>
                      </div>
                      <div className="mt-1 text-sm text-slate-400">{event.event_code} · {event.reason}</div>
                    </div>
                    <ArrowRight className="h-5 w-5 text-slate-500" />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                    <MiniMetric label="Opened" value={fmtDate(event.opened_at)} />
                    <MiniMetric label="P80 RTS" value={fmtDate(event.forecast_p80_return_at)} />
                    <MiniMetric label="Scope" value={`${event.scope_complete}/${event.scope_total} complete`} />
                    <MiniMetric label="Blockers" value={String(event.open_blockers)} alert={event.open_blockers > 0} />
                  </div>
                </button>
              ))}
              {!board?.events.length && <Empty>No active restoration events. Recovery will not manufacture a demo event.</Empty>}
            </div>
          </section>

          <section className="space-y-5">
            <div className={`${cardClass} p-5`}>
              <div className="mb-4 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-400" />
                <div>
                  <h2 className="font-semibold text-industrial-text">Down assets without an event</h2>
                  <p className="text-sm text-slate-400">Measured from current operating-state records.</p>
                </div>
              </div>
              <div className="space-y-2">
                {(board?.unmanaged_down_assets ?? []).map((asset) => (
                  <div key={asset.asset_id} className="rounded-lg border border-industrial-border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-industrial-text">{asset.asset} <span className="text-slate-500">{asset.tag}</span></div>
                        <div className="text-xs text-slate-400">{asset.state} since {fmtDate(asset.down_since)}</div>
                      </div>
                      <button
                        disabled={!canOpen || degraded || working}
                        onClick={() => { setOpenAssetId(asset.asset_id); setOpenType("unplanned"); }}
                        className="rounded-lg bg-teal-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
                      >Open event</button>
                    </div>
                  </div>
                ))}
                {!board?.unmanaged_down_assets.length && <Empty>No unmanaged currently-down assets were found.</Empty>}
              </div>
            </div>

            <div className={`${cardClass} p-5`}>
              <h2 className="font-semibold text-industrial-text">Open planned / major intervention</h2>
              <p className="mb-4 text-sm text-slate-400">Uses the canonical asset register. Unplanned events require a live down-state record.</p>
              <div className="space-y-3">
                <select className={inputClass} value={openAssetId} onChange={(e) => setOpenAssetId(e.target.value)}>
                  <option value="">Select asset</option>
                  {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}{asset.tag ? ` · ${asset.tag}` : ""}{asset.asset_class ? ` · ${asset.asset_class}` : ""}</option>)}
                </select>
                <select className={inputClass} value={openType} onChange={(e) => setOpenType(e.target.value)}>
                  <option value="planned">Planned downtime</option>
                  <option value="major_intervention">Major intervention</option>
                  <option value="opportunity">Opportunity window</option>
                  <option value="unplanned">Unplanned downtime</option>
                </select>
                <textarea className={inputClass} rows={3} placeholder="Why is this asset in a restoration event?" value={openReason} onChange={(e) => setOpenReason(e.target.value)} />
                <button
                  disabled={!canOpen || degraded || working || !openAssetId || openReason.trim().length < 10}
                  onClick={() => void openEvent(openAssetId, openReason, openType)}
                  className="w-full rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                >Open governed event</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {view === "workspace" && detail && (
        <div className="grid gap-5 xl:grid-cols-[1.55fr_1fr]">
          <div className="space-y-5">
            <section className={`${cardClass} p-5`}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-industrial-text">Integrated scope</h2>
                  <p className="text-sm text-slate-400">Tasks stay sequential unless concurrency is explicitly verified.</p>
                </div>
                <div className="flex gap-2">
                  <Pill tone={detail.controls.unknown_concurrency_items ? statusTone("unknown") : statusTone("satisfied")}>{detail.controls.unknown_concurrency_items} unknown concurrency</Pill>
                  <Pill tone={detail.controls.unresolved_planning_hard ? statusTone("blocked") : statusTone("satisfied")}>{detail.controls.unresolved_planning_hard} hard planning gaps</Pill>
                </div>
              </div>
              <div className="space-y-2">
                {detail.scope.map((item) => (
                  <ScopeRow
                    key={item.event_work_id}
                    item={item}
                    checked={selectedParallel.has(item.event_work_id)}
                    canPlan={canPlan && !degraded && !working}
                    onChecked={(checked) => setSelectedParallel((prior) => {
                      const next = new Set(prior);
                      if (checked) next.add(item.event_work_id); else next.delete(item.event_work_id);
                      return next;
                    })}
                    onSequence={(sequence) => void runAction(() => recoveryActions.sequenceWork(item.event_work_id, sequence), "Sequence updated; any prior concurrency verification on this item was cleared.")}
                    onIncludeCandidate={() => {
                      const reason = window.prompt("Reason for adding this scope after plan release (minimum 10 characters):") ?? "";
                      if (reason.trim().length >= 10) void runAction(() => recoveryActions.includeCandidate(item.event_work_id, reason), "Scope-growth candidate included for replanning. Generate and approve a revised plan before execution.");
                    }}
                  />
                ))}
                {!detail.scope.length && <Empty>No work orders are linked to this event yet.</Empty>}
              </div>

              {canPlan && detail.scope.filter((x) => x.plan_state === "included" && x.execution_status !== "complete").length >= 2 && (
                <div className="mt-5 rounded-xl border border-teal-500/20 bg-teal-500/5 p-4">
                  <div className="mb-3 flex items-center gap-2 font-medium text-teal-200"><GitBranch className="h-4 w-4" /> Verify concurrent work</div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <input className={inputClass} placeholder="Parallel group name" value={parallelGroup} onChange={(e) => setParallelGroup(e.target.value)} />
                    <input className={inputClass} placeholder="Safety/resource basis (20+ characters)" value={parallelBasis} onChange={(e) => setParallelBasis(e.target.value)} />
                  </div>
                  <button
                    disabled={degraded || working || selectedParallel.size < 2 || parallelBasis.trim().length < 20 || parallelGroup.trim().length < 2}
                    onClick={() => void runAction(() => recoveryActions.verifyParallel(detail.event.id, [...selectedParallel], parallelGroup, parallelBasis), "Parallel group verified and recorded with human provenance.")}
                    className="mt-3 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
                  >Verify {selectedParallel.size} selected tasks as concurrent</button>
                </div>
              )}
            </section>

            <section className={`${cardClass} p-5`}>
              <h2 className="mb-1 text-lg font-semibold text-industrial-text">Open work on the same asset</h2>
              <p className="mb-4 text-sm text-slate-400">Candidate scope comes from canonical work orders; it is not auto-added.</p>
              <div className="space-y-2">
                {detail.candidate_work.map((work) => (
                  <div key={work.work_order_id} className="flex flex-col gap-3 rounded-lg border border-industrial-border p-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <div className="font-medium text-industrial-text">{work.wo_number ?? "WO"} · {work.title}</div>
                      <div className="text-xs text-slate-400">{work.priority} · duration {fmtHours(work.planned_hours ?? work.estimated_hours)}</div>
                    </div>
                    <div className="flex gap-2">
                      <button disabled={!canScope || degraded || working} onClick={() => void runAction(() => recoveryActions.addWork(detail.event.id, work.work_order_id, "mandatory"), "Work added to the restoration event.")} className="rounded-lg border border-industrial-border px-3 py-2 text-xs text-slate-200 disabled:opacity-40">Add mandatory</button>
                      <button disabled={!canScope || degraded || working} onClick={() => void runAction(() => recoveryActions.addWork(detail.event.id, work.work_order_id, "opportunity"), "Work added as opportunity scope.")} className="rounded-lg border border-teal-500/30 px-3 py-2 text-xs text-teal-300 disabled:opacity-40">Add opportunity</button>
                    </div>
                  </div>
                ))}
                {!detail.candidate_work.length && <Empty>No additional open work orders exist for this asset.</Empty>}
              </div>
            </section>
          </div>

          <div className="space-y-5">
            <section className={`${cardClass} p-5`}>
              <h2 className="font-semibold text-industrial-text">Counterfactual baseline</h2>
              <p className="mb-4 text-sm text-slate-400">Frozen at first plan generation so value cannot be rewritten after the fact.</p>
              {detail.event.baseline_frozen_at ? (
                <div className="space-y-2 text-sm">
                  <MiniMetric label="Baseline RTS" value={fmtDate(detail.event.baseline_return_at)} />
                  <MiniMetric label="Method" value={detail.event.baseline_method ?? "Not available"} />
                  <MiniMetric label="Frozen" value={fmtDate(detail.event.baseline_frozen_at)} />
                  <div className="rounded-lg bg-industrial-slate p-3 text-slate-300">{detail.event.baseline_basis ?? "No baseline basis recorded."}</div>
                </div>
              ) : (
                <div className="space-y-3">
                  <input className={inputClass} type="datetime-local" value={baselineAt} onChange={(e) => setBaselineAt(e.target.value)} />
                  <select className={inputClass} value={baselineMethod} onChange={(e) => setBaselineMethod(e.target.value)}>
                    <option value="original_approved_schedule">Original approved schedule</option>
                    <option value="historical_median">Historical median</option>
                    <option value="control_estimate">Control estimate</option>
                    <option value="manual_authorized">Manual authorized baseline</option>
                  </select>
                  <textarea className={inputClass} rows={3} placeholder="Source and basis (20+ characters)" value={baselineBasis} onChange={(e) => setBaselineBasis(e.target.value)} />
                  <button disabled={!canPlan || degraded || working || !baselineAt || baselineBasis.trim().length < 20} onClick={() => void runAction(() => recoveryActions.setBaseline(detail.event.id, new Date(baselineAt).toISOString(), baselineMethod, baselineBasis), "Counterfactual baseline recorded." )} className="w-full rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Set baseline</button>
                </div>
              )}
            </section>

            <section className={`${cardClass} p-5`}>
              <h2 className="font-semibold text-industrial-text">Constraint register</h2>
              <div className="mt-4 space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <select className={inputClass} value={constraintKind} onChange={(e) => setConstraintKind(e.target.value)}>
                    {["precedence","resource","work_zone","material","labour","tooling","bay","crane","vendor","weather","production","approval","quality_hold","other"].map((x) => <option key={x} value={x}>{x.replaceAll("_", " ")}</option>)}
                  </select>
                  <select className={inputClass} value={constraintPhase} onChange={(e) => setConstraintPhase(e.target.value)}>
                    <option value="planning">Planning</option><option value="execution">Execution</option><option value="return_to_service">Return to service</option>
                  </select>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={constraintHard} onChange={(e) => setConstraintHard(e.target.checked)} /> Hard constraint</label>
                <textarea className={inputClass} rows={2} placeholder="Constraint description" value={constraintDescription} onChange={(e) => setConstraintDescription(e.target.value)} />
                <textarea className={inputClass} rows={2} placeholder="Evidence / basis" value={constraintBasis} onChange={(e) => setConstraintBasis(e.target.value)} />
                <button disabled={!canOpen || degraded || working || constraintDescription.trim().length < 10 || constraintBasis.trim().length < 10} onClick={() => void runAction(() => recoveryActions.addConstraint({ eventId: detail.event.id, kind: constraintKind, phase: constraintPhase, isHard: constraintHard, description: constraintDescription, basis: constraintBasis }), "Constraint added in unknown state; it must be explicitly resolved.")} className="w-full rounded-lg border border-industrial-border px-3 py-2 text-sm text-slate-200 disabled:opacity-40">Add constraint</button>
              </div>
              <div className="mt-5 space-y-2">
                {detail.constraints.map((constraint) => (
                  <ConstraintRow key={constraint.id} constraint={constraint} disabled={degraded || working} onSet={(state, basis) => void runAction(() => recoveryActions.setConstraintState(constraint.id, state, basis), `Constraint set to ${state}.`)} />
                ))}
                {!detail.constraints.length && <Empty>No explicit event constraints are recorded. This does not imply constraints do not exist.</Empty>}
              </div>
            </section>
          </div>
        </div>
      )}

      {view === "timeline" && detail && (
        <div className="space-y-5">
          <section className={`${cardClass} p-5`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-industrial-text">Deterministic integrated plan</h2>
                <p className="text-sm text-slate-400">No browser-side scheduler. The timeline renders the immutable server-generated plan.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button disabled={!canPlan || degraded || working} onClick={() => void runAction(() => recoveryActions.generatePlan(detail.event.id), "New draft plan generated from current evidence and constraints.")} className="rounded-lg border border-teal-500/30 px-3 py-2 text-sm text-teal-300 disabled:opacity-40"><RefreshCw className="mr-2 inline h-4 w-4" />Generate plan</button>
                {detail.latest_plan?.status === "draft" && <button disabled={!canPlan || degraded || working || detail.latest_plan.missing_inputs.length > 0} onClick={() => void runAction(() => recoveryActions.submitPlan(detail.latest_plan!.id), "Plan submitted to the canonical Approval Queue.")} className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Submit for approval</button>}
                {detail.latest_plan?.status === "approval" && detail.latest_plan.approval_status !== "approved" && <button onClick={() => navigate("/approvals")} className="rounded-lg border border-amber-500/30 px-3 py-2 text-sm text-amber-300">Open Approval Queue</button>}
                {detail.latest_plan?.status === "approval" && detail.latest_plan.approval_status === "approved" && <button disabled={!canRelease || degraded || working} onClick={() => void runAction(() => recoveryActions.releasePlan(detail.latest_plan!.id), "Approved restoration plan released for controlled execution.")} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40">Release approved plan</button>}
              </div>
            </div>
          </section>

          {detail.latest_plan ? (
            <>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <Metric label="Serial scope" value={fmtHours(detail.latest_plan.serial_hours)} icon={<Layers3 className="h-5 w-5" />} />
                <Metric label="Critical path" value={fmtHours(detail.latest_plan.critical_path_hours)} icon={<GitBranch className="h-5 w-5" />} />
                <Metric label="P80 critical path" value={fmtHours(detail.latest_plan.p80_critical_path_hours)} icon={<Clock3 className="h-5 w-5" />} />
                <Metric label="Verified concurrent ratio" value={detail.latest_plan.planned_concurrent_work_ratio == null ? "—" : `${detail.latest_plan.planned_concurrent_work_ratio}%`} icon={<Users className="h-5 w-5" />} />
                <Metric label="P80 RTS" value={fmtDate(detail.latest_plan.forecast_p80_return_at)} icon={<TimerReset className="h-5 w-5" />} />
              </div>
              {detail.latest_plan.missing_inputs.length > 0 && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200"><strong>Release blocked:</strong> {JSON.stringify(detail.latest_plan.missing_inputs)}</div>}
              {detail.latest_plan.warnings.length > 0 && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">{detail.latest_plan.warnings.map((w, i) => <div key={i}>{String(w.warning ?? JSON.stringify(w))}</div>)}</div>}
              <section className={`${cardClass} overflow-hidden`}>
                <div className="border-b border-industrial-border p-4 text-sm text-slate-400">Plan v{detail.latest_plan.version} · {detail.latest_plan.engine_version} · <Pill tone={statusTone(detail.latest_plan.status)}>{detail.latest_plan.status}</Pill></div>
                <div className="space-y-4 p-5">
                  {detail.latest_plan.schedule.map((stage) => (
                    <div key={stage.sequence} className="rounded-xl border border-industrial-border p-4">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2"><span className="font-semibold text-industrial-text">Stage {stage.sequence}</span><Pill tone={stage.mode === "parallel" ? statusTone("released") : undefined}>{stage.mode}</Pill></div>
                        <span className="text-sm text-slate-400">{fmtHours(stage.duration_hours)} · P80 {fmtHours(stage.p80_hours)}</span>
                      </div>
                      <div className={`grid gap-2 ${stage.mode === "parallel" ? "md:grid-cols-2 xl:grid-cols-3" : "grid-cols-1"}`}>
                        {stage.tasks.map((task) => (
                          <div key={task.event_work_id} className="rounded-lg bg-industrial-slate p-3">
                            <div className="font-medium text-industrial-text">{task.wo_number ?? "WO"} · {task.title}</div>
                            <div className="mt-1 text-xs text-slate-400">{fmtHours(task.hours)} · {task.duration_basis}</div>
                            {task.parallel_group && <div className="mt-2 text-xs text-teal-300">Parallel group: {task.parallel_group}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : <Empty>No plan has been generated. Sync Recovery does not display a synthetic timeline.</Empty>}
        </div>
      )}

      {view === "opportunities" && detail && (
        <div className="space-y-5">
          <section className={`${cardClass} p-5`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div><h2 className="text-lg font-semibold text-industrial-text">Opportunity maintenance</h2><p className="text-sm text-slate-400">Calls the existing canonical opportunity engine. Unsized work stays unsized.</p></div>
              <div className="flex gap-2"><input className={`${inputClass} w-32`} type="number" min="0.1" step="0.5" value={opportunityWindow} onChange={(e) => setOpportunityWindow(e.target.value)} /><button disabled={degraded || working || Number(opportunityWindow) <= 0} onClick={() => void getRecoveryOpportunities(detail.event.id, Number(opportunityWindow)).then(setOpportunities).catch((e) => setError((e as Error).message))} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Find work that fits</button></div>
            </div>
          </section>
          {opportunities ? (
            <div className="grid gap-5 xl:grid-cols-3">
              <OpportunityColumn title="Fits window" items={opportunities.fits} tone="emerald" canAdd={canScope && !degraded && !working} onAdd={(id) => void runAction(() => recoveryActions.addWork(detail.event.id, id, "opportunity"), "Opportunity work added to event scope.")} />
              <OpportunityColumn title="Does not fit" items={opportunities.does_not_fit} tone="slate" canAdd={canScope && !degraded && !working} onAdd={(id) => void runAction(() => recoveryActions.addWork(detail.event.id, id, "opportunity"), "Work added; its fit warning remains visible in the event plan.")} />
              <OpportunityColumn title="Unsized — decision blocked" items={opportunities.unsized} tone="amber" canAdd={canScope && !degraded && !working} onAdd={(id) => void runAction(() => recoveryActions.addWork(detail.event.id, id, "opportunity"), "Unsized work linked to scope; plan release will remain evidence-driven and no duration is invented.")} />
            </div>
          ) : <Empty>Enter the real available downtime window and run the opportunity check.</Empty>}
        </div>
      )}

      {view === "execution" && detail && (
        <div className="grid gap-5 xl:grid-cols-[1.45fr_1fr]">
          <section className={`${cardClass} p-5`}>
            <div className="mb-4"><h2 className="text-lg font-semibold text-industrial-text">Live execution</h2><p className="text-sm text-slate-400">Field start rechecks released-plan membership, materials and canonical isolation state.</p></div>
            <div className="space-y-3">
              {detail.scope.filter((x) => x.plan_state === "included").map((item) => (
                <div key={item.event_work_id} className="rounded-xl border border-industrial-border p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-industrial-text">{item.wo_number ?? "WO"} · {item.title}</span><Pill tone={statusTone(item.execution_status)}>{item.execution_status}</Pill>{!item.materials_ready && <Pill tone={statusTone("blocked")}>materials not ready</Pill>}</div>
                      <div className="mt-1 text-xs text-slate-400">Stage {item.sequence_no} · {item.concurrency_rule.replaceAll("_", " ")} · {item.quality_checks} quality checks</div>
                    </div>
                    <div className="flex gap-2">
                      {item.execution_status === "not_started" && <button disabled={!canExecute || degraded || working} onClick={() => void runAction(() => recoveryActions.startWork(item.event_work_id), "Work started after execution gates passed.")} className="rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"><Play className="mr-1 inline h-3 w-3" />Start</button>}
                      {item.execution_status === "in_progress" && <button disabled={!canExecute || degraded || working} onClick={() => void openCompletion(item)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"><CheckCircle2 className="mr-1 inline h-3 w-3" />Complete</button>}
                    </div>
                  </div>
                  {completion?.eventWorkId === item.event_work_id && (
                    <CompletionPanel draft={completion} setDraft={setCompletion} disabled={degraded || working} onCancel={() => setCompletion(null)} onComplete={() => {
                      const hours = Number(completion.actualHours);
                      const results = completion.checks.filter((c) => completion.passed.has(c.id)).map((c) => ({ check_id: c.id, result: "pass" as const }));
                      void runAction(() => recoveryActions.completeWork(item.event_work_id, hours, completion.note, results), "Work completed with actual hours and quality evidence recorded.").then(() => setCompletion(null));
                    }} />
                  )}
                </div>
              ))}
              {!detail.scope.filter((x) => x.plan_state === "included").length && <Empty>No included execution scope.</Empty>}
            </div>
          </section>

          <section className="space-y-5">
            <div className={`${cardClass} p-5`}>
              <h2 className="font-semibold text-industrial-text">Live blockers</h2>
              <div className="mt-3 space-y-2">
                <select className={inputClass} value={blockerCategory} onChange={(e) => setBlockerCategory(e.target.value)}>{["parts","labour","tooling","permit","vendor","weather","scope_growth","rework","quality","operations","engineering","access","isolation","other"].map((x) => <option key={x} value={x}>{x.replaceAll("_", " ")}</option>)}</select>
                <select className={inputClass} value={blockerSeverity} onChange={(e) => setBlockerSeverity(e.target.value)}><option>low</option><option>medium</option><option>high</option><option>critical</option></select>
                <input className={inputClass} placeholder="Accountable owner role" value={blockerOwner} onChange={(e) => setBlockerOwner(e.target.value)} />
                <textarea className={inputClass} rows={2} placeholder="What is blocking restoration?" value={blockerDescription} onChange={(e) => setBlockerDescription(e.target.value)} />
                <button disabled={degraded || working || blockerOwner.trim().length < 2 || blockerDescription.trim().length < 10} onClick={() => void runAction(() => recoveryActions.recordBlocker({ eventId: detail.event.id, category: blockerCategory, description: blockerDescription, ownerRole: blockerOwner, severity: blockerSeverity }), "Live blocker recorded.")} className="w-full rounded-lg border border-industrial-border px-3 py-2 text-sm text-slate-200 disabled:opacity-40">Record blocker</button>
              </div>
            </div>
            <div className={`${cardClass} p-5`}>
              <div className="space-y-3">
                {detail.blockers.map((blocker) => <BlockerRow key={blocker.id} blocker={blocker} disabled={degraded || working} onResolve={(note) => void runAction(() => recoveryActions.resolveBlocker(blocker.id, note), "Blocker resolved with evidence note.")} />)}
                {!detail.blockers.length && <Empty>No blockers have been recorded.</Empty>}
              </div>
            </div>
          </section>
        </div>
      )}

      {view === "value" && detail && (
        <div className="space-y-5">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Metric label="Concurrent Work Ratio" value={detail.kpis.planned_concurrent_work_ratio_pct == null ? "—" : `${detail.kpis.planned_concurrent_work_ratio_pct}%`} icon={<GitBranch className="h-5 w-5" />} />
            <Metric label="Downtime Conversion Efficiency" value={detail.kpis.downtime_conversion_efficiency == null ? "Pending actual RTS" : detail.kpis.downtime_conversion_efficiency.toFixed(2)} icon={<Activity className="h-5 w-5" />} />
            <Metric label="Revenue Hours Recovered" value={detail.kpis.revenue_hours_recovered == null ? "Pending actual RTS" : fmtHours(detail.kpis.revenue_hours_recovered)} icon={<Clock3 className="h-5 w-5" />} />
            <Metric label="Projected downtime value" value={fmtMoney(detail.latest_plan?.projected_downtime_value_usd)} icon={<DollarSign className="h-5 w-5" />} />
          </div>
          <section className={`${cardClass} p-5`}>
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <h2 className="text-lg font-semibold text-industrial-text">Value integrity</h2>
                <p className="mt-2 text-sm text-slate-400">Recovered hours are measured against the frozen counterfactual baseline. Economic value only appears when an operator-supplied downtime cost with provenance exists. Closing an event writes projected metrics; the existing Value Verification workflow must independently verify them.</p>
                <div className="mt-4 space-y-2 text-sm">
                  <MiniMetric label="Baseline RTS" value={fmtDate(detail.event.baseline_return_at)} />
                  <MiniMetric label="Forecast P80 RTS" value={fmtDate(detail.event.forecast_p80_return_at)} />
                  <MiniMetric label="Actual RTS" value={fmtDate(detail.event.actual_return_at)} />
                  <MiniMetric label="Economic basis" value={detail.latest_plan?.economics_basis ?? "No governed downtime-cost basis available"} />
                </div>
              </div>
              <div className="rounded-xl border border-industrial-border bg-industrial-slate/50 p-4">
                <div className="mb-2 flex items-center gap-2 font-medium text-industrial-text"><ShieldCheck className="h-5 w-5 text-teal-400" /> Return-to-service gate</div>
                <div className="space-y-2 text-sm text-slate-300">
                  <div className="flex justify-between"><span>Incomplete included work</span><span>{detail.scope.filter((x) => x.plan_state === "included" && x.execution_status !== "complete").length}</span></div>
                  <div className="flex justify-between"><span>RTS hard constraints</span><span>{detail.controls.unresolved_rts_hard}</span></div>
                  <div className="flex justify-between"><span>Open blockers</span><span>{detail.blockers.filter((x) => x.status === "open").length}</span></div>
                </div>
                {detail.event.status !== "closed" && (
                  <div className="mt-4 space-y-3">
                    <textarea className={inputClass} rows={3} placeholder="Operations return-to-service condition / acceptance note" value={closeNote} onChange={(e) => setCloseNote(e.target.value)} />
                    <button disabled={!canRts || degraded || working || closeNote.trim().length < 10} onClick={() => void runAction(() => recoveryActions.closeEvent(detail.event.id, closeNote), "Restoration event closed. Counterfactual value remains projected pending independent verification.")} className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Accept return to service & close event</button>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      )}

      {view !== "board" && !detail && <Empty>Select an active event from the Fleet Down Board.</Empty>}
    </div>
  );

  async function openCompletion(item: RecoveryScopeItem) {
    setError(null);
    setWorking(true);
    try {
      const result = await getRecoveryQualityChecks(item.event_work_id);
      setCompletion({ eventWorkId: item.event_work_id, actualHours: "", note: "", checks: result.checks, passed: new Set() });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
}

function Metric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className={`${cardClass} p-4`}><div className="flex items-center gap-2 text-slate-500">{icon}<span className="text-xs uppercase tracking-wide">{label}</span></div><div className="mt-2 text-xl font-semibold text-industrial-text">{value}</div></div>;
}

function MiniMetric({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return <div><div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div><div className={`mt-0.5 text-sm ${alert ? "text-amber-300" : "text-slate-300"}`}>{value}</div></div>;
}

function ScopeRow({ item, checked, canPlan, onChecked, onSequence, onIncludeCandidate }: {
  item: RecoveryScopeItem; checked: boolean; canPlan: boolean; onChecked: (v: boolean) => void; onSequence: (v: number) => void; onIncludeCandidate: () => void;
}) {
  const [sequence, setSequence] = useState(String(item.sequence_no));
  useEffect(() => setSequence(String(item.sequence_no)), [item.sequence_no]);
  return (
    <div className="rounded-xl border border-industrial-border p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="flex flex-1 items-start gap-3">
          <input type="checkbox" className="mt-1" checked={checked} disabled={!canPlan || item.plan_state !== "included" || item.execution_status === "complete"} onChange={(e) => onChecked(e.target.checked)} />
          <div>
            <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-industrial-text">{item.wo_number ?? "WO"} · {item.title}</span><Pill tone={statusTone(item.plan_state)}>{item.plan_state}</Pill><Pill tone={statusTone(item.execution_status)}>{item.execution_status}</Pill></div>
            <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-400"><span>{item.priority}</span><span>{fmtHours(item.planned_hours ?? item.estimated_hours)}</span><span>{item.materials_ready ? "materials ready" : "materials not ready"}</span><span>{item.concurrency_rule.replaceAll("_", " ")}{item.parallel_group ? ` · ${item.parallel_group}` : ""}</span></div>
          </div>
        </label>
        {item.plan_state === "candidate" ? (
          <button disabled={!canPlan} onClick={onIncludeCandidate} className="rounded-lg border border-amber-500/30 px-3 py-2 text-xs text-amber-300 disabled:opacity-40">Include in revised plan</button>
        ) : (
          <div className="flex items-center gap-2"><span className="text-xs text-slate-500">Stage</span><input className="w-20 rounded-lg border border-industrial-border bg-industrial-slate px-2 py-1 text-sm text-industrial-text" type="number" min="1" value={sequence} disabled={!canPlan || item.execution_status === "complete"} onChange={(e) => setSequence(e.target.value)} onBlur={() => { const n = Number(sequence); if (Number.isFinite(n) && n > 0 && n !== item.sequence_no) onSequence(n); }} /></div>
        )}
      </div>
    </div>
  );
}

function ConstraintRow({ constraint, disabled, onSet }: { constraint: RecoveryConstraint; disabled: boolean; onSet: (state: string, basis: string) => void }) {
  const canManualClear = !["permit", "isolation", "asset_state"].includes(constraint.constraint_kind);
  return <div className="rounded-lg border border-industrial-border p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="flex flex-wrap items-center gap-2"><span className="font-medium text-industrial-text">{constraint.constraint_kind.replaceAll("_", " ")}</span><Pill tone={statusTone(constraint.state)}>{constraint.state}</Pill>{constraint.is_hard && <Pill>hard</Pill>}<Pill>{constraint.phase.replaceAll("_", " ")}</Pill></div><div className="mt-1 text-sm text-slate-400">{constraint.description}</div></div>{constraint.state !== "satisfied" && canManualClear && <button disabled={disabled} onClick={() => { const basis = window.prompt("Evidence/basis for satisfying this constraint (minimum 10 characters):") ?? ""; if (basis.trim().length >= 10) onSet("satisfied", basis); }} className="rounded-lg border border-emerald-500/30 px-2 py-1 text-xs text-emerald-300 disabled:opacity-40">Mark satisfied</button>}</div>{!canManualClear && <div className="mt-2 text-xs text-amber-300">This control cannot be self-cleared in Recovery; canonical operating/release evidence owns the truth.</div>}</div>;
}

function BlockerRow({ blocker, disabled, onResolve }: { blocker: RecoveryBlocker; disabled: boolean; onResolve: (note: string) => void }) {
  return <div className="rounded-lg border border-industrial-border p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="flex flex-wrap items-center gap-2"><span className="font-medium text-industrial-text">{blocker.category.replaceAll("_", " ")}</span><Pill tone={statusTone(blocker.severity)}>{blocker.severity}</Pill><Pill tone={statusTone(blocker.status)}>{blocker.status}</Pill></div><div className="mt-1 text-sm text-slate-400">{blocker.description}</div><div className="mt-1 text-xs text-slate-500">Owner: {blocker.owner_role}{blocker.forecast_rts_impact_hours != null ? ` · forecast impact ${blocker.forecast_rts_impact_hours} h` : ""}</div></div>{blocker.status === "open" && <button disabled={disabled} onClick={() => { const note = window.prompt("Resolution evidence/note (minimum 10 characters):") ?? ""; if (note.trim().length >= 10) onResolve(note); }} className="rounded-lg border border-emerald-500/30 px-2 py-1 text-xs text-emerald-300 disabled:opacity-40">Resolve</button>}</div></div>;
}

function OpportunityColumn({ title, items, tone, canAdd, onAdd }: { title: string; items: RecoveryOpportunities["fits"]; tone: "emerald" | "slate" | "amber"; canAdd: boolean; onAdd: (id: string) => void }) {
  const toneClass = tone === "emerald" ? "text-emerald-300" : tone === "amber" ? "text-amber-300" : "text-slate-300";
  return <section className={`${cardClass} p-5`}><h3 className={`font-semibold ${toneClass}`}>{title} · {items.length}</h3><div className="mt-4 space-y-3">{items.map((item) => <div key={item.work_order_id} className="rounded-lg border border-industrial-border p-3"><div className="font-medium text-industrial-text">{item.wo_number ?? "WO"} · {item.title}</div><div className="mt-1 text-xs text-slate-400">{item.priority} · {fmtHours(item.planned_hours)} · {item.reason}</div><button disabled={!canAdd} onClick={() => onAdd(item.work_order_id)} className="mt-3 rounded-lg border border-industrial-border px-2 py-1 text-xs text-slate-200 disabled:opacity-40"><Plus className="mr-1 inline h-3 w-3" />Add to event</button></div>)}{!items.length && <Empty>None.</Empty>}</div></section>;
}

function CompletionPanel({ draft, setDraft, disabled, onCancel, onComplete }: { draft: CompletionDraft; setDraft: (next: CompletionDraft | null) => void; disabled: boolean; onCancel: () => void; onComplete: () => void }) {
  const allPassed = draft.checks.every((c) => draft.passed.has(c.id));
  const hours = Number(draft.actualHours);
  return <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4"><div className="mb-3 flex items-center gap-2 font-medium text-emerald-200"><PackageCheck className="h-4 w-4" /> Completion evidence</div><div className="grid gap-3 md:grid-cols-2"><input className={inputClass} type="number" min="0.1" step="0.1" placeholder="Actual labour hours" value={draft.actualHours} onChange={(e) => setDraft({ ...draft, actualHours: e.target.value })} /><textarea className={inputClass} rows={2} placeholder="Completion condition / evidence note" value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></div><div className="mt-4 space-y-2">{draft.checks.map((check) => <label key={check.id} className="flex gap-3 rounded-lg border border-industrial-border p-3"><input type="checkbox" checked={draft.passed.has(check.id)} onChange={(e) => { const passed = new Set(draft.passed); if (e.target.checked) passed.add(check.id); else passed.delete(check.id); setDraft({ ...draft, passed }); }} /><div><div className="text-sm font-medium text-industrial-text">{check.is_hold_point && <span className="mr-2 text-amber-300">HOLD POINT</span>}{check.check_description}</div><div className="text-xs text-slate-400">Acceptance: {check.acceptance_criterion}</div></div></label>)}{draft.checks.length === 0 && <div className="text-xs text-slate-400">No governed job-plan acceptance checks are attached to this work order. Actual hours and a substantive completion note are still required.</div>}</div><div className="mt-4 flex gap-2"><button onClick={onCancel} className="rounded-lg border border-industrial-border px-3 py-2 text-sm text-slate-300">Cancel</button><button disabled={disabled || !Number.isFinite(hours) || hours <= 0 || draft.note.trim().length < 10 || !allPassed} onClick={onComplete} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Complete with evidence</button></div></div>;
}
