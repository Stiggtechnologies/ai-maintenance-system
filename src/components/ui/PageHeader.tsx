import type { LucideIcon } from "lucide-react";

interface PageHeaderProps {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function PageHeader({
  icon: Icon,
  title,
  subtitle,
  actions,
}: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-3">
          {Icon && (
            <div className="w-9 h-9 bg-gradient-to-br from-teal-500 to-teal-600 rounded-xl flex items-center justify-center shadow-[0_0_12px_rgba(20,184,166,0.3)]">
              <Icon size={18} className="text-white" />
            </div>
          )}
          <h1 className="text-2xl font-bold text-[#E6EDF3] tracking-tight">
            {title}
          </h1>
        </div>
        {subtitle && <p className="text-slate-500 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
