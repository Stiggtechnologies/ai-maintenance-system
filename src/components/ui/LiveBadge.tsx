/**
 * LiveBadge — indicates an active realtime stream on the current view.
 * The pulse is decorative; the state is real (Supabase channel SUBSCRIBED).
 */
export function LiveBadge({ live }: { live: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        live
          ? "border-signal-cyan/40 bg-signal-cyan/10 text-signal-cyan"
          : "border-slate-600 bg-slate-800/60 text-slate-400"
      }`}
      title={
        live
          ? "Streaming live changes from the data plane"
          : "Realtime stream connecting…"
      }
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${live ? "animate-pulse bg-signal-cyan" : "bg-slate-500"}`}
      />
      {live ? "LIVE" : "CONNECTING"}
    </span>
  );
}
