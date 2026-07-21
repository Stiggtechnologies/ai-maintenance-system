/**
 * Shared loading / error / empty state primitives so every Supabase-backed
 * surface degrades gracefully and never crashes on missing data.
 */
import { TriangleAlert as AlertTriangle, Inbox, RefreshCw } from "lucide-react";

/**
 * Skeleton shimmer instead of a blocking spinner: content shape appears
 * immediately (perceived performance), the pulse respects
 * prefers-reduced-motion, and the label stays available to screen readers.
 */
export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="space-y-3 py-8"
      data-testid="loading-skeleton"
    >
      <span className="sr-only">{label}</span>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-20 rounded-xl border border-white/4 bg-white/3 animate-pulse motion-reduce:animate-none"
          />
        ))}
      </div>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-14 rounded-xl border border-white/4 bg-white/3 animate-pulse motion-reduce:animate-none"
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
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
      <div className="text-xs text-slate-400">
        Showing no data rather than stale values.
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 flex items-center gap-1.5 px-3 py-1.5 bg-white/4 border border-white/8 rounded-lg text-xs text-slate-300 hover:bg-white/8 transition-colors"
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
