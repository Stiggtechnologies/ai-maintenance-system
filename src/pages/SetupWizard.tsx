import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Factory,
  Upload,
  Database,
  Zap,
  ChevronRight,
  ChevronLeft,
  Globe,
  FileText,
  Plug,
  Target,
  Sparkles,
  ArrowRight,
  Shield,
  Package,
  Eye,
  CircleCheck as CheckCircle,
  ChartBar as BarChart3,
  TriangleAlert as AlertTriangle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "../lib/supabase";
import { useSetupStore, INDUSTRY_TEMPLATE_MAP } from "../store/setupStore";

interface IndustryOption {
  id: string;
  label: string;
  icon: React.ElementType;
  description: string;
}

interface TemplateData {
  id: string;
  name: string;
  slug: string;
  description: string;
  master_family: string;
  kpi_packs?: { pack_name: string; kpi_count: number } | null;
  industry_asset_libraries?: {
    library_name: string;
    asset_class_count: number;
  } | null;
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

const industries: IndustryOption[] = [
  {
    id: "oil-sands",
    label: "Oil Sands",
    icon: Factory,
    description: "Bitumen extraction, upgrading, SAGD",
  },
  {
    id: "mining",
    label: "Mining",
    icon: Factory,
    description: "Open pit, underground, processing",
  },
  {
    id: "oil-gas",
    label: "Oil & Gas",
    icon: Factory,
    description: "Upstream, midstream, downstream",
  },
  {
    id: "power",
    label: "Power Generation",
    icon: Zap,
    description: "Thermal, hydro, wind, solar",
  },
  {
    id: "utilities",
    label: "Utilities",
    icon: Globe,
    description: "Water, wastewater, gas distribution",
  },
  {
    id: "manufacturing",
    label: "Manufacturing",
    icon: Factory,
    description: "Discrete and process manufacturing",
  },
  {
    id: "pharma",
    label: "Pharmaceuticals",
    icon: FileText,
    description: "GMP-regulated production",
  },
  {
    id: "aviation",
    label: "Aviation",
    icon: Globe,
    description: "Fleet maintenance, MRO operations",
  },
  {
    id: "marine",
    label: "Marine",
    icon: Globe,
    description: "Vessel maintenance, port operations",
  },
  {
    id: "data-centers",
    label: "Data Centers",
    icon: Database,
    description: "Critical infrastructure, cooling",
  },
  {
    id: "military",
    label: "Military / Mission-Critical",
    icon: Target,
    description: "Defense systems, readiness",
  },
  {
    id: "aerospace",
    label: "Aerospace / Launch",
    icon: Target,
    description: "Launch systems, satellite ops",
  },
];

const useCases = [
  {
    id: "uptime",
    label: "Maximize asset availability and production uptime",
    icon: Zap,
  },
  {
    id: "downtime",
    label: "Reduce unplanned downtime and emergency work",
    icon: AlertTriangle,
  },
  {
    id: "cost",
    label: "Optimize maintenance cost and workforce productivity",
    icon: BarChart3,
  },
  {
    id: "reliability",
    label: "Improve reliability and eliminate bad actors",
    icon: Target,
  },
  {
    id: "readiness",
    label: "Mission readiness and go/no-go assurance",
    icon: Shield,
  },
  {
    id: "compliance",
    label: "Regulatory compliance and audit readiness",
    icon: FileText,
  },
  { id: "shutdown", label: "Shutdown and turnaround readiness", icon: Factory },
  { id: "safety", label: "Safety-critical asset management", icon: Shield },
];

const connectors = [
  { id: "sap", name: "SAP PM / EAM", status: "available" },
  { id: "maximo", name: "IBM Maximo", status: "available" },
  { id: "pi", name: "OSIsoft PI / AVEVA", status: "available" },
  { id: "honeywell", name: "Honeywell", status: "available" },
  { id: "servicenow", name: "ServiceNow", status: "available" },
  { id: "oracle", name: "Oracle EAM", status: "available" },
  { id: "csv", name: "CSV / Excel Upload", status: "available" },
  { id: "api", name: "REST API", status: "available" },
];

const steps = [
  {
    id: 1,
    title: "Select Industry",
    description: "Choose your industry for optimized AI models",
  },
  {
    id: 2,
    title: "Primary Objective",
    description: "Define your operational mission",
  },
  {
    id: 3,
    title: "Select Template",
    description: "AI recommends the best-fit deployment template",
  },
  {
    id: 4,
    title: "Data Sources",
    description: "Upload assets or connect source systems",
  },
  {
    id: 5,
    title: "Connect Systems",
    description: "Link CMMS, ERP, and historian",
  },
  { id: 6, title: "Launch", description: "Deploy your AI department" },
];

export function SetupWizard() {
  const navigate = useNavigate();
  const {
    industry,
    useCase,
    templateSlug,
    setIndustry,
    setUseCase,
    setTemplate,
  } = useSetupStore();

  const [currentStep, setCurrentStep] = useState(1);
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(
    industry,
  );
  const [selectedUseCase, setSelectedUseCase] = useState<string | null>(
    useCase,
  );
  const [templates, setTemplates] = useState<TemplateData[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(
    templateSlug,
  );
  const [deploying, setDeploying] = useState(false);

  useEffect(() => {
    if (currentStep === 3 && selectedIndustry) {
      loadTemplatesForIndustry(selectedIndustry);
    }
  }, [currentStep, selectedIndustry]);

  const loadTemplatesForIndustry = async (industryId: string) => {
    setLoadingTemplates(true);
    const familySlugs = INDUSTRY_TEMPLATE_MAP[industryId] || [];

    try {
      const { data } = await supabase
        .from("deployment_templates")
        .select(
          `*, kpi_packs(pack_name, kpi_count), industry_asset_libraries(library_name, asset_class_count), industry_governance_profiles(profile_name, default_autonomy_mode), industry_failure_mode_packs(pack_name, failure_mode_count), industry_oee_models(model_name)`,
        )
        .eq("is_active", true)
        .eq("template_type", "derived")
        .order("name");

      if (data && data.length > 0) {
        const filtered = data.filter((t) =>
          familySlugs.some(
            (slug) =>
              t.slug?.includes(slug) ||
              t.master_family?.toLowerCase().includes(slug.replace("-", " ")),
          ),
        );
        setTemplates(filtered.length > 0 ? filtered : data);
      }
    } catch {
      /* ignore */
    }

    setLoadingTemplates(false);
  };

  const handleIndustrySelect = (id: string) => {
    setSelectedIndustry(id);
    setIndustry(id);
  };

  const handleUseCaseSelect = (id: string) => {
    setSelectedUseCase(id);
    setUseCase(id);
  };

  const handleTemplateSelect = (template: TemplateData) => {
    setSelectedTemplate(template.slug);
    setTemplate(template.slug, template.name);
  };

  const handleDeploy = () => {
    setDeploying(true);
    setTimeout(() => {
      if (selectedTemplate) {
        navigate(`/deployments/new/configure?template=${selectedTemplate}`);
      } else {
        navigate("/mission-control");
      }
    }, 2400);
  };

  const canProceed =
    currentStep === 1
      ? !!selectedIndustry
      : currentStep === 2
        ? !!selectedUseCase
        : currentStep === 3
          ? !!selectedTemplate
          : true;

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Deploy Your AI Department
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          SyncAI configures a best-in-class maintenance and reliability
          organization in minutes
        </p>
      </div>

      {/* Progress */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          {steps.map((step, i) => (
            <div key={step.id} className="flex items-center flex-shrink-0">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  currentStep > step.id
                    ? "bg-teal-500/20 text-teal-400"
                    : currentStep === step.id
                      ? "bg-teal-500/30 text-teal-400 ring-2 ring-teal-500/40"
                      : "bg-white/[0.05] text-slate-400"
                }`}
              >
                {currentStep > step.id ? (
                  <CheckCircle className="w-3.5 h-3.5" />
                ) : (
                  step.id
                )}
              </div>
              {i < steps.length - 1 && (
                <div
                  className={`w-8 h-0.5 mx-0.5 rounded-full ${currentStep > step.id ? "bg-teal-500/40" : "bg-white/[0.05]"}`}
                />
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 text-center">
          <div className="text-xs font-semibold text-teal-400">
            Step {currentStep} of {steps.length}
          </div>
          <div className="text-sm font-bold text-white mt-0.5">
            {steps[currentStep - 1].title}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">
            {steps[currentStep - 1].description}
          </div>
        </div>
      </div>

      {/* Step Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentStep}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
        >
          {/* Step 1: Industry */}
          {currentStep === 1 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {industries.map((ind) => {
                const Icon = ind.icon;
                const isSelected = selectedIndustry === ind.id;
                return (
                  <button
                    key={ind.id}
                    onClick={() => handleIndustrySelect(ind.id)}
                    className={`p-4 rounded-xl border text-left transition-all ${
                      isSelected
                        ? "bg-teal-500/10 border-teal-500/30 ring-1 ring-teal-500/20"
                        : "bg-[#0D1520] border-white/[0.06] hover:border-white/[0.12]"
                    }`}
                  >
                    <Icon
                      className={`w-5 h-5 mb-2 ${isSelected ? "text-teal-400" : "text-slate-400"}`}
                    />
                    <div
                      className={`text-sm font-medium ${isSelected ? "text-teal-400" : "text-slate-300"}`}
                    >
                      {ind.label}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 leading-tight">
                      {ind.description}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Step 2: Use Case */}
          {currentStep === 2 && (
            <div className="space-y-2">
              {useCases.map((uc) => {
                const Icon = uc.icon;
                const isSelected = selectedUseCase === uc.id;
                return (
                  <button
                    key={uc.id}
                    onClick={() => handleUseCaseSelect(uc.id)}
                    className={`w-full flex items-center gap-3 text-left px-4 py-3 rounded-xl border transition-all text-sm ${
                      isSelected
                        ? "bg-teal-500/10 border-teal-500/30 text-teal-400"
                        : "bg-[#0D1520] border-white/[0.06] text-slate-300 hover:border-white/[0.12]"
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 flex-shrink-0 ${isSelected ? "text-teal-400" : "text-slate-400"}`}
                    />
                    {uc.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Step 3: Template Selection */}
          {currentStep === 3 && (
            <div className="space-y-4">
              <div className="bg-teal-500/5 border border-teal-500/20 rounded-xl p-4 flex items-start gap-3">
                <Sparkles className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-teal-400">
                    AI-Recommended Templates
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Based on your industry (
                    {industries.find((i) => i.id === selectedIndustry)?.label})
                    and objective, these templates are pre-configured with the
                    right KPIs, failure modes, and governance models.
                  </p>
                </div>
              </div>

              {loadingTemplates ? (
                <div className="flex items-center justify-center py-12">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
                    <p className="text-xs text-slate-400">
                      Loading templates for your industry...
                    </p>
                  </div>
                </div>
              ) : templates.length === 0 ? (
                <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-8 text-center">
                  <Package className="w-8 h-8 text-slate-400 mx-auto mb-3" />
                  <div className="text-sm text-slate-400">
                    No templates available yet for this industry.
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    You can proceed to configure manually, or select a different
                    industry.
                  </p>
                  <button
                    onClick={() => setCurrentStep(1)}
                    className="mt-4 text-xs text-teal-400 hover:text-teal-300 font-medium"
                  >
                    Change Industry
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {templates.map((template) => {
                    const isSelected = selectedTemplate === template.slug;
                    return (
                      <button
                        key={template.id}
                        onClick={() => handleTemplateSelect(template)}
                        className={`text-left p-4 rounded-xl border transition-all ${
                          isSelected
                            ? "bg-teal-500/10 border-teal-500/30 ring-1 ring-teal-500/20"
                            : "bg-[#0D1520] border-white/[0.06] hover:border-white/[0.12]"
                        }`}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <Factory
                              className={`w-4 h-4 ${isSelected ? "text-teal-400" : "text-slate-400"}`}
                            />
                            <span
                              className={`text-sm font-semibold ${isSelected ? "text-teal-400" : "text-white"}`}
                            >
                              {template.name}
                            </span>
                          </div>
                          {isSelected && (
                            <CheckCircle className="w-4 h-4 text-teal-400" />
                          )}
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed mb-3 line-clamp-2">
                          {template.description ||
                            "Industry-specific deployment template"}
                        </p>
                        <div className="grid grid-cols-2 gap-1.5 text-xs">
                          <div className="flex items-center gap-1 text-slate-400">
                            <BarChart3 className="w-3 h-3" />
                            {template.kpi_packs?.kpi_count ?? 0} KPIs
                          </div>
                          <div className="flex items-center gap-1 text-slate-400">
                            <Package className="w-3 h-3" />
                            {template.industry_asset_libraries
                              ?.asset_class_count ?? 0}{" "}
                            Asset Classes
                          </div>
                          <div className="flex items-center gap-1 text-slate-400">
                            <AlertTriangle className="w-3 h-3" />
                            {template.industry_failure_mode_packs
                              ?.failure_mode_count ?? 0}{" "}
                            Failure Modes
                          </div>
                          <div className="flex items-center gap-1 text-slate-400">
                            <Shield className="w-3 h-3" />
                            {template.industry_governance_profiles
                              ?.default_autonomy_mode ?? "Advisory"}
                          </div>
                        </div>
                        {template.master_family && (
                          <div className="mt-2 text-xs text-slate-400">
                            Family: {template.master_family}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="text-center pt-2">
                <button
                  onClick={() => navigate("/deployments/new")}
                  className="text-xs text-slate-400 hover:text-teal-400 transition-colors flex items-center gap-1 mx-auto"
                >
                  <Eye className="w-3 h-3" />
                  Browse all templates
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Data Sources */}
          {currentStep === 4 && (
            <div className="space-y-4">
              <div className="bg-[#0D1520] border-2 border-dashed border-white/[0.1] rounded-2xl p-10 text-center">
                <Upload className="w-10 h-10 text-slate-400 mx-auto mb-4" />
                <div className="text-sm font-semibold text-slate-300 mb-1">
                  Upload Asset Data
                </div>
                <p className="text-xs text-slate-400 mb-4">
                  CSV, Excel, or JSON with asset hierarchy, work orders, or
                  failure history
                </p>
                <button className="px-4 py-2 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-xs font-medium rounded-lg hover:bg-teal-500/30 transition-colors">
                  Browse Files
                </button>
                <div className="text-xs text-slate-400 mt-3">
                  Or drag and drop files here
                </div>
              </div>
              <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-3 flex items-center gap-3">
                <Sparkles className="w-4 h-4 text-teal-400 flex-shrink-0" />
                <p className="text-xs text-slate-400">
                  SyncAI auto-detects your file format, maps columns to the
                  asset hierarchy, and begins building reliability models
                  immediately.
                </p>
              </div>
            </div>
          )}

          {/* Step 5: Connect Systems */}
          {currentStep === 5 && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {connectors.map((conn) => (
                  <button
                    key={conn.id}
                    className="flex items-center gap-3 p-4 bg-[#0D1520] border border-white/[0.06] rounded-xl hover:border-teal-500/30 transition-colors text-left group"
                  >
                    <Plug className="w-5 h-5 text-slate-400 group-hover:text-teal-400 transition-colors" />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-slate-200">
                        {conn.name}
                      </div>
                      <div className="text-xs text-teal-400">Available</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-teal-400 transition-colors" />
                  </button>
                ))}
              </div>
              <div className="bg-[#0D1520] border border-white/[0.06] rounded-xl p-3 flex items-center gap-3">
                <Sparkles className="w-4 h-4 text-teal-400 flex-shrink-0" />
                <p className="text-xs text-slate-400">
                  You can skip this step and connect systems later from
                  Settings. SyncAI works with uploaded data immediately.
                </p>
              </div>
            </div>
          )}

          {/* Step 6: Launch */}
          {currentStep === 6 && !deploying && (
            <div className="bg-[#0D1520] border border-teal-500/20 rounded-2xl p-8 text-center">
              <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-teal-500/10 border border-teal-500/20 flex items-center justify-center">
                <Zap className="w-7 h-7 text-teal-400" />
              </div>
              <div className="text-lg font-bold text-white mb-2">
                Ready to Deploy
              </div>
              <p className="text-sm text-slate-400 mb-6 max-w-md mx-auto">
                SyncAI will generate your command center with industry-specific
                KPIs, AI agents, and governance models.
              </p>

              <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto mb-6">
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="text-xs font-bold text-teal-400">
                    {industries.find((i) => i.id === selectedIndustry)?.label ||
                      "—"}
                  </div>
                  <div className="text-xs text-slate-400">Industry</div>
                </div>
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="text-xs font-bold text-teal-400 truncate">
                    {useSetupStore.getState().templateName || "Custom"}
                  </div>
                  <div className="text-xs text-slate-400">Template</div>
                </div>
                <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                  <div className="text-xs font-bold text-teal-400">
                    Human-in-Loop
                  </div>
                  <div className="text-xs text-slate-400">Governance</div>
                </div>
              </div>

              <button
                onClick={handleDeploy}
                className="px-6 py-3 bg-teal-500/20 border border-teal-500/30 text-teal-400 font-semibold rounded-xl hover:bg-teal-500/30 transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center gap-2 mx-auto"
              >
                Deploy AI Department
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {currentStep === 6 && deploying && (
            <div className="bg-[#0D1520] border border-teal-500/20 rounded-2xl p-8 text-center">
              <div className="w-14 h-14 mx-auto mb-5 rounded-full bg-teal-500/20 flex items-center justify-center animate-pulse">
                <Zap className="w-7 h-7 text-teal-400" />
              </div>
              <div className="text-lg font-bold text-white mb-2">
                Deploying Your AI Department
              </div>
              <p className="text-xs text-slate-400 mb-6">
                Setting up your command center...
              </p>
              <div className="space-y-2 text-xs text-slate-400 max-w-xs mx-auto text-left">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0 }}
                  className="flex items-center gap-2"
                >
                  <CheckCircle className="w-3.5 h-3.5 text-teal-400" /> Industry
                  model loaded
                </motion.div>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  className="flex items-center gap-2"
                >
                  <CheckCircle className="w-3.5 h-3.5 text-teal-400" /> Template
                  resolved
                </motion.div>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.8 }}
                  className="flex items-center gap-2"
                >
                  <CheckCircle className="w-3.5 h-3.5 text-teal-400" /> KPIs
                  configured
                </motion.div>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 1.2 }}
                  className="flex items-center gap-2"
                >
                  <CheckCircle className="w-3.5 h-3.5 text-teal-400" /> AI
                  agents assigned
                </motion.div>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 1.6 }}
                  className="flex items-center gap-2"
                >
                  <CheckCircle className="w-3.5 h-3.5 text-teal-400" />{" "}
                  Governance rules applied
                </motion.div>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 2.0 }}
                  className="flex items-center gap-2"
                >
                  <Zap className="w-3.5 h-3.5 text-teal-400 animate-pulse" />{" "}
                  Launching command center...
                </motion.div>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      {!deploying && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
            disabled={currentStep === 1}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
              currentStep === 1
                ? "text-slate-400 cursor-not-allowed"
                : "text-slate-400 hover:text-white bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08]"
            }`}
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Back
          </button>

          {currentStep < 6 && (
            <button
              onClick={() => setCurrentStep(currentStep + 1)}
              disabled={!canProceed && currentStep <= 3}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
                canProceed || currentStep > 3
                  ? "bg-teal-500/20 border border-teal-500/30 text-teal-400 hover:bg-teal-500/30"
                  : "bg-white/[0.04] border border-white/[0.06] text-slate-400 cursor-not-allowed"
              }`}
            >
              {currentStep >= 4 ? "Skip" : "Next"}{" "}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
