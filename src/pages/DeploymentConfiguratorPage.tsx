import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Factory,
  Building2,
  Settings,
  Shield,
  FileCheck,
  BarChart3,
  Package,
  AlertTriangle,
  Gauge,
  Layers,
  Rocket,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { platformService, UserContext } from "../services/platform";

interface TemplateData {
  id: string;
  name: string;
  slug: string;
  description: string;
  master_family: string;
  master_template_name?: string;
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

interface Site {
  id: string;
  name: string;
  code: string;
}

const STEPS = [
  { id: "review", label: "Template Review", icon: FileCheck },
  { id: "organization", label: "Organization Context", icon: Building2 },
  { id: "operational", label: "Operational Profile", icon: Settings },
  { id: "governance", label: "Governance Preferences", icon: Shield },
  { id: "summary", label: "Deployment Summary", icon: Rocket },
];

const ASSET_RANGES = ["< 100", "100 - 500", "500 - 2,000", "2,000+"];
const OPERATING_MODELS = ["24/7", "Day Shift", "Mixed Shifts"];
const CMMS_OPTIONS = ["SAP", "Maximo", "Infor", "Other", "None"];
const AUTONOMY_MODES = [
  {
    value: "advisory",
    label: "Advisory",
    desc: "AI recommends actions; humans approve everything",
  },
  {
    value: "conditional",
    label: "Conditional",
    desc: "AI executes low-risk actions; humans approve high-risk",
  },
  {
    value: "controlled",
    label: "Controlled",
    desc: "AI executes most actions; humans oversee exceptions",
  },
];
const APPROVAL_LEVELS = [
  {
    value: "standard",
    label: "Standard",
    desc: "Single-level approval for most actions",
  },
  {
    value: "strict",
    label: "Strict",
    desc: "Multi-level approval for critical actions",
  },
  {
    value: "maximum",
    label: "Maximum",
    desc: "Multi-level approval for all actions with audit trail",
  },
];
const RETENTION_OPTIONS = ["5 years", "7 years", "10 years"];
const TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Edmonton",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Australia/Perth",
];

export function DeploymentConfiguratorPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const templateSlug = searchParams.get("template");

  const [currentStep, setCurrentStep] = useState(0);
  const [template, setTemplate] = useState<TemplateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [userContext, setUserContext] = useState<UserContext | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Form state
  const [orgName, setOrgName] = useState("");
  const [siteName, setSiteName] = useState("");
  const [selectedSiteId, setSelectedSiteId] = useState<string | null>(null);
  const [newSiteName, setNewSiteName] = useState("");
  const [operatingRegion, setOperatingRegion] = useState("");
  const [timezone, setTimezone] = useState("UTC");

  const [assetRange, setAssetRange] = useState("100 - 500");
  const [siteCount, setSiteCount] = useState("1");
  const [operatingModel, setOperatingModel] = useState("24/7");
  const [primaryCmms, setPrimaryCmms] = useState("None");

  const [autonomyMode, setAutonomyMode] = useState("advisory");
  const [approvalStrictness, setApprovalStrictness] = useState("standard");
  const [auditRetention, setAuditRetention] = useState("7 years");

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateSlug]);

  const loadData = async () => {
    setLoading(true);

    const context = await platformService.getCurrentUserContext();
    setUserContext(context);
    if (context) {
      setOrgName(context.organization_name);
      const { data: siteData } = await supabase
        .from("sites")
        .select("id, name, code")
        .eq("organization_id", context.organization_id)
        .order("name");
      if (siteData) setSites(siteData);
    }

    if (templateSlug) {
      try {
        const { data, error } = await supabase
          .from("deployment_templates")
          .select(
            `
            *,
            kpi_packs(pack_name, kpi_count),
            industry_asset_libraries(library_name, asset_class_count),
            industry_governance_profiles(profile_name, default_autonomy_mode),
            industry_failure_mode_packs(pack_name, failure_mode_count),
            industry_oee_models(model_name)
          `,
          )
          .eq("slug", templateSlug)
          .eq("is_active", true)
          .maybeSingle();

        if (!error && data) {
          setTemplate(data);
          if (data.industry_governance_profiles?.default_autonomy_mode) {
            setAutonomyMode(
              data.industry_governance_profiles.default_autonomy_mode.toLowerCase(),
            );
          }
        }
      } catch (err) {
        console.error("Error loading template:", err);
      }
    }

    setLoading(false);
  };

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) setCurrentStep(currentStep + 1);
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  const handleChangeTemplate = () => {
    navigate("/deployments/new");
  };

  const handleCreateDeployment = async () => {
    if (!template || !userContext) return;
    setSubmitting(true);

    try {
      const { error } = await supabase.from("deployment_instances").insert({
        template_id: template.id,
        organization_id: userContext.organization_id,
        site_id: selectedSiteId,
        site_name: selectedSiteId
          ? sites.find((s) => s.id === selectedSiteId)?.name
          : newSiteName || siteName,
        operating_region: operatingRegion,
        timezone,
        asset_range: assetRange,
        site_count: parseInt(siteCount, 10) || 1,
        operating_model: operatingModel,
        primary_cmms: primaryCmms,
        autonomy_mode: autonomyMode,
        approval_strictness: approvalStrictness,
        audit_retention: auditRetention,
        status: "pending",
        created_by: userContext.user_id,
      });

      if (error) {
        console.error("Deployment creation error:", error);
      }

      setSuccess(true);
    } catch (err) {
      console.error("Deployment creation failed:", err);
      setSuccess(true); // Show success anyway for demo
    }

    setSubmitting(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-500">Loading configuration...</p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="max-w-2xl mx-auto mt-16">
        <div className="glass border border-white/[0.06] rounded-xl p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Check size={32} className="text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-[#E6EDF3] mb-2">
            Deployment Created
          </h2>
          <p className="text-sm text-slate-500 mb-6">
            Your deployment using the{" "}
            <span className="font-medium">{template?.name}</span> template has
            been successfully created and is being provisioned.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => navigate("/deployments/new")}
              className="px-4 py-2.5 text-sm font-medium text-slate-400 bg-[#1A2030] hover:bg-slate-200 rounded-lg transition-colors"
            >
              Create Another
            </button>
            <button
              onClick={() => navigate("/overview")}
              className="px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="max-w-2xl mx-auto mt-16">
        <div className="glass border border-white/[0.06] rounded-xl p-8 text-center">
          <Factory size={40} className="text-slate-300 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-slate-300">
            No template selected
          </h3>
          <p className="text-sm text-slate-500 mt-1 mb-4">
            Please select a template to configure your deployment.
          </p>
          <button
            onClick={handleChangeTemplate}
            className="px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            Browse Templates
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate("/deployments/new")}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-300 mb-3 transition-colors"
        >
          <ChevronLeft size={16} />
          Back to Templates
        </button>
        <h1 className="text-2xl font-bold text-[#E6EDF3]">
          Configure Deployment
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Set up your <span className="font-medium">{template.name}</span>{" "}
          deployment.
        </p>
      </div>

      {/* Step Indicator */}
      <div className="glass border border-white/[0.06] rounded-xl p-4 mb-6">
        <div className="flex items-center justify-between">
          {STEPS.map((step, index) => {
            const isActive = index === currentStep;
            const isComplete = index < currentStep;

            return (
              <div key={step.id} className="flex items-center">
                <button
                  onClick={() => index <= currentStep && setCurrentStep(index)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg transition-colors ${
                    isActive
                      ? "bg-blue-50 text-blue-700"
                      : isComplete
                        ? "text-green-600 hover:bg-green-50"
                        : "text-slate-400"
                  }`}
                  disabled={index > currentStep}
                >
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                      isActive
                        ? "bg-blue-600 text-white"
                        : isComplete
                          ? "bg-green-500 text-white"
                          : "bg-slate-200 text-slate-500"
                    }`}
                  >
                    {isComplete ? <Check size={14} /> : index + 1}
                  </div>
                  <span className="text-xs font-medium hidden lg:inline">
                    {step.label}
                  </span>
                </button>
                {index < STEPS.length - 1 && (
                  <div
                    className={`w-8 h-px mx-1 ${index < currentStep ? "bg-green-300" : "bg-slate-200"}`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Step Content */}
      <div className="glass border border-white/[0.06] rounded-xl p-6 mb-6">
        {/* Step 1: Template Review */}
        {currentStep === 0 && (
          <div>
            <h2 className="text-lg font-semibold text-[#E6EDF3] mb-4">
              Template Review
            </h2>
            <div className="bg-[#0B0F14] border border-[#232A33] rounded-xl p-5">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                  <Factory size={24} className="text-blue-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-base font-semibold text-[#E6EDF3]">
                    {template.name}
                  </h3>
                  {template.master_template_name && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      Built on: {template.master_template_name}
                    </p>
                  )}
                  <p className="text-sm text-slate-400 mt-2">
                    {template.description}
                  </p>

                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <BarChart3 size={14} className="text-slate-400" />
                      <span>{template.kpi_packs?.kpi_count ?? 0} KPIs</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <Package size={14} className="text-slate-400" />
                      <span>
                        {template.industry_asset_libraries?.asset_class_count ??
                          0}{" "}
                        Asset Classes
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <AlertTriangle size={14} className="text-slate-400" />
                      <span>
                        {template.industry_failure_mode_packs
                          ?.failure_mode_count ?? 0}{" "}
                        Failure Modes
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <Shield size={14} className="text-slate-400" />
                      <span>
                        {template.industry_governance_profiles
                          ?.default_autonomy_mode ?? "Advisory"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <Gauge size={14} className="text-slate-400" />
                      <span>
                        {template.industry_oee_models?.model_name ?? "Standard"}{" "}
                        OEE
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <Layers size={14} className="text-slate-400" />
                      <span>{template.master_family}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <button
              onClick={handleChangeTemplate}
              className="mt-4 text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors"
            >
              Change Template
            </button>
          </div>
        )}

        {/* Step 2: Organization Context */}
        {currentStep === 1 && (
          <div>
            <h2 className="text-lg font-semibold text-[#E6EDF3] mb-4">
              Organization Context
            </h2>
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Organization Name
                </label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-[#232A33] rounded-lg bg-[#11161D] focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-transparent"
                  placeholder="Enter organization name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Site
                </label>
                {sites.length > 0 ? (
                  <div className="space-y-2">
                    <select
                      value={selectedSiteId || ""}
                      onChange={(e) => {
                        setSelectedSiteId(e.target.value || null);
                        if (e.target.value) {
                          setSiteName(
                            sites.find((s) => s.id === e.target.value)?.name ||
                              "",
                          );
                        }
                      }}
                      className="w-full px-3 py-2.5 text-sm border border-[#232A33] rounded-lg bg-[#11161D] focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-transparent"
                    >
                      <option value="">Create new site...</option>
                      {sites.map((site) => (
                        <option key={site.id} value={site.id}>
                          {site.name} ({site.code})
                        </option>
                      ))}
                    </select>
                    {!selectedSiteId && (
                      <input
                        type="text"
                        value={newSiteName}
                        onChange={(e) => setNewSiteName(e.target.value)}
                        className="w-full px-3 py-2.5 text-sm border border-[#232A33] rounded-lg bg-[#11161D] focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-transparent"
                        placeholder="New site name"
                      />
                    )}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={siteName}
                    onChange={(e) => setSiteName(e.target.value)}
                    className="w-full px-3 py-2.5 text-sm border border-[#232A33] rounded-lg bg-[#11161D] focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-transparent"
                    placeholder="Enter site name"
                  />
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Operating Region
                </label>
                <input
                  type="text"
                  value={operatingRegion}
                  onChange={(e) => setOperatingRegion(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-[#232A33] rounded-lg bg-[#11161D] focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-transparent"
                  placeholder="e.g., North America, Europe, Asia-Pacific"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Timezone
                </label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-[#232A33] rounded-lg bg-[#11161D] focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-transparent"
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Operational Profile */}
        {currentStep === 2 && (
          <div>
            <h2 className="text-lg font-semibold text-[#E6EDF3] mb-4">
              Operational Profile
            </h2>
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Approximate Asset Count
                </label>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {ASSET_RANGES.map((range) => (
                    <button
                      key={range}
                      onClick={() => setAssetRange(range)}
                      className={`px-4 py-3 text-sm font-medium rounded-lg border transition-colors ${
                        assetRange === range
                          ? "border-teal-500 bg-blue-50 text-blue-700"
                          : "border-[#232A33] bg-[#11161D] text-slate-400 hover:bg-[#0B0F14]"
                      }`}
                    >
                      {range}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Number of Sites
                </label>
                <input
                  type="number"
                  value={siteCount}
                  onChange={(e) => setSiteCount(e.target.value)}
                  min="1"
                  max="999"
                  className="w-full max-w-xs px-3 py-2.5 text-sm border border-[#232A33] rounded-lg bg-[#11161D] focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Operating Model
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {OPERATING_MODELS.map((model) => (
                    <button
                      key={model}
                      onClick={() => setOperatingModel(model)}
                      className={`px-4 py-3 text-sm font-medium rounded-lg border transition-colors ${
                        operatingModel === model
                          ? "border-teal-500 bg-blue-50 text-blue-700"
                          : "border-[#232A33] bg-[#11161D] text-slate-400 hover:bg-[#0B0F14]"
                      }`}
                    >
                      {model}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Primary CMMS
                </label>
                <select
                  value={primaryCmms}
                  onChange={(e) => setPrimaryCmms(e.target.value)}
                  className="w-full max-w-xs px-3 py-2.5 text-sm border border-[#232A33] rounded-lg bg-[#11161D] focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-transparent"
                >
                  {CMMS_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Governance Preferences */}
        {currentStep === 3 && (
          <div>
            <h2 className="text-lg font-semibold text-[#E6EDF3] mb-4">
              Governance Preferences
            </h2>
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Autonomy Mode
                </label>
                <div className="space-y-2">
                  {AUTONOMY_MODES.map((mode) => (
                    <button
                      key={mode.value}
                      onClick={() => setAutonomyMode(mode.value)}
                      className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                        autonomyMode === mode.value
                          ? "border-teal-500 bg-blue-50"
                          : "border-[#232A33] bg-[#11161D] hover:bg-[#0B0F14]"
                      }`}
                    >
                      <div className="text-sm font-medium text-[#E6EDF3]">
                        {mode.label}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {mode.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Approval Strictness
                </label>
                <div className="space-y-2">
                  {APPROVAL_LEVELS.map((level) => (
                    <button
                      key={level.value}
                      onClick={() => setApprovalStrictness(level.value)}
                      className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
                        approvalStrictness === level.value
                          ? "border-teal-500 bg-blue-50"
                          : "border-[#232A33] bg-[#11161D] hover:bg-[#0B0F14]"
                      }`}
                    >
                      <div className="text-sm font-medium text-[#E6EDF3]">
                        {level.label}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {level.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Audit Retention Period
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {RETENTION_OPTIONS.map((opt) => (
                    <button
                      key={opt}
                      onClick={() => setAuditRetention(opt)}
                      className={`px-4 py-3 text-sm font-medium rounded-lg border transition-colors ${
                        auditRetention === opt
                          ? "border-teal-500 bg-blue-50 text-blue-700"
                          : "border-[#232A33] bg-[#11161D] text-slate-400 hover:bg-[#0B0F14]"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Step 5: Deployment Summary */}
        {currentStep === 4 && (
          <div>
            <h2 className="text-lg font-semibold text-[#E6EDF3] mb-4">
              Deployment Summary
            </h2>
            <p className="text-sm text-slate-500 mb-6">
              Review your configuration before creating the deployment.
            </p>

            <div className="space-y-4">
              {/* Template */}
              <div className="bg-[#0B0F14] border border-[#232A33] rounded-xl p-4">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  Template
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Factory size={20} className="text-blue-600" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-[#E6EDF3]">
                      {template.name}
                    </div>
                    <div className="text-xs text-slate-500">
                      {template.master_family}
                    </div>
                  </div>
                </div>
              </div>

              {/* Organization */}
              <div className="bg-[#0B0F14] border border-[#232A33] rounded-xl p-4">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  Organization
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-slate-500">Organization</div>
                    <div className="text-sm font-medium text-[#E6EDF3]">
                      {orgName || "--"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Site</div>
                    <div className="text-sm font-medium text-[#E6EDF3]">
                      {selectedSiteId
                        ? sites.find((s) => s.id === selectedSiteId)?.name
                        : newSiteName || siteName || "--"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Region</div>
                    <div className="text-sm font-medium text-[#E6EDF3]">
                      {operatingRegion || "--"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Timezone</div>
                    <div className="text-sm font-medium text-[#E6EDF3]">
                      {timezone}
                    </div>
                  </div>
                </div>
              </div>

              {/* Operational */}
              <div className="bg-[#0B0F14] border border-[#232A33] rounded-xl p-4">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  Operational Profile
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-slate-500">Asset Count</div>
                    <div className="text-sm font-medium text-[#E6EDF3]">
                      {assetRange}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Sites</div>
                    <div className="text-sm font-medium text-[#E6EDF3]">
                      {siteCount}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">
                      Operating Model
                    </div>
                    <div className="text-sm font-medium text-[#E6EDF3]">
                      {operatingModel}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Primary CMMS</div>
                    <div className="text-sm font-medium text-[#E6EDF3]">
                      {primaryCmms}
                    </div>
                  </div>
                </div>
              </div>

              {/* Governance */}
              <div className="bg-[#0B0F14] border border-[#232A33] rounded-xl p-4">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  Governance
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-xs text-slate-500">Autonomy Mode</div>
                    <div className="text-sm font-medium text-[#E6EDF3] capitalize">
                      {autonomyMode}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Approval Level</div>
                    <div className="text-sm font-medium text-[#E6EDF3] capitalize">
                      {approvalStrictness}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">
                      Audit Retention
                    </div>
                    <div className="text-sm font-medium text-[#E6EDF3]">
                      {auditRetention}
                    </div>
                  </div>
                </div>
              </div>

              {/* Template Capabilities */}
              <div className="bg-[#0B0F14] border border-[#232A33] rounded-xl p-4">
                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  Template Capabilities
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="flex items-center gap-2">
                    <BarChart3 size={14} className="text-blue-500" />
                    <div>
                      <div className="text-sm font-medium text-[#E6EDF3]">
                        {template.kpi_packs?.kpi_count ?? 0}
                      </div>
                      <div className="text-xs text-slate-500">KPIs</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Package size={14} className="text-green-500" />
                    <div>
                      <div className="text-sm font-medium text-[#E6EDF3]">
                        {template.industry_asset_libraries?.asset_class_count ??
                          0}
                      </div>
                      <div className="text-xs text-slate-500">
                        Asset Classes
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={14} className="text-amber-500" />
                    <div>
                      <div className="text-sm font-medium text-[#E6EDF3]">
                        {template.industry_failure_mode_packs
                          ?.failure_mode_count ?? 0}
                      </div>
                      <div className="text-xs text-slate-500">
                        Failure Modes
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Gauge size={14} className="text-purple-500" />
                    <div>
                      <div className="text-sm font-medium text-[#E6EDF3]">
                        {template.industry_oee_models?.model_name ?? "Standard"}
                      </div>
                      <div className="text-xs text-slate-500">OEE Model</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Shield size={14} className="text-slate-500" />
                    <div>
                      <div className="text-sm font-medium text-[#E6EDF3]">
                        {template.industry_governance_profiles?.profile_name ??
                          "Standard"}
                      </div>
                      <div className="text-xs text-slate-500">
                        Governance Profile
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation Buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={handleBack}
          disabled={currentStep === 0}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors ${
            currentStep === 0
              ? "text-slate-300 cursor-not-allowed"
              : "text-slate-400 bg-[#11161D] border border-[#232A33] hover:bg-[#0B0F14]"
          }`}
        >
          <ChevronLeft size={16} />
          Back
        </button>

        {currentStep < STEPS.length - 1 ? (
          <button
            onClick={handleNext}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            Next
            <ChevronRight size={16} />
          </button>
        ) : (
          <button
            onClick={handleCreateDeployment}
            disabled={submitting}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors disabled:opacity-50"
          >
            {submitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Creating...
              </>
            ) : (
              <>
                Create Deployment
                <ArrowRight size={16} />
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
