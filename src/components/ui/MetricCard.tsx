import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  icon?: LucideIcon;
  trend?: "up" | "down" | "flat";
  trendLabel?: string;
  variant?: "default" | "success" | "warning" | "danger" | "info";
  loading?: boolean;
}

const variantStyles = {
  default: "bg-white border-slate-200",
  success: "bg-white border-green-200",
  warning: "bg-white border-yellow-200",
  danger: "bg-white border-red-200",
  info: "bg-white border-blue-200",
};

const iconBg = {
  default: "bg-slate-100 text-slate-600",
  success: "bg-green-100 text-green-600",
  warning: "bg-yellow-100 text-yellow-600",
  danger: "bg-red-100 text-red-600",
  info: "bg-blue-100 text-blue-600",
};

const trendColors = {
  up: "text-green-600",
  down: "text-red-600",
  flat: "text-slate-400",
};

export function MetricCard({
  label,
  value,
  unit,
  icon: Icon,
  trend,
  trendLabel,
  variant = "default",
  loading = false,
}: MetricCardProps) {
  const TrendIcon =
    trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;

  return (
    <div className={`border rounded-xl p-5 ${variantStyles[variant]}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          {label}
        </span>
        {Icon && (
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconBg[variant]}`}
          >
            <Icon size={16} />
          </div>
        )}
      </div>
      {loading ? (
        <div className="h-8 w-24 bg-slate-100 rounded animate-pulse" />
      ) : (
        <div className="flex items-end gap-1.5">
          <span className="text-2xl font-bold text-slate-900">{value}</span>
          {unit && (
            <span className="text-sm text-slate-500 mb-0.5">{unit}</span>
          )}
        </div>
      )}
      {trend && trendLabel && (
        <div
          className={`flex items-center gap-1 mt-2 text-xs ${trendColors[trend]}`}
        >
          <TrendIcon size={12} />
          <span>{trendLabel}</span>
        </div>
      )}
    </div>
  );
}
