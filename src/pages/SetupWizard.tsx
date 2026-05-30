import { useState } from "react";
import { Factory, Upload, Database, Layers, Zap, CircleCheck as CheckCircle, ChevronRight, ChevronLeft, Globe, FileText, Plug, Target } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const industries = [
  { id: "oil-sands", label: "Oil Sands", icon: Factory },
  { id: "mining", label: "Mining", icon: Factory },
  { id: "oil-gas", label: "Oil & Gas", icon: Factory },
  { id: "power", label: "Power Generation", icon: Zap },
  { id: "utilities", label: "Utilities", icon: Globe },
  { id: "manufacturing", label: "Manufacturing", icon: Factory },
  { id: "pharma", label: "Pharmaceuticals", icon: FileText },
  { id: "aviation", label: "Aviation", icon: Globe },
  { id: "marine", label: "Marine", icon: Globe },
  { id: "data-centers", label: "Data Centers", icon: Database },
  { id: "military", label: "Military / Mission-Critical", icon: Target },
  { id: "aerospace", label: "Aerospace / Launch", icon: Target },
];

const steps = [
  { id: 1, title: "Select Industry", description: "Choose your industry for optimized AI models" },
  { id: 2, title: "Mission & Use Case", description: "Define your primary operational objective" },
  { id: 3, title: "Upload Asset List", description: "Import your asset hierarchy" },
  { id: 4, title: "Work Order History", description: "Upload historical work orders" },
  { id: 5, title: "Failure History", description: "Import failure and downtime records" },
  { id: 6, title: "Connect Systems", description: "Link CMMS, ERP, and historian" },
  { id: 7, title: "Confirm Hierarchy", description: "Verify asset structure" },
  { id: 8, title: "Generate Command Center", description: "AI builds your workspace" },
  { id: 9, title: "First Recommendations", description: "AI generates initial insights" },
];

const useCases = [
  "Maximize asset availability and production uptime",
  "Reduce unplanned downtime and emergency work",
  "Optimize maintenance cost and workforce productivity",
  "Improve reliability and eliminate bad actors",
  "Mission readiness and go/no-go assurance",
  "Regulatory compliance and audit readiness",
  "Shutdown and turnaround readiness",
  "Safety-critical asset management",
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

export function SetupWizard() {
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
  const [selectedUseCase, setSelectedUseCase] = useState<string | null>(null);

  const canProceed = currentStep === 1 ? !!selectedIndustry : currentStep === 2 ? !!selectedUseCase : true;

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-white tracking-tight">Deploy Your AI Department</h1>
        <p className="text-sm text-slate-500 mt-1">SyncAI configures a best-in-class maintenance and reliability organization in minutes</p>
      </div>

      {/* Progress */}
      <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-5">
        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          {steps.map((step, i) => (
            <div key={step.id} className="flex items-center flex-shrink-0">
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold transition-all ${
                currentStep > step.id ? "bg-teal-500/20 text-teal-400" :
                currentStep === step.id ? "bg-teal-500/30 text-teal-400 ring-2 ring-teal-500/40" :
                "bg-white/[0.05] text-slate-600"
              }`}>
                {currentStep > step.id ? <CheckCircle className="w-3.5 h-3.5" /> : step.id}
              </div>
              {i < steps.length - 1 && (
                <div className={`w-6 h-0.5 mx-0.5 rounded-full ${currentStep > step.id ? "bg-teal-500/40" : "bg-white/[0.05]"}`} />
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 text-center">
          <div className="text-xs font-semibold text-teal-400">Step {currentStep} of {steps.length}</div>
          <div className="text-sm font-bold text-white mt-0.5">{steps[currentStep - 1].title}</div>
          <div className="text-xs text-slate-500 mt-0.5">{steps[currentStep - 1].description}</div>
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
          {currentStep === 1 && (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {industries.map((ind) => {
                const Icon = ind.icon;
                return (
                  <button
                    key={ind.id}
                    onClick={() => setSelectedIndustry(ind.id)}
                    className={`p-4 rounded-xl border text-left transition-all ${
                      selectedIndustry === ind.id
                        ? "bg-teal-500/10 border-teal-500/30 ring-1 ring-teal-500/20"
                        : "bg-[#0D1520] border-white/[0.06] hover:border-white/[0.12]"
                    }`}
                  >
                    <Icon className={`w-5 h-5 mb-2 ${selectedIndustry === ind.id ? "text-teal-400" : "text-slate-500"}`} />
                    <div className={`text-sm font-medium ${selectedIndustry === ind.id ? "text-teal-400" : "text-slate-300"}`}>{ind.label}</div>
                  </button>
                );
              })}
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-2">
              {useCases.map((uc) => (
                <button
                  key={uc}
                  onClick={() => setSelectedUseCase(uc)}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-all text-sm ${
                    selectedUseCase === uc
                      ? "bg-teal-500/10 border-teal-500/30 text-teal-400"
                      : "bg-[#0D1520] border-white/[0.06] text-slate-300 hover:border-white/[0.12]"
                  }`}
                >
                  {uc}
                </button>
              ))}
            </div>
          )}

          {currentStep === 3 && (
            <div className="bg-[#0D1520] border-2 border-dashed border-white/[0.1] rounded-2xl p-12 text-center">
              <Upload className="w-10 h-10 text-slate-600 mx-auto mb-4" />
              <div className="text-sm font-semibold text-slate-300 mb-1">Upload Asset List</div>
              <p className="text-xs text-slate-500 mb-4">CSV, Excel, or JSON with asset hierarchy</p>
              <button className="px-4 py-2 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-xs font-medium rounded-lg hover:bg-teal-500/30 transition-colors">
                Browse Files
              </button>
              <div className="text-[10px] text-slate-600 mt-3">Or drag and drop files here</div>
            </div>
          )}

          {currentStep === 4 && (
            <div className="bg-[#0D1520] border-2 border-dashed border-white/[0.1] rounded-2xl p-12 text-center">
              <FileText className="w-10 h-10 text-slate-600 mx-auto mb-4" />
              <div className="text-sm font-semibold text-slate-300 mb-1">Upload Work Order History</div>
              <p className="text-xs text-slate-500 mb-4">Historical work orders for AI training (recommended: 2+ years)</p>
              <button className="px-4 py-2 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-xs font-medium rounded-lg hover:bg-teal-500/30 transition-colors">
                Browse Files
              </button>
              <div className="text-[10px] text-slate-600 mt-3">Supports SAP, Maximo, CSV exports</div>
            </div>
          )}

          {currentStep === 5 && (
            <div className="bg-[#0D1520] border-2 border-dashed border-white/[0.1] rounded-2xl p-12 text-center">
              <Database className="w-10 h-10 text-slate-600 mx-auto mb-4" />
              <div className="text-sm font-semibold text-slate-300 mb-1">Upload Failure History</div>
              <p className="text-xs text-slate-500 mb-4">Failure records, downtime events, and RCA reports</p>
              <button className="px-4 py-2 bg-teal-500/20 border border-teal-500/30 text-teal-400 text-xs font-medium rounded-lg hover:bg-teal-500/30 transition-colors">
                Browse Files
              </button>
            </div>
          )}

          {currentStep === 6 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {connectors.map((conn) => (
                <button key={conn.id} className="flex items-center gap-3 p-4 bg-[#0D1520] border border-white/[0.06] rounded-xl hover:border-teal-500/30 transition-colors text-left">
                  <Plug className="w-5 h-5 text-slate-500" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-200">{conn.name}</div>
                    <div className="text-[10px] text-teal-400">Available</div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-600" />
                </button>
              ))}
            </div>
          )}

          {currentStep === 7 && (
            <div className="bg-[#0D1520] border border-white/[0.06] rounded-2xl p-6 text-center">
              <Layers className="w-10 h-10 text-teal-400 mx-auto mb-4" />
              <div className="text-sm font-semibold text-white mb-2">Asset Hierarchy Confirmed</div>
              <p className="text-xs text-slate-400 mb-4">SyncAI has mapped your assets into the standard hierarchy</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-center">
                {[{ label: "Sites", value: "2" }, { label: "Areas", value: "8" }, { label: "Systems", value: "34" }, { label: "Assets", value: "247" }].map(s => (
                  <div key={s.label} className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.05]">
                    <div className="text-xl font-black text-teal-400">{s.value}</div>
                    <div className="text-[10px] text-slate-500">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {currentStep === 8 && (
            <div className="bg-[#0D1520] border border-teal-500/20 rounded-2xl p-6 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-teal-500/20 flex items-center justify-center animate-pulse">
                <Zap className="w-6 h-6 text-teal-400" />
              </div>
              <div className="text-sm font-bold text-white mb-2">Generating Your Command Center</div>
              <p className="text-xs text-slate-400 mb-4">SyncAI is analyzing your data and building a customized workspace...</p>
              <div className="space-y-2 text-xs text-slate-500 max-w-xs mx-auto text-left">
                <div className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-teal-400" /> Industry model selected</div>
                <div className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-teal-400" /> Asset hierarchy mapped</div>
                <div className="flex items-center gap-2"><CheckCircle className="w-3 h-3 text-teal-400" /> KPIs configured</div>
                <div className="flex items-center gap-2"><Zap className="w-3 h-3 text-teal-400 animate-pulse" /> Generating recommendations...</div>
              </div>
            </div>
          )}

          {currentStep === 9 && (
            <div className="bg-[#0D1520] border border-teal-500/20 rounded-2xl p-6 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
                <CheckCircle className="w-6 h-6 text-green-400" />
              </div>
              <div className="text-lg font-bold text-white mb-2">Your AI Department is Ready</div>
              <p className="text-xs text-slate-400 mb-4">SyncAI has generated your first command center and initial recommendations</p>
              <button className="px-6 py-3 bg-teal-500/20 border border-teal-500/30 text-teal-400 font-medium rounded-xl hover:bg-teal-500/30 transition-colors">
                Enter Mission Control
              </button>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCurrentStep(Math.max(1, currentStep - 1))}
          disabled={currentStep === 1}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
            currentStep === 1 ? "text-slate-700 cursor-not-allowed" : "text-slate-400 hover:text-white bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.08]"
          }`}
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Back
        </button>
        <button
          onClick={() => setCurrentStep(Math.min(9, currentStep + 1))}
          disabled={!canProceed}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-colors ${
            canProceed
              ? "bg-teal-500/20 border border-teal-500/30 text-teal-400 hover:bg-teal-500/30"
              : "bg-white/[0.04] border border-white/[0.06] text-slate-600 cursor-not-allowed"
          }`}
        >
          {currentStep === 9 ? "Complete" : "Next"} <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
