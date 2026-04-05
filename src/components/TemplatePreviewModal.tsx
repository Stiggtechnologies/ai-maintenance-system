import { useState, useEffect } from "react";
import {
  X,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  BarChart3,
  Package,
  AlertTriangle,
  Shield,
  Gauge,
  Wrench,
  Target,
  Layers,
  Clock,
  Factory,
} from "lucide-react";
import { supabase } from "../lib/supabase";

interface TemplatePreviewModalProps {
  template: {
    id: string;
    name: string;
    slug: string;
    description: string;
    master_family: string;
    master_template_name?: string;
    operating_assumptions?: Record<string, unknown>;
    kpi_packs?: { pack_name: string; kpi_count: number } | null;
    industry_asset_libraries?: {
      library_name: string;
      asset_class_count: number;
    } | null;
    industry_criticality_profiles?: { profile_name: string } | null;
    industry_governance_profiles?: {
      profile_name: string;
      default_autonomy_mode: string;
    } | null;
    industry_failure_mode_packs?: {
      pack_name: string;
      failure_mode_count: number;
    } | null;
    industry_oee_models?: { model_name: string } | null;
  };
  onClose: () => void;
  onSelect: () => void;
}

interface SectionProps {
  title: string;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function AccordionSection({
  title,
  icon,
  defaultOpen = false,
  children,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-slate-100 last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-slate-50 transition-colors"
      >
        <span className="text-slate-400">{icon}</span>
        <span className="flex-1 text-sm font-medium text-slate-900">
          {title}
        </span>
        {open ? (
          <ChevronDown size={16} className="text-slate-400" />
        ) : (
          <ChevronRight size={16} className="text-slate-400" />
        )}
      </button>
      {open && <div className="px-5 pb-4">{children}</div>}
    </div>
  );
}

export function TemplatePreviewModal({
  template,
  onClose,
  onSelect,
}: TemplatePreviewModalProps) {
  const [details, setDetails] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id]);

  const loadDetails = async () => {
    setLoading(true);

    try {
      const { data: fnData, error: fnError } = await supabase.functions.invoke(
        "template-resolver",
        {
          body: { action: "get_template_detail", template_id: template.id },
        },
      );
      if (!fnError && fnData) {
        setDetails(fnData);
        setLoading(false);
        return;
      }
    } catch {
      // Fall back to direct queries
    }

    try {
      const [
        kpisRes,
        assetsRes,
        criticalityRes,
        governanceRes,
        failureModesRes,
        oeeRes,
        rolloutRes,
        workTaxRes,
      ] = await Promise.all([
        supabase
          .from("industry_kpis")
          .select("*")
          .eq("template_id", template.id)
          .order("level, name"),
        supabase
          .from("industry_asset_classes")
          .select("*")
          .eq("template_id", template.id)
          .order("category, name"),
        supabase
          .from("industry_criticality_weights")
          .select("*")
          .eq("template_id", template.id),
        supabase
          .from("industry_governance_rules")
          .select("*")
          .eq("template_id", template.id),
        supabase
          .from("industry_failure_modes")
          .select("*")
          .eq("template_id", template.id)
          .order("severity desc")
          .limit(20),
        supabase
          .from("industry_oee_configs")
          .select("*")
          .eq("template_id", template.id),
        supabase
          .from("industry_rollout_phases")
          .select("*")
          .eq("template_id", template.id)
          .order("phase_order"),
        supabase
          .from("industry_work_types")
          .select("*")
          .eq("template_id", template.id)
          .order("name"),
      ]);

      setDetails({
        kpis: kpisRes.data || [],
        assets: assetsRes.data || [],
        criticality: criticalityRes.data || [],
        governance: governanceRes.data || [],
        failureModes: failureModesRes.data || [],
        oee: oeeRes.data || [],
        rollout: rolloutRes.data || [],
        workTypes: workTaxRes.data || [],
      });
    } catch (err) {
      console.error("Error loading template details:", err);
      setDetails({
        kpis: [],
        assets: [],
        criticality: [],
        governance: [],
        failureModes: [],
        oee: [],
        rollout: [],
        workTypes: [],
      });
    }

    setLoading(false);
  };

  const groupBy = <T,>(arr: T[], key: string): Record<string, T[]> => {
    return arr.reduce(
      (acc, item) => {
        const group = (item as Record<string, unknown>)[key] || "Other";
        if (!acc[group]) acc[group] = [];
        acc[group].push(item);
        return acc;
      },
      {} as Record<string, T[]>,
    );
  };

  const severityColor = (severity: number | string) => {
    const s = typeof severity === "string" ? parseInt(severity, 10) : severity;
    if (s >= 8) return "bg-red-500";
    if (s >= 5) return "bg-amber-500";
    return "bg-green-500";
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Slide-over Panel */}
      <div className="relative w-full max-w-lg bg-white shadow-2xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-white">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {template.name}
            </h2>
            {template.master_template_name && (
              <p className="text-xs text-slate-500 mt-0.5">
                Built on: {template.master_template_name}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {/* Overview Section */}
              <AccordionSection
                title="Overview"
                icon={<Factory size={16} />}
                defaultOpen
              >
                <div className="space-y-3">
                  <p className="text-sm text-slate-600 leading-relaxed">
                    {template.description}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 rounded-lg p-3">
                      <div className="text-xs text-slate-500">
                        Master Family
                      </div>
                      <div className="text-sm font-medium text-slate-900 mt-0.5">
                        {template.master_family}
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-3">
                      <div className="text-xs text-slate-500">Governance</div>
                      <div className="text-sm font-medium text-slate-900 mt-0.5">
                        {template.industry_governance_profiles
                          ?.default_autonomy_mode || "Advisory"}
                      </div>
                    </div>
                  </div>
                  {template.operating_assumptions &&
                    Object.keys(template.operating_assumptions).length > 0 && (
                      <div className="bg-slate-50 rounded-lg p-3">
                        <div className="text-xs text-slate-500 mb-2">
                          Operating Assumptions
                        </div>
                        <div className="space-y-1">
                          {Object.entries(template.operating_assumptions).map(
                            ([key, value]) => (
                              <div
                                key={key}
                                className="flex items-center justify-between text-xs"
                              >
                                <span className="text-slate-600 capitalize">
                                  {key.replace(/_/g, " ")}
                                </span>
                                <span className="font-medium text-slate-900">
                                  {String(value)}
                                </span>
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    )}
                </div>
              </AccordionSection>

              {/* KPI Pack */}
              <AccordionSection
                title={`KPI Pack (${details?.kpis?.length || 0})`}
                icon={<BarChart3 size={16} />}
              >
                {details?.kpis?.length > 0 ? (
                  <div className="space-y-3">
                    {Object.entries(groupBy(details.kpis, "level")).map(
                      ([level, kpis]: [string, Record<string, unknown>[]]) => (
                        <div key={level}>
                          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                            {level}
                          </div>
                          <div className="space-y-1">
                            {kpis.map(
                              (kpi: Record<string, unknown>, i: number) => (
                                <div
                                  key={i}
                                  className="flex items-center justify-between text-xs py-1 px-2 rounded bg-slate-50"
                                >
                                  <span className="text-slate-700">
                                    {kpi.name}
                                  </span>
                                  {kpi.unit && (
                                    <span className="text-slate-400">
                                      {kpi.unit}
                                    </span>
                                  )}
                                </div>
                              ),
                            )}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">
                    No KPI data available.
                  </p>
                )}
              </AccordionSection>

              {/* Asset Library */}
              <AccordionSection
                title={`Asset Library (${details?.assets?.length || 0})`}
                icon={<Package size={16} />}
              >
                {details?.assets?.length > 0 ? (
                  <div className="space-y-3">
                    {Object.entries(groupBy(details.assets, "category")).map(
                      ([category, assets]: [
                        string,
                        Record<string, unknown>[],
                      ]) => (
                        <div key={category}>
                          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                            {category}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {assets.map(
                              (asset: Record<string, unknown>, i: number) => (
                                <span
                                  key={i}
                                  className="text-xs px-2 py-1 bg-slate-100 text-slate-700 rounded-md"
                                >
                                  {asset.name}
                                </span>
                              ),
                            )}
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">
                    No asset data available.
                  </p>
                )}
              </AccordionSection>

              {/* Criticality Model */}
              <AccordionSection
                title="Criticality Model"
                icon={<Target size={16} />}
              >
                {details?.criticality?.length > 0 ? (
                  <div className="space-y-2">
                    {details.criticality.map(
                      (item: Record<string, unknown>, i: number) => (
                        <div key={i}>
                          <div className="flex items-center justify-between text-xs mb-1">
                            <span className="text-slate-700">
                              {item.factor_name || item.name}
                            </span>
                            <span className="font-medium text-slate-900">
                              {Math.round((item.weight || 0) * 100)}%
                            </span>
                          </div>
                          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-500 rounded-full transition-all"
                              style={{
                                width: `${Math.round((item.weight || 0) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">
                    No criticality data available.
                  </p>
                )}
              </AccordionSection>

              {/* Governance */}
              <AccordionSection title="Governance" icon={<Shield size={16} />}>
                <div className="space-y-3">
                  <div className="bg-slate-50 rounded-lg p-3">
                    <div className="text-xs text-slate-500">Autonomy Mode</div>
                    <div className="text-sm font-medium text-slate-900 mt-0.5">
                      {template.industry_governance_profiles
                        ?.default_autonomy_mode || "Advisory"}
                    </div>
                  </div>
                  {details?.governance?.length > 0 ? (
                    <div className="space-y-2">
                      {details.governance.map(
                        (rule: Record<string, unknown>, i: number) => (
                          <div
                            key={i}
                            className="text-xs py-2 px-3 bg-slate-50 rounded-lg"
                          >
                            <div className="font-medium text-slate-700">
                              {rule.rule_name || rule.name}
                            </div>
                            {rule.description && (
                              <div className="text-slate-500 mt-0.5">
                                {rule.description}
                              </div>
                            )}
                            {rule.rule_type && (
                              <span className="inline-block mt-1 px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded text-[10px] uppercase">
                                {rule.rule_type}
                              </span>
                            )}
                          </div>
                        ),
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">
                      No governance rules available.
                    </p>
                  )}
                </div>
              </AccordionSection>

              {/* Work Taxonomy */}
              <AccordionSection
                title={`Work Taxonomy (${details?.workTypes?.length || 0})`}
                icon={<Wrench size={16} />}
              >
                {details?.workTypes?.length > 0 ? (
                  <div className="space-y-1.5">
                    {details.workTypes.map(
                      (wt: Record<string, unknown>, i: number) => (
                        <div
                          key={i}
                          className="flex items-center gap-3 text-xs py-2 px-3 bg-slate-50 rounded-lg"
                        >
                          <span className="flex-1 font-medium text-slate-700">
                            {wt.name}
                          </span>
                          {wt.default_sla_hours && (
                            <span className="flex items-center gap-1 text-slate-500">
                              <Clock size={11} />
                              {wt.default_sla_hours}h SLA
                            </span>
                          )}
                          {wt.requires_permit && (
                            <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded text-[10px]">
                              Permit
                            </span>
                          )}
                        </div>
                      ),
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">
                    No work type data available.
                  </p>
                )}
              </AccordionSection>

              {/* Failure Modes */}
              <AccordionSection
                title={`Failure Modes (${details?.failureModes?.length || 0})`}
                icon={<AlertTriangle size={16} />}
              >
                {details?.failureModes?.length > 0 ? (
                  <div className="space-y-1.5">
                    {details.failureModes.map(
                      (fm: Record<string, unknown>, i: number) => (
                        <div
                          key={i}
                          className="flex items-center gap-3 text-xs py-2 px-3 bg-slate-50 rounded-lg"
                        >
                          <div
                            className={`w-2 h-2 rounded-full ${severityColor(fm.severity)}`}
                          />
                          <span className="flex-1 text-slate-700">
                            {fm.name || fm.mode_name}
                          </span>
                          {fm.severity && (
                            <span className="text-slate-500">
                              Severity: {fm.severity}
                            </span>
                          )}
                        </div>
                      ),
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">
                    No failure mode data available.
                  </p>
                )}
              </AccordionSection>

              {/* OEE Model */}
              <AccordionSection title="OEE Model" icon={<Gauge size={16} />}>
                {details?.oee?.length > 0 ? (
                  <div className="space-y-3">
                    {details.oee.map(
                      (config: Record<string, unknown>, i: number) => (
                        <div key={i} className="space-y-2">
                          {config.availability_weight != null && (
                            <div>
                              <div className="flex items-center justify-between text-xs mb-1">
                                <span className="text-slate-600">
                                  Availability Weight
                                </span>
                                <span className="font-medium">
                                  {Math.round(config.availability_weight * 100)}
                                  %
                                </span>
                              </div>
                              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-green-500 rounded-full"
                                  style={{
                                    width: `${config.availability_weight * 100}%`,
                                  }}
                                />
                              </div>
                            </div>
                          )}
                          {config.performance_weight != null && (
                            <div>
                              <div className="flex items-center justify-between text-xs mb-1">
                                <span className="text-slate-600">
                                  Performance Weight
                                </span>
                                <span className="font-medium">
                                  {Math.round(config.performance_weight * 100)}%
                                </span>
                              </div>
                              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-blue-500 rounded-full"
                                  style={{
                                    width: `${config.performance_weight * 100}%`,
                                  }}
                                />
                              </div>
                            </div>
                          )}
                          {config.quality_weight != null && (
                            <div>
                              <div className="flex items-center justify-between text-xs mb-1">
                                <span className="text-slate-600">
                                  Quality Weight
                                </span>
                                <span className="font-medium">
                                  {Math.round(config.quality_weight * 100)}%
                                </span>
                              </div>
                              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-purple-500 rounded-full"
                                  style={{
                                    width: `${config.quality_weight * 100}%`,
                                  }}
                                />
                              </div>
                            </div>
                          )}
                          {config.target_oee != null && (
                            <div className="bg-slate-50 rounded-lg p-3 mt-2">
                              <div className="text-xs text-slate-500">
                                Target OEE
                              </div>
                              <div className="text-lg font-bold text-slate-900">
                                {Math.round(config.target_oee * 100)}%
                              </div>
                            </div>
                          )}
                          {config.loss_categories && (
                            <div className="mt-2">
                              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
                                Loss Categories
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {(Array.isArray(config.loss_categories)
                                  ? config.loss_categories
                                  : []
                                ).map((cat: string, j: number) => (
                                  <span
                                    key={j}
                                    className="text-xs px-2 py-1 bg-red-50 text-red-700 rounded-md"
                                  >
                                    {cat}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      ),
                    )}
                  </div>
                ) : (
                  <div className="bg-slate-50 rounded-lg p-3">
                    <div className="text-xs text-slate-500">Model</div>
                    <div className="text-sm font-medium text-slate-900 mt-0.5">
                      {template.industry_oee_models?.model_name || "Standard"}
                    </div>
                  </div>
                )}
              </AccordionSection>

              {/* Recommended Rollout */}
              <AccordionSection
                title={`Recommended Rollout (${details?.rollout?.length || 0} phases)`}
                icon={<Layers size={16} />}
              >
                {details?.rollout?.length > 0 ? (
                  <div className="space-y-3">
                    {details.rollout.map(
                      (phase: Record<string, unknown>, i: number) => (
                        <div key={i} className="relative pl-6">
                          <div className="absolute left-0 top-1.5 w-3 h-3 bg-blue-500 rounded-full border-2 border-white shadow" />
                          {i < details.rollout.length - 1 && (
                            <div className="absolute left-[5px] top-4 w-0.5 h-full bg-blue-200" />
                          )}
                          <div className="text-sm font-medium text-slate-900">
                            {phase.phase_name || phase.name}
                          </div>
                          {phase.description && (
                            <p className="text-xs text-slate-500 mt-0.5">
                              {phase.description}
                            </p>
                          )}
                          {phase.duration_weeks && (
                            <span className="inline-block mt-1 text-xs text-blue-600">
                              {phase.duration_weeks} weeks
                            </span>
                          )}
                        </div>
                      ),
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">
                    No rollout data available.
                  </p>
                )}
              </AccordionSection>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-slate-200 bg-white">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
          >
            Close
          </button>
          <button
            onClick={onSelect}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            Select Template
            <ArrowRight size={16} />
          </button>
        </div>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        .animate-slide-in-right {
          animation: slideInRight 0.25s ease-out;
        }
      `}</style>
    </div>
  );
}
