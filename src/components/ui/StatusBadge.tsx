interface StatusBadgeProps {
  status: string;
  variant?: "default" | "success" | "warning" | "danger" | "info" | "muted";
  size?: "sm" | "md";
}

const variantStyles = {
  default: "bg-slate-100 text-slate-700",
  success: "bg-green-100 text-green-800",
  warning: "bg-yellow-100 text-yellow-800",
  danger: "bg-red-100 text-red-700",
  info: "bg-blue-100 text-blue-800",
  muted: "bg-slate-50 text-slate-500",
};

const sizeStyles = {
  sm: "px-1.5 py-0.5 text-xs",
  md: "px-2.5 py-1 text-xs",
};

/**
 * Renders a status label automatically if no variant is provided.
 * Known statuses get auto-colored; unknown statuses use "default".
 */
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
      className={`inline-flex items-center font-semibold rounded-full ${variantStyles[v]} ${sizeStyles[size]}`}
    >
      {display}
    </span>
  );
}
