/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { SIR } from "../services/intelligenceRuntime";
import { Plus, RefreshCw } from "lucide-react";

export function IntelligenceRuntimePanel() {
  const [activeTab, setActiveTab] = useState<
    | "agents"
    | "sessions"
    | "memory"
    | "events"
    | "tools"
    | "skills"
    | "queue"
    | "notifications"
    | "costs"
    | "errors"
  >("agents");
  const [loading, setLoading] = useState(false);
  const [agents, setAgents] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [memories, setMemories] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [tools, setTools] = useState<any[]>([]);
  const [skills, setSkills] = useState<any[]>([]);
  const [queue, setQueue] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [costs, setCosts] = useState<any[]>([]);
  const [errors, setErrors] = useState<any[]>([]);

  useEffect(() => {
    refresh();
  }, [activeTab]);

  const refresh = async () => {
    setLoading(true);
    try {
      if (activeTab === "agents") {
        const { data } = await supabase
          .from("sir_agents")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50);
        setAgents(data || []);
      }
      if (activeTab === "sessions") {
        const { data } = await supabase
          .from("sir_sessions")
          .select("*")
          .order("last_active_at", { ascending: false })
          .limit(50);
        setSessions(data || []);
      }
      if (activeTab === "memory") {
        const { data } = await supabase
          .from("sir_memory")
          .select("id, content, memory_type, created_at")
          .order("created_at", { ascending: false })
          .limit(50);
        setMemories(data || []);
      }
      if (activeTab === "events") {
        const { data } = await supabase
          .from("sir_events")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50);
        setEvents(data || []);
      }
      if (activeTab === "tools") {
        const { data } = await supabase
          .from("sir_tools")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50);
        setTools(data || []);
      }
      if (activeTab === "skills") {
        const { data } = await supabase
          .from("sir_skills")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50);
        setSkills(data || []);
      }
      if (activeTab === "queue") {
        const { data } = await supabase
          .from("sir_queue")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50);
        setQueue(data || []);
      }
      if (activeTab === "notifications") {
        const { data } = await supabase
          .from("sir_notifications")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50);
        setNotifications(data || []);
      }
      if (activeTab === "costs") {
        const { data } = await supabase
          .from("sir_costs")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50);
        setCosts(data || []);
      }
      if (activeTab === "errors") {
        const { data } = await supabase
          .from("sir_errors")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50);
        setErrors(data || []);
      }
    } finally {
      setLoading(false);
    }
  };

  const createQuickAgent = async () => {
    const tenant_id = (await supabase.auth.getUser()).data.user?.id;
    if (!tenant_id) return;
    await SIR.createAgent({
      tenant_id,
      name: `Agent ${agents.length + 1}`,
      agent_type: "general",
      persona: { tone: "professional" },
      config: { capabilities: [] },
    });
    refresh();
  };

  return (
    <div className="p-6 space-y-6 text-white">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            Intelligence Runtime Control Panel
          </h1>
          <p className="text-white/60 mt-1">
            Multi-agent orchestration, memory, tools, and events
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={refresh}
            className="flex items-center gap-2 px-3 py-2 text-sm bg-[#11161D]/10 border border-white/15 rounded-lg hover:bg-[#11161D]/20"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
          {activeTab === "agents" && (
            <button
              onClick={createQuickAgent}
              className="flex items-center gap-2 px-3 py-2 text-sm bg-emerald-500/90 text-white rounded-lg hover:bg-emerald-500"
            >
              <Plus className="w-4 h-4" /> New Agent
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            "agents",
            "sessions",
            "memory",
            "events",
            "tools",
            "skills",
            "queue",
            "notifications",
            "costs",
            "errors",
          ] as const
        ).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-emerald-500 text-white"
                : "bg-[#11161D]/10 text-white/80 hover:bg-[#11161D]/20"
            }`}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {loading && <div className="text-sm text-white/60">Loading...</div>}

      <div className="text-sm text-white/50">
        Active tab:{" "}
        <span className="text-white/80 font-medium">
          {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
        </span>
      </div>

      {activeTab === "agents" && (
        <div className="bg-[#11161D]/5 border border-white/10 rounded-2xl divide-y divide-white/10">
          {agents.map((a) => (
            <div key={a.id} className="p-4">
              <div className="font-semibold text-white">{a.name}</div>
              <div className="text-sm text-white/60">
                {a.agent_type} • {a.status}
              </div>
            </div>
          ))}
          {agents.length === 0 && (
            <div className="p-6 text-sm text-white/60 flex items-center justify-between">
              <span>No agents yet.</span>
              <button
                onClick={createQuickAgent}
                className="px-3 py-2 text-xs bg-emerald-500/80 text-white rounded-lg"
              >
                Create Agent
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === "sessions" && (
        <div className="bg-[#11161D]/5 border border-white/10 rounded-2xl divide-y divide-white/10">
          {sessions.map((s) => (
            <div key={s.id} className="p-4">
              <div className="font-semibold text-white">
                Session {s.id.slice(0, 8)}
              </div>
              <div className="text-sm text-white/60">
                Status: {s.status} • Last active:{" "}
                {new Date(s.last_active_at).toLocaleString()}
              </div>
            </div>
          ))}
          {sessions.length === 0 && (
            <div className="p-6 text-sm text-white/60">
              No sessions yet. Create an agent first, then start a session.
            </div>
          )}
        </div>
      )}

      {activeTab === "memory" && (
        <div className="bg-[#11161D]/5 border border-white/10 rounded-2xl divide-y divide-white/10">
          {memories.map((m) => (
            <div key={m.id} className="p-4">
              <div className="text-sm text-white">{m.content}</div>
              <div className="text-xs text-white/50">
                {m.memory_type} • {new Date(m.created_at).toLocaleString()}
              </div>
            </div>
          ))}
          {memories.length === 0 && (
            <div className="p-6 text-sm text-white/60">
              No memory entries yet. Add memory via Intelligence Runtime
              orchestrator.
            </div>
          )}
        </div>
      )}

      {activeTab === "events" && (
        <div className="bg-[#11161D]/5 border border-white/10 rounded-2xl divide-y divide-white/10">
          {events.map((e) => (
            <div key={e.id} className="p-4">
              <div className="font-semibold text-white">
                {e.event_type} • {e.schedule || "manual"}
              </div>
              <div className="text-xs text-white/50">
                Active: {String(e.is_active)} • Last run:{" "}
                {e.last_run_at
                  ? new Date(e.last_run_at).toLocaleString()
                  : "Never"}
              </div>
            </div>
          ))}
          {events.length === 0 && (
            <div className="p-6 text-sm text-white/60">No events yet.</div>
          )}
        </div>
      )}

      {activeTab === "tools" && (
        <div className="bg-[#11161D]/5 border border-white/10 rounded-2xl divide-y divide-white/10">
          {tools.map((t) => (
            <div key={t.id} className="p-4">
              <div className="font-semibold text-white">{t.name}</div>
              <div className="text-sm text-white/60">
                {t.description || "No description"}
              </div>
            </div>
          ))}
          {tools.length === 0 && (
            <div className="p-6 text-sm text-white/60">
              No tools registered yet.
            </div>
          )}
        </div>
      )}

      {activeTab === "skills" && (
        <div className="bg-[#11161D]/5 border border-white/10 rounded-2xl divide-y divide-white/10">
          {skills.map((s) => (
            <div key={s.id} className="p-4">
              <div className="font-semibold text-white">{s.name}</div>
              <div className="text-sm text-white/60">
                v{s.version || "1.0.0"} • {s.description || "No description"}
              </div>
            </div>
          ))}
          {skills.length === 0 && (
            <div className="p-6 text-sm text-white/60">
              No skills registered yet.
            </div>
          )}
        </div>
      )}

      {activeTab === "queue" && (
        <div className="bg-[#11161D]/5 border border-white/10 rounded-2xl divide-y divide-white/10">
          {queue.map((q) => (
            <div key={q.id} className="p-4">
              <div className="font-semibold text-white">{q.queue_name}</div>
              <div className="text-sm text-white/60">
                Status: {q.status} • Attempts: {q.attempts}
              </div>
            </div>
          ))}
          {queue.length === 0 && (
            <div className="p-6 text-sm text-white/60">Queue empty.</div>
          )}
        </div>
      )}

      {activeTab === "notifications" && (
        <div className="bg-[#11161D]/5 border border-white/10 rounded-2xl divide-y divide-white/10">
          {notifications.map((n) => (
            <div key={n.id} className="p-4">
              <div className="font-semibold text-white">
                {n.channel} → {n.target}
              </div>
              <div className="text-sm text-white/60">{n.message}</div>
            </div>
          ))}
          {notifications.length === 0 && (
            <div className="p-6 text-sm text-white/60">No notifications.</div>
          )}
        </div>
      )}

      {activeTab === "costs" && (
        <div className="bg-[#11161D]/5 border border-white/10 rounded-2xl divide-y divide-white/10">
          {costs.map((c) => (
            <div key={c.id} className="p-4">
              <div className="font-semibold text-white">
                {c.model || "model"} • ${Number(c.cost_usd).toFixed(4)}
              </div>
              <div className="text-sm text-white/60">
                Tokens: {c.prompt_tokens + c.completion_tokens}
              </div>
            </div>
          ))}
          {costs.length === 0 && (
            <div className="p-6 text-sm text-white/60">No cost records.</div>
          )}
        </div>
      )}

      {activeTab === "errors" && (
        <div className="bg-[#11161D]/5 border border-white/10 rounded-2xl divide-y divide-white/10">
          {errors.map((e) => (
            <div key={e.id} className="p-4">
              <div className="font-semibold text-white">
                {e.source || "unknown"}
              </div>
              <div className="text-sm text-white/60">{e.message}</div>
            </div>
          ))}
          {errors.length === 0 && (
            <div className="p-6 text-sm text-white/60">No errors logged.</div>
          )}
        </div>
      )}
    </div>
  );
}
