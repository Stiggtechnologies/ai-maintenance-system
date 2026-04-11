import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Factory,
  Flame,
  Cpu,
  Building2,
  Landmark,
  Eye,
  ArrowRight,
  BarChart3,
  Package,
  AlertTriangle,
  Shield,
  Gauge,
  Search,
  Filter,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { supabase } from "../lib/supabase";
import { TemplatePreviewModal } from "../components/TemplatePreviewModal";

interface TemplateData {
  id: string;
  name: string;
  slug: string;
  template_type: string;
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
}

const FAMILY_CONFIG: Record<
  string,
  { color: string; bg: string; border: string; badge: string; icon: LucideIcon }
> = {
  "Heavy Industrial": {
    color: "text-amber-700",
    bg: "bg-amber-50",
    border: "border-amber-200",
    badge: "bg-amber-100 text-amber-800",
    icon: Flame,
  },
  Process: {
    color: "text-blue-700",
    bg: "bg-blue-50",
    border: "border-blue-200",
    badge: "bg-blue-100 text-blue-800",
    icon: Cpu,
  },
  Manufacturing: {
    color: "text-green-700",
    bg: "bg-green-50",
    border: "border-green-200",
    badge: "bg-green-100 text-green-800",
    icon: Factory,
  },
  Infrastructure: {
    color: "text-purple-700",
    bg: "bg-purple-50",
    border: "border-purple-200",
    badge: "bg-purple-100 text-purple-800",
    icon: Landmark,
  },
};

const DEFAULT_FAMILY_CONFIG = {
  color: "text-slate-300",
  bg: "bg-[#0B0F14]",
  border: "border-[#232A33]",
  badge: "bg-[#1A2030] text-slate-800",
  icon: Building2,
};

function getFamilyConfig(family: string) {
  return FAMILY_CONFIG[family] || DEFAULT_FAMILY_CONFIG;
}

export function TemplateSelectorPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<TemplateData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterFamily, setFilterFamily] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<TemplateData | null>(
    null,
  );

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    setLoading(true);
    setError(null);

    try {
      // Try edge function first
      const { data: fnData, error: fnError } = await supabase.functions.invoke(
        "template-resolver",
        {
          body: { action: "list_templates" },
        },
      );

      if (!fnError && fnData?.templates) {
        setTemplates(fnData.templates);
        setLoading(false);
        return;
      }
    } catch {
      // Edge function not available, fall back to direct query
    }

    try {
      const { data, error: queryError } = await supabase
        .from("deployment_templates")
        .select(
          `
          *,
          kpi_packs(pack_name, kpi_count),
          industry_asset_libraries(library_name, asset_class_count),
          industry_criticality_profiles(profile_name),
          industry_governance_profiles(profile_name, default_autonomy_mode),
          industry_failure_mode_packs(pack_name, failure_mode_count),
          industry_oee_models(model_name)
        `,
        )
        .eq("is_active", true)
        .eq("template_type", "derived")
        .order("name");

      if (queryError) {
        setError("Failed to load templates. Please try again.");
        console.error("Template query error:", queryError);
      } else {
        setTemplates(data || []);
      }
    } catch (err) {
      setError("Failed to load templates. Please try again.");
      console.error("Template load error:", err);
    }

    setLoading(false);
  };

  const families = Array.from(
    new Set(templates.map((t) => t.master_family).filter(Boolean)),
  );

  const filteredTemplates = templates.filter((t) => {
    const matchesSearch =
      !searchQuery ||
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFamily = !filterFamily || t.master_family === filterFamily;
    return matchesSearch && matchesFamily;
  });

  const handleSelect = (template: TemplateData) => {
    navigate(`/deployments/new/configure?template=${template.slug}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Loading templates...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[#E6EDF3]">New Deployment</h1>
        <p className="text-sm text-slate-500 mt-1">
          Select an industry template to start configuring your deployment.
        </p>
      </div>

      {/* Search and Filter Bar */}
      <div className="flex items-center gap-4 mb-6">
        <div className="flex-1 relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-[#232A33] rounded-lg bg-[#11161D] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-slate-400" />
          <button
            onClick={() => setFilterFamily(null)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              !filterFamily
                ? "bg-slate-900 text-white"
                : "bg-[#11161D] text-slate-400 border border-[#232A33] hover:bg-[#0B0F14]"
            }`}
          >
            All
          </button>
          {families.map((family) => {
            const config = getFamilyConfig(family);
            return (
              <button
                key={family}
                onClick={() =>
                  setFilterFamily(filterFamily === family ? null : family)
                }
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  filterFamily === family
                    ? `${config.badge}`
                    : "bg-[#11161D] text-slate-400 border border-[#232A33] hover:bg-[#0B0F14]"
                }`}
              >
                {family}
              </button>
            );
          })}
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={loadTemplates}
            className="text-sm text-red-600 underline mt-1"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty State */}
      {!error && filteredTemplates.length === 0 && (
        <div className="bg-[#11161D] border border-[#232A33] rounded-xl p-12 text-center">
          <Factory size={40} className="text-slate-300 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-slate-300">
            No templates found
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            {searchQuery || filterFamily
              ? "Try adjusting your search or filters."
              : "No deployment templates are available yet."}
          </p>
        </div>
      )}

      {/* Template Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredTemplates.map((template) => {
          const config = getFamilyConfig(template.master_family);
          const FamilyIcon = config.icon;
          const kpiCount = template.kpi_packs?.kpi_count ?? 0;
          const assetCount =
            template.industry_asset_libraries?.asset_class_count ?? 0;
          const failureCount =
            template.industry_failure_mode_packs?.failure_mode_count ?? 0;
          const governanceProfile =
            template.industry_governance_profiles?.profile_name ?? "Standard";
          const oeeModel =
            template.industry_oee_models?.model_name ?? "Standard";
          const autonomyMode =
            template.industry_governance_profiles?.default_autonomy_mode ??
            "Advisory";

          return (
            <div
              key={template.id}
              className={`bg-[#11161D] border ${config.border} rounded-xl overflow-hidden hover:shadow-lg transition-shadow`}
            >
              {/* Card Header */}
              <div
                className={`${config.bg} px-5 py-4 border-b ${config.border}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-lg ${config.badge} flex items-center justify-center`}
                    >
                      <FamilyIcon size={20} />
                    </div>
                    <div>
                      <h3 className="font-semibold text-[#E6EDF3] text-sm">
                        {template.name}
                      </h3>
                      {template.master_template_name && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          Built on: {template.master_template_name}
                        </p>
                      )}
                    </div>
                  </div>
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded-full ${config.badge}`}
                  >
                    {template.master_family}
                  </span>
                </div>
              </div>

              {/* Card Body */}
              <div className="px-5 py-4">
                <p className="text-xs text-slate-400 leading-relaxed line-clamp-2 mb-4">
                  {template.description || "No description available."}
                </p>

                {/* Stats */}
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <BarChart3 size={13} className="text-slate-400" />
                    <span>{kpiCount} KPIs</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Package size={13} className="text-slate-400" />
                    <span>{assetCount} Asset Classes</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <AlertTriangle size={13} className="text-slate-400" />
                    <span>{failureCount} Failure Modes</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <Gauge size={13} className="text-slate-400" />
                    <span>{oeeModel}</span>
                  </div>
                </div>

                {/* Governance */}
                <div className="flex items-center gap-2 text-xs mb-4">
                  <Shield size={13} className="text-slate-400" />
                  <span className="text-slate-400">{governanceProfile}</span>
                  <span className="text-slate-300">|</span>
                  <span className="text-slate-500">{autonomyMode}</span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-3 border-t border-[#1A2030]">
                  <button
                    onClick={() => setPreviewTemplate(template)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-400 bg-[#0B0F14] hover:bg-[#1A2030] rounded-lg transition-colors"
                  >
                    <Eye size={14} />
                    Preview
                  </button>
                  <button
                    onClick={() => handleSelect(template)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                  >
                    Select
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Preview Modal */}
      {previewTemplate && (
        <TemplatePreviewModal
          template={previewTemplate}
          onClose={() => setPreviewTemplate(null)}
          onSelect={() => handleSelect(previewTemplate)}
        />
      )}
    </div>
  );
}
