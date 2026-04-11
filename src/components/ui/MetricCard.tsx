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

const variantBorder = {
  default: "border-white/[0.06]",
  success: "border-emerald-500/20 hover:border-emerald-500/30",
  warning: "border-amber-500/20 hover:border-amber-500/30",
  danger: "border-red-500/20 hover:border-red-500/30",
  info: "border-teal-500/20 hover:border-teal-500/30",
};

const variantGlow = {
  default: "",
  success: "hover:shadow-[0_0_20px_rgba(16,185,129,0.08)]",
  warning: "hover:shadow-[0_0_20px_rgba(245,158,11,0.08)]",
  danger: "hover:shadow-[0_0_20px_rgba(239,68,68,0.08)]",
  info: "hover:shadow-[0_0_20px_rgba(20,184,166,0.08)]",
};

const iconBg = {
  default: "bg-white/[0.04] text-slate-400",
  success: "bg-emerald-500/10 text-emerald-400",
  warning: "bg-amber-500/10 text-amber-400",
  danger: "bg-red-500/10 text-red-400",
  info: "bg-teal-500/10 text-teal-400",
};

const trendColors = {
  up: "text-emerald-400",
  down: "text-red-400",
  flat: "text-slate-500",
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
    <div
      className={`glass border rounded-xl p-5 transition-all duration-300 ${variantBorder[variant]} ${variantGlow[variant]}`}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest">
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
        <div className="h-8 w-24 bg-white/[0.04] rounded animate-pulse" />
      ) : (
        <div className="flex items-end gap-1.5">
          <span className="text-2xl font-bold text-[#E6EDF3] tracking-tight">
            {value}
          </span>
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
