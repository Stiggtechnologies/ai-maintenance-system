import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Search,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import type { SyncStreamStatus } from "../hooks/useSyncStream";
import type { InvestigationCheckRecord, SyncStreamEvent } from "../types/sync-stream";

interface SyncActivityTimelineProps {
  events: SyncStreamEvent[];
  status: SyncStreamStatus;
}

interface ActivityItem {
  key: string;
  label: string;
  detail?: string;
  state: "active" | "complete" | "attention" | "unavailable";
  icon: "search" | "agent" | "governance";
}

const COMPLETED_CHECK_LABELS: Record<string, string> = {
  "operational-kpis": "Operational KPIs reviewed",
  "asset-data-integrity": "Asset data integrity checked",
  "safety-indicators": "Safety indicators cross-checked",
  "open-recommendations": "Open recommendations reviewed",
  "current-asset": "Current asset context checked",
  "work-context": "Work execution context checked",
  attachments: "Attached source material read",
  "risk-ranking": "Highest-risk condition evaluated",
  "governed-context": "Relevant governed context checked",
};

function checkLabel(check: InvestigationCheckRecord): string {
  return COMPLETED_CHECK_LABELS[check.id] ?? check.label;
}

function friendlyAgentName(agentId: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim();
  const known: Record<string, string> = {
    reliability_engineer: "Reliability Engineer",
    "reliability-engineer": "Reliability Engineer",
    reliability: "Reliability Engineer",
  };
  if (known[agentId.toLowerCase()]) return known[agentId.toLowerCase()];
  const words = agentId
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\bagent\b/gi, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
  return words.length
    ? words.map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(" ")
    : "Specialist";
}

export function buildSyncActivity(
  events: SyncStreamEvent[],
  status: SyncStreamStatus,
): ActivityItem[] {
  const items = new Map<string, ActivityItem>();
  if (status === "streaming") {
    items.set("turn", {
      key: "turn",
      label: "Reviewing your request",
      state: "active",
      icon: "search",
    });
  }

  for (const event of events) {
    if (event.type === "turn.started") {
      items.set("turn", {
        key: "turn",
        label: "Request understood",
        state: "complete",
        icon: "search",
      });
      continue;
    }
    if (event.type === "investigation.check.started") {
      items.set(`check:${event.checkId}`, {
        key: `check:${event.checkId}`,
        label: event.label,
        state: "active",
        icon: "search",
      });
      continue;
    }
    if (event.type === "investigation.check.completed") {
      items.set(`check:${event.check.id}`, {
        key: `check:${event.check.id}`,
        label: checkLabel(event.check),
        detail: event.check.detail,
        state:
          event.check.state === "attention"
            ? "attention"
            : event.check.state === "unavailable"
              ? "unavailable"
              : "complete",
        icon: "search",
      });
      continue;
    }
    if (event.type === "agent.started") {
      const name = friendlyAgentName(event.agentId, event.label);
      items.set(`agent:${event.agentId}`, {
        key: `agent:${event.agentId}`,
        label:
          event.executionMode === "applied"
            ? `Applying ${name} discipline`
            : `Consulting ${name}`,
        state: "active",
        icon: "agent",
      });
      continue;
    }
    if (event.type === "agent.completed") {
      const name = friendlyAgentName(event.agentId, event.label);
      items.set(`agent:${event.agentId}`, {
        key: `agent:${event.agentId}`,
        label:
          event.executionMode === "applied"
            ? `${name} discipline applied`
            : `${name} completed`,
        detail: event.durationMs != null ? `${event.durationMs} ms` : undefined,
        state: /fail|error/i.test(event.status) ? "attention" : "complete",
        icon: "agent",
      });
      continue;
    }
    if (event.type === "retrieval.started") {
      items.set("retrieval", {
        key: "retrieval",
        label: "Checking approved engineering evidence",
        state: "active",
        icon: "search",
      });
      continue;
    }
    if (event.type === "retrieval.completed") {
      items.set("retrieval", {
        key: "retrieval",
        label: "Approved engineering evidence checked",
        detail:
          event.evidence.length > 0
            ? `${event.evidence.length} source${event.evidence.length === 1 ? "" : "s"}`
            : "No governed KB source returned",
        state: event.evidence.length > 0 ? "complete" : "unavailable",
        icon: "search",
      });
      continue;
    }
    if (event.type === "assistant.delta") {
      items.set("answer", {
        key: "answer",
        label: "Writing the response",
        state: "active",
        icon: "search",
      });
      continue;
    }
    if (event.type === "tool.proposed") {
      items.set("tool", {
        key: "tool",
        label: "Governed action prepared",
        state: "complete",
        icon: "governance",
      });
      continue;
    }
    if (event.type === "tool.awaiting_approval") {
      items.set("tool", {
        key: "tool",
        label: "Waiting for your confirmation",
        state: "active",
        icon: "governance",
      });
      continue;
    }
    if (event.type === "tool.started") {
      items.set("tool", {
        key: "tool",
        label: "Executing confirmed action",
        state: "active",
        icon: "governance",
      });
      continue;
    }
    if (event.type === "tool.completed") {
      items.set("tool", {
        key: "tool",
        label: "Confirmed action completed",
        state: "complete",
        icon: "governance",
      });
      continue;
    }
    if (event.type === "turn.completed") {
      const answer = items.get("answer");
      if (answer) items.set("answer", { ...answer, state: "complete" });
      continue;
    }
    if (event.type === "error") {
      items.set("attention", {
        key: "attention",
        label: "A check needs attention",
        detail: event.message,
        state: "attention",
        icon: "governance",
      });
    }
  }

  return [...items.values()].slice(-8);
}

function ActivityIcon({ item }: { item: ActivityItem }) {
  if (item.state === "active") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300" aria-hidden />;
  }
  if (item.state === "complete") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-teal-300" aria-hidden />;
  }
  if (item.state === "unavailable") {
    return <Search className="h-3.5 w-3.5 text-slate-500" aria-hidden />;
  }
  if (item.icon === "agent") {
    return <UsersRound className="h-3.5 w-3.5 text-amber-300" aria-hidden />;
  }
  if (item.icon === "governance") {
    return <ShieldCheck className="h-3.5 w-3.5 text-amber-300" aria-hidden />;
  }
  return <AlertTriangle className="h-3.5 w-3.5 text-amber-300" aria-hidden />;
}

export function SyncActivityTimeline({ events, status }: SyncActivityTimelineProps) {
  const items = buildSyncActivity(events, status);
  if (items.length === 0) return null;
  return (
    <div
      className="mb-4 rounded-xl border border-cyan-400/10 bg-cyan-400/3 px-3.5 py-3"
      aria-live="polite"
      data-testid="sync-activity"
    >
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {status === "streaming" ? "Sync is investigating" : "Sync checked"}
      </div>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div key={item.key} className="flex min-w-0 items-start gap-2 text-[12px] leading-5 text-slate-400">
            <span className="mt-0.5 shrink-0"><ActivityIcon item={item} /></span>
            <span className="min-w-0">
              <span className={item.state === "active" ? "text-slate-200" : ""}>{item.label}</span>
              {item.detail ? <span className="ml-1.5 text-slate-500">· {item.detail}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
