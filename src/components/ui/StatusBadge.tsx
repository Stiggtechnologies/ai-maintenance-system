interface StatusBadgeProps {
  status: string;
  variant?: "default" | "success" | "warning" | "danger" | "info" | "muted";
  size?: "sm" | "md";
}

const variantStyles = {
  default: "bg-slate-500/10 text-slate-400 border border-slate-500/20",
  success: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  warning: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
  danger: "bg-red-500/10 text-red-400 border border-red-500/20",
  info: "bg-teal-500/10 text-teal-400 border border-teal-500/20",
  muted: "bg-slate-800/50 text-slate-500 border border-slate-700/30",
};

const sizeStyles = {
  sm: "px-1.5 py-0.5 text-xs",
  md: "px-2.5 py-1 text-xs",
};

function autoVariant(status: string): StatusBadgeProps["variant"] {
  const s = status.toLowerCase();
  if (
    [
      "completed",
      "approved",
      "executed",
      "success",
      "operational",
      "active",
    ].includes(s)
  )
    return "success";
  if (["pending", "pending_approval", "in_progress", "degraded"].includes(s))
    return "warning";
  if (["failed", "rejected", "critical", "error", "cancelled"].includes(s))
    return "danger";
  if (["advisory", "conditional", "controlled"].includes(s)) return "info";
  if (["new", "queued", "draft"].includes(s)) return "muted";
  return "default";
}

export function StatusBadge({
  status,
  variant,
  size = "md",
}: StatusBadgeProps) {
  const v = variant ?? autoVariant(status) ?? "default";
  const display = status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <span
      className={`inline-flex items-center font-medium rounded-full ${variantStyles[v]} ${sizeStyles[size]}`}
    >
      {display}
    </span>
  );
}
