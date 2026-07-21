import { useState } from "react";
import {
  FileText,
  Download,
  Clock,
  Bot,
  Users,
  ChevronRight,
  Eye,
  Filter,
} from "lucide-react";
import { motion } from "framer-motion";

type ArtifactStatus = "draft" | "review" | "approved" | "published";

interface Artifact {
  id: string;
  title: string;
  type: string;
  generatedBy: string;
  reviewedBy?: string;
  status: ArtifactStatus;
  version: string;
  created: string;
  updated: string;
  workspace: string;
}

const artifacts: Artifact[] = [
  {
    id: "art-1",
    title: "RCA Report — Pump P-101 Seal Failures",
    type: "RCA Report",
    generatedBy: "Reliability Engineering",
    reviewedBy: "Senior Reliability Engineer",
    status: "approved",
    version: "v2.1",
    created: "2026-05-27",
    updated: "2026-05-29",
    workspace: "RCA Copilot — Pump P-101",
  },
  {
    id: "art-2",
    title: "PM Optimization Plan — Belt Conveyor Class",
    type: "PM Strategy",
    generatedBy: "Maintenance Strategy",
    status: "review",
    version: "v1.3",
    created: "2026-05-28",
    updated: "2026-05-30",
    workspace: "PM Optimization — Conveyor Class",
  },
  {
    id: "art-3",
    title: "Executive Asset Performance Brief — May 2026",
    type: "Executive Briefing",
    generatedBy: "Data Analytics",
    reviewedBy: "Site Director",
    status: "published",
    version: "v1.0",
    created: "2026-05-20",
    updated: "2026-05-21",
    workspace: "Executive Briefing — May",
  },
  {
    id: "art-4",
    title: "FMEA — Conveyor Drive Assembly",
    type: "FMEA Worksheet",
    generatedBy: "Reliability Engineering",
    status: "draft",
    version: "v0.4",
    created: "2026-05-25",
    updated: "2026-05-30",
    workspace: "Reliability Program Builder",
  },
  {
    id: "art-5",
    title: "Shutdown Readiness Report — Q3 Turnaround",
    type: "Readiness Report",
    generatedBy: "Planning & Scheduling",
    status: "draft",
    version: "v0.2",
    created: "2026-05-29",
    updated: "2026-05-30",
    workspace: "Shutdown Readiness Plan Q3",
  },
  {
    id: "art-6",
    title: "Mission Readiness Assessment — Production Ramp",
    type: "Go/No-Go Report",
    generatedBy: "Asset Management",
    reviewedBy: "Operations Manager",
    status: "review",
    version: "v1.1",
    created: "2026-05-26",
    updated: "2026-05-29",
    workspace: "Mission Readiness Review",
  },
  {
    id: "art-7",
    title: "Bad Actor Elimination Plan — 2026 Q2",
    type: "Improvement Plan",
    generatedBy: "Continuous Improvement",
    reviewedBy: "Reliability Manager",
    status: "approved",
    version: "v1.0",
    created: "2026-05-15",
    updated: "2026-05-22",
    workspace: "Reliability Program Builder",
  },
  {
    id: "art-8",
    title: "Weekly Reliability Review — Week 22",
    type: "Review Report",
    generatedBy: "Data Analytics",
    status: "published",
    version: "v1.0",
    created: "2026-05-27",
    updated: "2026-05-27",
    workspace: "Reliability Program Builder",
  },
];

const statusConfig: Record<
  ArtifactStatus,
  { color: string; bg: string; label: string }
> = {
  draft: { color: "text-slate-400", bg: "bg-slate-500/10", label: "Draft" },
  review: {
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    label: "In Review",
  },
  approved: { color: "text-teal-400", bg: "bg-teal-500/10", label: "Approved" },
  published: {
    color: "text-green-400",
    bg: "bg-green-500/10",
    label: "Published",
  },
};

export function ArtifactWorkspace() {
  const [filter, setFilter] = useState<ArtifactStatus | "all">("all");
  const filtered =
    filter === "all" ? artifacts : artifacts.filter((a) => a.status === filter);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Artifacts
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">
            AI-generated operational documents, reports, and plans
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <FileText className="w-4 h-4 text-teal-400" />
          <span>{artifacts.length} artifacts</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Filter className="w-3.5 h-3.5 text-slate-400" />
        {[
          { value: "all", label: "All" },
          { value: "draft", label: "Drafts" },
          { value: "review", label: "In Review" },
          { value: "approved", label: "Approved" },
          { value: "published", label: "Published" },
        ].map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value as ArtifactStatus | "all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              filter === f.value
                ? "bg-teal-500/20 border border-teal-500/30 text-teal-400"
                : "bg-white/4 border border-white/8 text-slate-400 hover:bg-white/8"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Artifact List */}
      <div className="space-y-3">
        {filtered.map((artifact, i) => {
          const sc = statusConfig[artifact.status];
          return (
            <motion.div
              key={artifact.id}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="bg-[#0D1520] border border-white/6 rounded-xl p-4 hover:border-white/12 transition-colors cursor-pointer"
            >
              <div className="flex items-start gap-4">
                <div className="p-2.5 rounded-lg bg-white/4 border border-white/6 shrink-0">
                  <FileText className="w-5 h-5 text-slate-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h4 className="text-sm font-bold text-white truncate">
                      {artifact.title}
                    </h4>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-semibold ${sc.bg} ${sc.color} shrink-0`}
                    >
                      {sc.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400 mt-1">
                    <span className="px-1.5 py-0.5 rounded-sm bg-white/4 border border-white/6">
                      {artifact.type}
                    </span>
                    <span className="font-mono">{artifact.version}</span>
                    <span className="flex items-center gap-1">
                      <Bot className="w-3 h-3" />
                      {artifact.generatedBy}
                    </span>
                    {artifact.reviewedBy && (
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {artifact.reviewedBy}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Updated {artifact.updated}
                    </span>
                    <span>Workspace: {artifact.workspace}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button className="p-1.5 rounded-lg text-slate-400 hover:text-teal-400 hover:bg-teal-500/10 transition-colors">
                    <Eye className="w-4 h-4" />
                  </button>
                  <button className="p-1.5 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 transition-colors">
                    <Download className="w-4 h-4" />
                  </button>
                  <ChevronRight className="w-4 h-4 text-slate-400" />
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="bg-[#0D1520] border border-teal-500/10 rounded-xl p-4 flex items-start gap-3">
        <FileText className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-bold text-teal-400">
            Operational Artifacts
          </div>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            SyncAI generates operational documents — not just chat responses.
            Each artifact is versioned, reviewable, exportable to
            PDF/Word/Excel, and linked to the evidence and decisions that
            produced it.
          </p>
        </div>
      </div>
    </div>
  );
}
