/**
 * Shared loading / error / empty state primitives so every Supabase-backed
 * surface degrades gracefully and never crashes on missing data.
 */
import {
  Loader2,
  TriangleAlert as AlertTriangle,
  Inbox,
  RefreshCw,
} from "lucide-react";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-400">
      <Loader2 className="w-5 h-5 animate-spin text-teal-400" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
      <AlertTriangle className="w-8 h-8 text-amber-400" />
      <div className="text-sm text-slate-300 max-w-md">{message}</div>
      <div className="text-[11px] text-slate-400">
        Showing no data rather than stale values.
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] rounded-lg text-xs text-slate-300 hover:bg-white/[0.08] transition-colors"
        >
          <RefreshCw className="w-3 h-3" /> Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-slate-400">
      <Inbox className="w-8 h-8 opacity-50" />
      <div className="text-sm">{message}</div>
    </div>
  );
}
