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
        <div className="flex items-center gap-2">
          {Icon && (
            <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
              <Icon size={18} className="text-blue-600" />
            </div>
          )}
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        </div>
        {subtitle && <p className="text-slate-600 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
