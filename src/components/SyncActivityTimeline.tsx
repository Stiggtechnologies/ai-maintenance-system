import { CheckCircle2, Loader2, Search, ShieldCheck, UsersRound } from "lucide-react";
import type { SyncStreamStatus } from "../hooks/useSyncStream";
import type { SyncStreamEvent } from "../types/sync-stream";

interface SyncActivityTimelineProps {
  events: SyncStreamEvent[];
  status: SyncStreamStatus;
}

interface ActivityItem {
  key: string;
  label: string;
  detail?: string;
  state: "active" | "complete" | "attention";
  icon: "search" | "agent" | "governance";
}

function friendlyAgentName(agentId: string): string {
  const known: Record<string, string> = {
    reliability_engineer: "Reliability Engineer",
    "reliability-engineer": "Reliability Engineer",
    reliability: "Reliability Engineer",
    central_coordination: "Coordination specialist",
    "central-coordination": "Coordination specialist",
    performance_analysis: "Performance specialist",
    "performance-analysis": "Performance specialist",
    asset_health: "Asset health specialist",
    "asset-health": "Asset health specialist",
    work_order: "Work management specialist",
    "work-order": "Work management specialist",
  };
  if (known[agentId.toLowerCase()]) return known[agentId.toLowerCase()];

  const words = agentId
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\bagent\b/gi, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);

  if (words.length === 0) return "specialist";
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
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

    if (event.type === "agent.started") {
      const name = friendlyAgentName(event.agentId);
      items.set(`agent:${event.agentId}`, {
        key: `agent:${event.agentId}`,
        label: `Consulting ${name}`,
        state: "active",
        icon: "agent",
      });
      continue;
    }

    if (event.type === "agent.completed") {
      const name = friendlyAgentName(event.agentId);
      items.set(`agent:${event.agentId}`, {
        key: `agent:${event.agentId}`,
        label: `${name} checked`,
        state: event.status.toLowerCase() === "error" ? "attention" : "complete",
        icon: "agent",
      });
      continue;
    }

    if (event.type === "retrieval.started") {
      items.set("retrieval", {
        key: "retrieval",
        label: "Checking approved evidence",
        state: "active",
        icon: "search",
      });
      continue;
    }

    if (event.type === "retrieval.completed") {
      items.set("retrieval", {
        key: "retrieval",
        label: "Evidence checked",
        detail:
          event.evidence.length > 0
            ? `${event.evidence.length} source${event.evidence.length === 1 ? "" : "s"}`
            : "No governed source returned",
        state: "complete",
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

    if (event.type === "assistant.delta") {
      items.set("answer", {
        key: "answer",
        label: "Writing the response",
        state: "active",
        icon: "search",
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
        state: "attention",
        icon: "governance",
      });
    }
  }

  return [...items.values()].slice(-5);
}

function ActivityIcon({ item }: { item: ActivityItem }) {
  if (item.state === "active") {
    return <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300" aria-hidden />;
  }
  if (item.state === "complete") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-teal-300" aria-hidden />;
  }
  if (item.icon === "agent") {
    return <UsersRound className="h-3.5 w-3.5 text-amber-300" aria-hidden />;
  }
  if (item.icon === "search") {
    return <Search className="h-3.5 w-3.5 text-amber-300" aria-hidden />;
  }
  return <ShieldCheck className="h-3.5 w-3.5 text-amber-300" aria-hidden />;
}

export function SyncActivityTimeline({
  events,
  status,
}: SyncActivityTimelineProps) {
  const items = buildSyncActivity(events, status);
  if (items.length === 0) return null;

  const active = status === "streaming";

  return (
    <div
      className="mb-4 rounded-xl border border-cyan-400/10 bg-cyan-400/3 px-3.5 py-3"
      aria-live="polite"
      data-testid="sync-activity"
    >
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
        {active ? "Sync is working" : "Sync checked"}
      </div>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div
            key={item.key}
            className="flex min-w-0 items-start gap-2 text-[12px] leading-5 text-slate-400"
          >
            <span className="mt-0.5 shrink-0">
              <ActivityIcon item={item} />
            </span>
            <span className="min-w-0">
              <span className={item.state === "active" ? "text-slate-200" : ""}>
                {item.label}
              </span>
              {item.detail ? (
                <span className="ml-1.5 text-slate-500">· {item.detail}</span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
