import {
  canDisplaySourceAsLive,
  type ContextSource,
} from "../../lib/sync-context/contracts";

const label = (value: string) => value.replaceAll("_", " ");

export function ContextProvenanceBadges({ source }: { source: ContextSource }) {
  const live = canDisplaySourceAsLive(source);
  const demoOnly =
    source.class === "live_external" && source.rightsState === "demo_approved";
  return (
    <div
      className="mt-2 flex flex-wrap gap-1 text-[10px] uppercase tracking-wide"
      aria-label={`Source provenance for ${source.name}`}
    >
      <span className="rounded border border-sky-400/30 px-1.5 py-0.5 text-sky-200">
        {label(source.class)}
      </span>
      <span
        className={`rounded border px-1.5 py-0.5 ${
          live
            ? "border-emerald-400/30 text-emerald-200"
            : "border-amber-400/30 text-amber-200"
        }`}
      >
        {live ? "live" : label(source.state)}
      </span>
      <span className="rounded border border-white/15 px-1.5 py-0.5 text-slate-300">
        {label(source.authority)}
      </span>
      <span className="rounded border border-white/15 px-1.5 py-0.5 text-slate-300">
        rights: {label(source.rightsState)}
      </span>
      {demoOnly && (
        <span className="rounded border border-violet-400/30 px-1.5 py-0.5 text-violet-200">
          demo-only rights · not live
        </span>
      )}
      {!live && source.state === "live" && (
        <span className="rounded border border-rose-400/30 px-1.5 py-0.5 text-rose-200">
          live claim blocked
        </span>
      )}
    </div>
  );
}
