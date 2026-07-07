import { useState, useEffect, useRef } from "react";
import {
  Search,
  Command,
  Target,
  Bot,
  Factory,
  Wrench,
  TrendingUp,
  Settings,
  ArrowRight,
  Clock,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface CommandSearchProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (path: string) => void;
}

interface SearchResult {
  id: string;
  label: string;
  path: string;
  category: string;
  icon: React.ElementType;
}

const allResults: SearchResult[] = [
  {
    id: "mc",
    label: "Mission Control",
    path: "/mission-control",
    category: "Mission",
    icon: Target,
  },
  {
    id: "cc",
    label: "Command Centers",
    path: "/command-centers",
    category: "Mission",
    icon: Target,
  },
  {
    id: "rd",
    label: "Readiness",
    path: "/readiness",
    category: "Mission",
    icon: Target,
  },
  {
    id: "cw",
    label: "Cowork Studio",
    path: "/cowork",
    category: "Mission",
    icon: Target,
  },
  {
    id: "ai",
    label: "AI Agents",
    path: "/ai-workforce",
    category: "AI Workforce",
    icon: Bot,
  },
  {
    id: "au",
    label: "Autonomy Control",
    path: "/autonomy",
    category: "AI Workforce",
    icon: Bot,
  },
  {
    id: "am",
    label: "Autonomy Maturity",
    path: "/autonomy-maturity",
    category: "AI Workforce",
    icon: Bot,
  },
  {
    id: "ap",
    label: "Approvals Queue",
    path: "/approvals",
    category: "AI Workforce",
    icon: Bot,
  },
  {
    id: "dg",
    label: "Decision Governance",
    path: "/governance",
    category: "AI Workforce",
    icon: Bot,
  },
  {
    id: "as",
    label: "Assets",
    path: "/assets",
    category: "Asset Intelligence",
    icon: Factory,
  },
  {
    id: "rl",
    label: "Reliability",
    path: "/reliability",
    category: "Asset Intelligence",
    icon: Factory,
  },
  {
    id: "rk",
    label: "Risk & Consequence",
    path: "/risk",
    category: "Asset Intelligence",
    icon: Factory,
  },
  {
    id: "wa",
    label: "Work Action Board",
    path: "/work",
    category: "Work & Execution",
    icon: Wrench,
  },
  {
    id: "sc",
    label: "Scenario Simulator",
    path: "/scenarios",
    category: "Work & Execution",
    icon: Wrench,
  },
  {
    id: "br",
    label: "Operational Briefing",
    path: "/briefing",
    category: "Work & Execution",
    icon: Wrench,
  },
  {
    id: "pb",
    label: "Playbooks Library",
    path: "/playbooks",
    category: "Work & Execution",
    icon: Wrench,
  },
  {
    id: "em",
    label: "Emergency Mode",
    path: "/emergency",
    category: "Work & Execution",
    icon: Wrench,
  },
  {
    id: "pf",
    label: "Performance",
    path: "/performance",
    category: "Performance",
    icon: TrendingUp,
  },
  {
    id: "oe",
    label: "OEE Dashboard",
    path: "/oee",
    category: "Performance",
    icon: TrendingUp,
  },
  {
    id: "ll",
    label: "Learning Loop",
    path: "/learning-loop",
    category: "Performance",
    icon: TrendingUp,
  },
  {
    id: "vr",
    label: "Value Realization",
    path: "/value",
    category: "Performance",
    icon: TrendingUp,
  },
  {
    id: "bm",
    label: "Benchmarking",
    path: "/benchmarking",
    category: "Performance",
    icon: TrendingUp,
  },
  {
    id: "te",
    label: "Trust & Explainability",
    path: "/trust",
    category: "Performance",
    icon: TrendingUp,
  },
  {
    id: "ig",
    label: "Integrations",
    path: "/integrations",
    category: "System",
    icon: Settings,
  },
  {
    id: "ih",
    label: "Integration Health",
    path: "/integration-health",
    category: "System",
    icon: Settings,
  },
  {
    id: "af",
    label: "Artifacts",
    path: "/artifacts",
    category: "System",
    icon: Settings,
  },
  {
    id: "sw",
    label: "Setup Wizard",
    path: "/setup",
    category: "System",
    icon: Settings,
  },
  {
    id: "rs",
    label: "Research",
    path: "/research",
    category: "System",
    icon: Settings,
  },
  {
    id: "st",
    label: "Settings",
    path: "/settings",
    category: "System",
    icon: Settings,
  },
];

const recentSearches = [
  "Conveyor C-22",
  "Pump P-101",
  "Work Action Board",
  "Approvals",
];

export function CommandSearch({
  open,
  onClose,
  onNavigate,
}: CommandSearchProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = query.trim()
    ? allResults.filter(
        (r) =>
          r.label.toLowerCase().includes(query.toLowerCase()) ||
          r.category.toLowerCase().includes(query.toLowerCase()),
      )
    : allResults;

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
    if (!open) {
      setQuery("");
      setSelectedIndex(0);
    }
  }, [open]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === "Enter" && filtered[selectedIndex]) {
        onNavigate(filtered[selectedIndex].path);
        onClose();
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, filtered, selectedIndex, onNavigate, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.98 }}
            transition={{ type: "spring", damping: 25, stiffness: 400 }}
            className="fixed top-[12%] inset-x-4 mx-auto max-w-xl bg-[#0E1520] border border-white/[0.08] rounded-2xl z-50 overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search Input */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-white/[0.06]">
              <Search className="w-5 h-5 text-slate-400 flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search pages, assets, commands..."
                className="flex-1 bg-transparent text-sm text-white placeholder-slate-600 outline-none"
              />
              <kbd className="hidden sm:flex items-center gap-0.5 px-2 py-1 rounded bg-white/[0.05] border border-white/[0.08] text-xs text-slate-400 font-mono">
                ESC
              </kbd>
            </div>

            {/* Recent Searches */}
            {!query.trim() && (
              <div className="px-5 py-3 border-b border-white/[0.06]">
                <div className="text-xs text-slate-400 uppercase tracking-wider mb-2">
                  Recent
                </div>
                <div className="flex flex-wrap gap-2">
                  {recentSearches.map((s) => (
                    <button
                      key={s}
                      onClick={() => setQuery(s)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/[0.04] border border-white/[0.06] text-xs text-slate-400 hover:bg-white/[0.08] transition-colors"
                    >
                      <Clock className="w-3 h-3 text-slate-400" />
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Results */}
            <div className="max-h-[360px] overflow-y-auto py-2">
              {filtered.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <p className="text-sm text-slate-400">No results found</p>
                  <p className="text-xs text-slate-400 mt-1">
                    Try searching for a page name or category
                  </p>
                </div>
              ) : (
                filtered.map((result, i) => {
                  const Icon = result.icon;
                  return (
                    <button
                      key={result.id}
                      onClick={() => {
                        onNavigate(result.path);
                        onClose();
                      }}
                      className={`w-full flex items-center gap-3 px-5 py-2.5 transition-colors ${
                        i === selectedIndex
                          ? "bg-teal-500/10 text-teal-400"
                          : "text-slate-400 hover:bg-white/[0.04]"
                      }`}
                    >
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <div className="flex-1 text-left">
                        <span className="text-sm">{result.label}</span>
                      </div>
                      <span className="text-xs text-slate-400">
                        {result.category}
                      </span>
                      {i === selectedIndex && (
                        <ArrowRight className="w-3 h-3 flex-shrink-0" />
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-between text-xs text-slate-400">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 rounded bg-white/[0.05] border border-white/[0.08] font-mono">
                    ↑↓
                  </kbd>{" "}
                  Navigate
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 rounded bg-white/[0.05] border border-white/[0.08] font-mono">
                    ↵
                  </kbd>{" "}
                  Open
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Command className="w-3 h-3" />
                <span>K to toggle</span>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
