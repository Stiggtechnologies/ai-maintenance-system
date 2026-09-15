import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";
import {
  createOperatingCommand,
  getOperatingCommandWorkspace,
  RECOVERY_OPERATING_MODES,
  requestOperatingMode,
  reviewOperatingMode,
  type OperatingCommandWorkspace,
  type RecoveryOperatingMode,
} from "../services/recoveryOperatingCommandService";
import { supabase } from "../lib/supabase";
const label = (x: string) => x.replaceAll("_", " ");
const field =
  "w-full rounded-lg border border-industrial-border bg-industrial-slate px-3 py-2 text-sm text-industrial-text";
export function RecoveryOperatingCommand() {
  const [data, setData] = useState<OperatingCommandWorkspace | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [assets, setAssets] = useState<
      Array<{ id: string; name: string; site_id: string | null }>
    >([]),
    [events, setEvents] = useState<
      Array<{ id: string; event_code: string; asset_id: string }>
    >([]),
    [evidence, setEvidence] = useState<
      Array<{ id: string; description: string }>
    >([]);
  const [ref, setRef] = useState(""),
    [assetId, setAssetId] = useState(""),
    [eventId, setEventId] = useState(""),
    [commandId, setCommandId] = useState("");
  const [mode, setMode] = useState<RecoveryOperatingMode>("elevated_risk"),
    [basis, setBasis] = useState(""),
    [evidenceId, setEvidenceId] = useState(""),
    [gap, setGap] = useState(""),
    [notes, setNotes] = useState<Record<string, string>>({});
  const reload = useCallback(async () => {
    try {
      const [workspace, a, e, v] = await Promise.all([
        getOperatingCommandWorkspace(),
        supabase.from("assets").select("id,name,site_id").order("name"),
        supabase
          .from("restoration_events")
          .select("id,event_code,asset_id")
          .order("opened_at", { ascending: false }),
        supabase
          .from("evidence_items")
          .select("id,description")
          .eq("verification_status", "verified")
          .limit(100),
      ]);
      if (a.error || e.error || v.error)
        throw new Error(
          a.error?.message || e.error?.message || v.error?.message,
        );
      setData(workspace);
      setAssets(a.data ?? []);
      setEvents(e.data ?? []);
      setEvidence(v.data ?? []);
      setCommandId((x) => x || workspace.commands[0]?.id || "");
      setError("");
    } catch (x) {
      setError(x instanceof Error ? x.message : String(x));
    }
  }, []);
  useEffect(() => void reload(), [reload]);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await reload();
    } catch (x) {
      setError(x instanceof Error ? x.message : String(x));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-5" aria-labelledby="operating-command-heading">
      <div className="rounded-xl border border-teal-500/25 bg-teal-500/5 p-5">
        <div className="flex gap-3">
          <ShieldCheck className="h-5 w-5 text-teal-300" />
          <div>
            <h2
              id="operating-command-heading"
              className="font-semibold text-industrial-text"
            >
              Emergency &amp; restoration command
            </h2>
            <p className="mt-1 text-sm text-slate-300">
              Track all eight operating modes from normal readiness through
              independently authorized post-event learning.
            </p>
            <p className="mt-2 text-xs text-amber-200">
              Command state is not field authority. SyncAI never declares an
              emergency, dispatches people, isolates assets, releases work or
              approves return to service.
            </p>
          </div>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300"
        >
          {error}
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-3">
        <form
          className="space-y-3 rounded-xl border border-industrial-border bg-industrial-graphite p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              const asset = assets.find((x) => x.id === assetId);
              const result = await createOperatingCommand({
                command_ref: ref,
                asset_id: assetId,
                site_id: asset?.site_id,
                restoration_event_id: eventId || undefined,
              });
              setCommandId(result.command_id);
              setRef("");
            });
          }}
        >
          <h3 className="font-medium text-white">Open command record</h3>
          <input
            required
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            placeholder="Command reference"
            className={field}
          />
          <select
            required
            value={assetId}
            onChange={(e) => {
              setAssetId(e.target.value);
              setEventId("");
            }}
            className={field}
          >
            <option value="">Select canonical asset</option>
            {assets.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <select
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className={field}
          >
            <option value="">No restoration event yet</option>
            {events
              .filter((x) => !assetId || x.asset_id === assetId)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.event_code}
                </option>
              ))}
          </select>
          <button
            disabled={busy}
            className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
          >
            Open in normal mode
          </button>
        </form>
        <form
          className="space-y-3 rounded-xl border border-industrial-border bg-industrial-graphite p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void act(() =>
              requestOperatingMode(
                commandId,
                mode,
                basis,
                evidenceId ? [evidenceId] : [],
                gap ? [gap] : [],
              ),
            );
          }}
        >
          <h3 className="font-medium text-white">Request mode transition</h3>
          <select
            required
            value={commandId}
            onChange={(e) => setCommandId(e.target.value)}
            className={field}
          >
            <option value="">Select command</option>
            {data?.commands.map((x) => (
              <option key={x.id} value={x.id}>
                {x.command_ref} · {label(x.current_mode)}
              </option>
            ))}
          </select>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as RecoveryOperatingMode)}
            className={field}
          >
            {RECOVERY_OPERATING_MODES.map((x) => (
              <option key={x} value={x}>
                {label(x)}
              </option>
            ))}
          </select>
          <textarea
            required
            value={basis}
            onChange={(e) => setBasis(e.target.value)}
            placeholder="Observed conditions and transition basis"
            className={field}
          />
          <select
            value={evidenceId}
            onChange={(e) => setEvidenceId(e.target.value)}
            className={field}
          >
            <option value="">
              Verified evidence required for authorization
            </option>
            {evidence.map((x) => (
              <option key={x.id} value={x.id}>
                {x.description}
              </option>
            ))}
          </select>
          <input
            value={gap}
            onChange={(e) => setGap(e.target.value)}
            placeholder="Missing evidence (never hidden)"
            className={field}
          />
          <button
            disabled={busy || !commandId}
            className="rounded-lg border border-amber-400/40 px-4 py-2 text-sm text-amber-200 disabled:opacity-50"
          >
            Submit for independent authorization
          </button>
        </form>
        <div className="rounded-xl border border-industrial-border bg-industrial-graphite p-4">
          <h3 className="font-medium text-white">Controlled progression</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {RECOVERY_OPERATING_MODES.map((x) => (
              <span
                key={x}
                className="rounded-full border border-white/10 px-2 py-1 text-xs capitalize text-slate-300"
              >
                {label(x)}
              </span>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-400">
            Invalid jumps are refused. Emergency and later modes require a
            canonical restoration event; post-event learning requires it to be
            closed.
          </p>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {data?.commands.map((c) => (
          <article
            key={c.id}
            className="rounded-xl border border-industrial-border bg-industrial-graphite p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-white">{c.command_ref}</h3>
                <p className="text-xs text-slate-400">
                  {c.asset_name || c.site_name}{" "}
                  {c.event_code ? `· ${c.event_code}` : "· readiness scope"}
                </p>
              </div>
              <span className="rounded-full bg-teal-500/15 px-3 py-1 text-xs capitalize text-teal-300">
                {label(c.current_mode)}
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {c.transitions.slice(0, 4).map((t) => (
                <div
                  key={t.id}
                  className="rounded-lg border border-white/8 p-3 text-sm"
                >
                  <div className="flex items-center gap-2 text-slate-200">
                    {t.status === "authorized" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-300" />
                    )}
                    <span className="capitalize">
                      {label(t.from_mode)} → {label(t.to_mode)}
                    </span>
                    <span className="ml-auto text-xs capitalize text-slate-400">
                      {t.status}
                    </span>
                  </div>
                  {t.status === "pending" && (
                    <div className="mt-2 space-y-2">
                      <input
                        value={notes[t.id] || ""}
                        onChange={(e) =>
                          setNotes({ ...notes, [t.id]: e.target.value })
                        }
                        placeholder="Independent review note"
                        className={field}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void act(() =>
                              reviewOperatingMode(
                                t.id,
                                "authorize",
                                notes[t.id] || "",
                              ),
                            )
                          }
                          className="rounded border border-emerald-500/40 px-2 py-1 text-xs text-emerald-300"
                        >
                          Authorize state
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void act(() =>
                              reviewOperatingMode(
                                t.id,
                                "reject",
                                notes[t.id] || "",
                              ),
                            )
                          }
                          className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
