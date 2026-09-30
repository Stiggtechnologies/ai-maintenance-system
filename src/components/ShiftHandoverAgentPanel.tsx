import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Clock3,
  Database,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import {
  acknowledgeShiftHandoverPack,
  getShiftHandoverPacks,
  getShiftHandoverSites,
  runSiteMaintenanceManager,
  type ShiftHandoverPack,
} from "../services/shiftHandoverService";
import { ErrorState, LoadingState } from "./ui/AsyncStates";

const fieldClass =
  "w-full rounded-lg border border-white/10 bg-[#081019] px-3 py-2 text-sm text-slate-100 outline-none focus:border-teal-400/60";

const sourceLabels: Array<[keyof ShiftHandoverPack["sourceSnapshot"], string]> =
  [
    ["workOrders", "High / critical work"],
    ["processEvents", "Process events"],
    ["equipmentCustody", "Equipment custody"],
    ["materialShortages", "Material shortages"],
    ["recoveryBlockers", "Recovery blockers"],
    ["operatorRounds", "Rounds in progress"],
  ];

function PackCard({
  pack,
  onAcknowledged,
}: {
  pack: ShiftHandoverPack;
  onAcknowledged: () => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function acknowledge(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await acknowledgeShiftHandoverPack(pack.id, note);
      setNote("");
      await onAcknowledged();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Acknowledgement failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-xl border border-white/8 bg-[#081019] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-100">
            {pack.outgoingShiftLabel} → {pack.incomingShiftLabel}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {new Date(pack.windowStart).toLocaleString()} —{" "}
            {new Date(pack.windowEnd).toLocaleString()}
          </p>
          <p className="mt-1 font-mono text-[11px] text-slate-500">
            Evidence run {pack.agentRunId.slice(0, 8)}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            pack.status === "acknowledged"
              ? "bg-emerald-500/10 text-emerald-300"
              : "bg-amber-500/10 text-amber-300"
          }`}
        >
          {pack.status === "acknowledged"
            ? "Acknowledged"
            : "Incoming acknowledgement required"}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3">
        {sourceLabels.map(([key, label]) => (
          <div
            key={key}
            className="rounded-lg border border-white/6 bg-white/3 p-2.5"
          >
            <p className="text-lg font-bold text-slate-100">
              {Array.isArray(pack.sourceSnapshot[key])
                ? (pack.sourceSnapshot[key] as unknown[]).length
                : 0}
            </p>
            <p className="text-[11px] text-slate-400">{label}</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-sky-400/10 bg-sky-400/5 p-3 text-xs text-slate-300">
        <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" />
        <p>
          Frozen at {new Date(pack.sourceSnapshot.asOf).toLocaleString()} from
          canonical tenant records. Empty sections are “no matching evidence,”
          not a safe-state declaration.
        </p>
      </div>

      {pack.status === "acknowledged" ? (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-400/15 bg-emerald-400/5 p-3 text-xs text-emerald-100">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            Received by {pack.acknowledgedRole?.replaceAll("_", " ")} on{" "}
            {pack.acknowledgedAt
              ? new Date(pack.acknowledgedAt).toLocaleString()
              : "recorded time"}
            . Receipt changed no work, risk, schedule, custody or
            return-to-service state.
          </p>
        </div>
      ) : (
        <form onSubmit={acknowledge} className="mt-3 space-y-2">
          <label className="block text-xs font-medium text-slate-300">
            Incoming-shift acknowledgement note
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              minLength={10}
              required
              rows={2}
              placeholder="Confirm receipt and record what the incoming shift will verify first."
              className={`${fieldClass} mt-1 resize-y`}
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-slate-500">
              Must be a different signed-in person from the pack creator.
            </p>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg border border-emerald-400/30 px-3 py-1.5 text-xs font-semibold text-emerald-200 disabled:opacity-50"
            >
              {busy ? "Recording…" : "Acknowledge receipt"}
            </button>
          </div>
          {error && <p className="text-xs text-rose-300">{error}</p>}
        </form>
      )}
    </article>
  );
}

export function ShiftHandoverAgentPanel() {
  const { data, loading, error, refetch } = useAsyncData(async () => {
    const [sites, packs] = await Promise.all([
      getShiftHandoverSites(),
      getShiftHandoverPacks(),
    ]);
    return { sites, packs };
  }, []);
  const [siteId, setSiteId] = useState("");
  const [windowHours, setWindowHours] = useState(12);
  const [outgoing, setOutgoing] = useState("Outgoing shift");
  const [incoming, setIncoming] = useState("Incoming shift");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!siteId && data?.sites[0]) setSiteId(data.sites[0].id);
  }, [data?.sites, siteId]);

  const visiblePacks = useMemo(
    () =>
      (data?.packs ?? []).filter((pack) => !siteId || pack.siteId === siteId),
    [data?.packs, siteId],
  );

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!siteId) return;
    setBusy(true);
    setActionError(null);
    try {
      await runSiteMaintenanceManager({
        siteId,
        windowHours,
        outgoingShiftLabel: outgoing,
        incomingShiftLabel: incoming,
      });
      await refetch();
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : "Could not generate the handover pack.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState label="Loading governed shift handovers" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  return (
    <section
      aria-labelledby="shift-agent-heading"
      className="rounded-2xl border border-teal-400/15 bg-[#0D1520] p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-teal-300">
            <Bot className="h-4 w-4" /> Governed Site Maintenance Manager agent
          </p>
          <h2
            id="shift-agent-heading"
            className="mt-1 text-lg font-bold text-white"
          >
            Durable shift-handover pack
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-400">
            Freeze the current site picture from work, events, custody,
            materials, recovery, rounds and the daily coordination record. A
            different incoming-shift human acknowledges receipt.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-white/8 bg-white/3 px-3 py-2 text-xs text-slate-300">
          <ShieldCheck className="h-4 w-4 text-teal-300" /> Advisory only · no
          execution authority
        </div>
      </div>

      <form
        onSubmit={generate}
        className="mt-5 grid gap-3 lg:grid-cols-[1.3fr_0.6fr_1fr_1fr_auto] lg:items-end"
      >
        <label className="text-xs font-medium text-slate-300">
          Site
          <select
            value={siteId}
            onChange={(event) => setSiteId(event.target.value)}
            required
            className={`${fieldClass} mt-1`}
          >
            <option value="">Select a site</option>
            {(data?.sites ?? []).map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-300">
          Evidence window
          <select
            value={windowHours}
            onChange={(event) => setWindowHours(Number(event.target.value))}
            className={`${fieldClass} mt-1`}
          >
            <option value={8}>8 hours</option>
            <option value={12}>12 hours</option>
            <option value={24}>24 hours</option>
            <option value={72}>72 hours</option>
          </select>
        </label>
        <label className="text-xs font-medium text-slate-300">
          Outgoing shift
          <input
            value={outgoing}
            onChange={(event) => setOutgoing(event.target.value)}
            minLength={2}
            maxLength={80}
            required
            className={`${fieldClass} mt-1`}
          />
        </label>
        <label className="text-xs font-medium text-slate-300">
          Incoming shift
          <input
            value={incoming}
            onChange={(event) => setIncoming(event.target.value)}
            minLength={2}
            maxLength={80}
            required
            className={`${fieldClass} mt-1`}
          />
        </label>
        <button
          type="submit"
          disabled={busy || !siteId}
          className="rounded-lg bg-teal-400 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-50"
        >
          {busy ? "Freezing…" : "Generate pack"}
        </button>
      </form>
      {actionError && (
        <p className="mt-3 text-xs text-rose-300">{actionError}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-slate-500">
        <span className="flex items-center gap-1">
          <Users className="h-3.5 w-3.5" /> Different-person acknowledgement
        </span>
        <span className="flex items-center gap-1">
          <Clock3 className="h-3.5 w-3.5" /> Captured window and freshness
          retained
        </span>
        <span className="flex items-center gap-1">
          <Database className="h-3.5 w-3.5" /> Exact source IDs preserved
        </span>
      </div>

      <div className="mt-5 space-y-3">
        {visiblePacks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/10 p-5 text-center text-sm text-slate-400">
            No governed handover pack has been generated for this site yet.
          </p>
        ) : (
          visiblePacks.map((pack) => (
            <PackCard
              key={pack.id}
              pack={pack}
              onAcknowledged={async () => {
                await refetch();
              }}
            />
          ))
        )}
      </div>
    </section>
  );
}
