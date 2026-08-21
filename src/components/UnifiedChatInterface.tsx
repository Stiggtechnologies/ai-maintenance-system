import { useEffect, useState } from "react";
import { Send, Mic, MicOff, Loader as Loader2, Sparkles } from "lucide-react";
import { supabase } from "../lib/supabase";
import { supabasePublicKey, supabaseUrl } from "../lib/supabase-config";
import { syncResponseGuidance } from "../lib/sync/response-guidance";
import { quotaRefusalFromBody } from "../services/agentQuota";
import { useAuth } from "./AuthProvider";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

export function UnifiedChatInterface() {
  const { user, profile } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [orgLevel, setOrgLevel] = useState<string>("");

  useEffect(() => {
    void loadOrgLevel();
    setMessages([
      {
        role: "assistant",
        content: getWelcomeMessage(),
        timestamp: new Date(),
      },
    ]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  const loadOrgLevel = async () => {
    if (!user) return;

    try {
      const { data } = await supabase
        .from("user_profiles")
        .select(
          `
          organizational_levels (level_name, level_code)
        `,
        )
        .eq("id", user.id)
        .maybeSingle();

      if (
        data?.organizational_levels &&
        typeof data.organizational_levels === "object" &&
        "level_name" in data.organizational_levels
      ) {
        setOrgLevel(
          (data.organizational_levels as { level_name: string }).level_name,
        );
      }
    } catch (error) {
      console.error("Error loading org level:", error);
    }
  };

  const getWelcomeMessage = () => {
    const level = orgLevel || "User";
    return `Hello! I'm your AI assistant, tailored for ${level} level users. I can help you with:

**Quick Actions:**
- "Show my KPIs"
- "What needs attention?"
- "Show my work orders"
- "What alerts are active?"
- "Analyze asset health"

Ask me anything about your operations, and I'll provide insights based on your role and access level.`;
  };

  const getRoleContext = () => {
    const levelCode = orgLevel.toLowerCase();

    if (levelCode.includes("executive")) {
      return "strategic KOI performance, stakeholder value, asset management maturity, and board-level insights";
    }
    if (levelCode.includes("strategic")) {
      return "departmental KPIs, resource allocation, planning support, and decision traceability";
    }
    if (levelCode.includes("tactical")) {
      return "work order management, team performance, approvals, and operational KPIs";
    }
    if (levelCode.includes("operational") || levelCode.includes("field")) {
      return "assigned tasks, procedures, safety protocols, and field execution";
    }
    return "general operations and performance metrics";
  };

  const handleSend = async (explicitInput?: string) => {
    const question = (explicitInput ?? input).trim();
    if (!question || isProcessing) return;

    setMessages((prev) => [
      ...prev,
      { role: "user", content: question, timestamp: new Date() },
    ]);
    setInput("");
    setIsProcessing(true);

    try {
      const query = question.toLowerCase();
      let agentType = "CentralCoordinationAgent";

      if (
        query.includes("kpi") ||
        query.includes("performance") ||
        query.includes("metric")
      ) {
        agentType = "PerformanceAnalysisAgent";
      } else if (
        query.includes("work order") ||
        query.includes("task") ||
        query.includes("maintenance")
      ) {
        agentType = "WorkOrderAgent";
      } else if (
        query.includes("asset") ||
        query.includes("equipment") ||
        query.includes("health")
      ) {
        agentType = "AssetHealthAgent";
      }

      const contextualQuery = [
        `[User Role: ${orgLevel}. Focus on ${getRoleContext()}]`,
        syncResponseGuidance(question, false),
        `QUESTION: ${question}`,
      ].join("\n\n");

      const response = await fetch(
        `${supabaseUrl}/functions/v1/ai-agent-processor`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabasePublicKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            agentType,
            industry: "general",
            query: contextualQuery,
          }),
        },
      );

      if (!response.ok) {
        const errorBody: unknown = await response.json().catch(() => null);
        const quota = quotaRefusalFromBody(errorBody);
        if (quota) {
          setMessages((prev) => [
            ...prev,
            { role: "system", content: quota.message, timestamp: new Date() },
          ]);
          return;
        }
        throw new Error(`API request failed: ${response.status}`);
      }

      const result = await response.json();
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.response,
          timestamp: new Date(),
        },
      ]);
    } catch (error) {
      console.error("Error sending message:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: `Error: ${error instanceof Error ? error.message : "Unknown error"}. Please try again.`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  const quickActions = [
    {
      label: "Show my KPIs",
      query: "Show my current KPIs and performance metrics",
    },
    {
      label: "What needs attention?",
      query: "What items need my attention based on my role?",
    },
    {
      label: "Show work orders",
      query: "Show my work orders and their status",
    },
    { label: "Active alerts", query: "What alerts are currently active?" },
  ];

  return (
    <div className="flex h-full flex-col bg-industrial-black">
      <div className="border-b border-industrial-border bg-industrial-graphite p-6">
        <div className="mx-auto max-w-5xl">
          <div className="mb-2 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-linear-to-br from-teal-500 to-teal-600">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-industrial-text">
                AI Assistant
              </h1>
              <p className="text-sm text-slate-400">
                Role-specific guidance for {orgLevel || "your role"}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl space-y-7">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={msg.role === "user" ? "flex justify-end" : ""}
            >
              {msg.role === "user" ? (
                <div className="max-w-2xl rounded-2xl rounded-br-md bg-teal-600 px-5 py-3 text-[14px] leading-6 text-white">
                  {msg.content}
                </div>
              ) : msg.role === "system" ? (
                <div className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-sm text-amber-100">
                  {msg.content}
                </div>
              ) : (
                <article className="max-w-[820px] py-1">
                  <div className="mb-2 flex items-center gap-2 text-[11px] font-medium text-slate-500">
                    <Sparkles className="h-3.5 w-3.5 text-teal-300" />
                    <span>AI Assistant</span>
                  </div>
                  <MarkdownRenderer content={msg.content} />
                </article>
              )}
            </div>
          ))}

          {isProcessing && (
            <div className="flex items-center gap-2 text-slate-400" aria-live="polite">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Working on your request…</span>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-industrial-border bg-industrial-graphite p-6">
        <div className="mx-auto max-w-5xl">
          {messages.length === 1 && (
            <div className="mb-4">
              <div className="mb-2 text-sm text-slate-400">Quick Actions:</div>
              <div className="flex flex-wrap gap-2">
                {quickActions.map((action) => (
                  <button
                    key={action.label}
                    onClick={() => void handleSend(action.query)}
                    className="rounded-lg bg-industrial-slate px-4 py-2 text-sm text-slate-300 transition-colors hover:bg-white/6"
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="relative">
            <input
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleSend();
              }}
              placeholder={`Ask anything about ${getRoleContext()}...`}
              className="w-full rounded-2xl border border-industrial-border px-6 py-4 pr-24 focus:border-transparent focus:outline-hidden focus:ring-2 focus:ring-teal-500"
              disabled={isProcessing}
            />
            <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
              <button
                onClick={() => setIsRecording(!isRecording)}
                disabled={isProcessing}
                className={`rounded-lg p-2 transition-colors ${
                  isRecording
                    ? "bg-red-100 text-red-600"
                    : "text-gray-400 hover:bg-industrial-slate"
                }`}
                aria-label={isRecording ? "Stop recording" : "Start recording"}
              >
                {isRecording ? (
                  <MicOff className="h-5 w-5" />
                ) : (
                  <Mic className="h-5 w-5" />
                )}
              </button>
              <button
                onClick={() => void handleSend()}
                disabled={!input.trim() || isProcessing}
                className="rounded-lg bg-teal-600 p-2 transition-colors hover:bg-teal-700 disabled:bg-gray-700"
                aria-label="Send message"
              >
                {isProcessing ? (
                  <Loader2 className="h-5 w-5 animate-spin text-white" />
                ) : (
                  <Send className="h-5 w-5 text-white" />
                )}
              </button>
            </div>
          </div>

          <div className="mt-3 text-center text-xs text-gray-500">
            AI responses are tailored to your organizational level and access
            permissions
          </div>
        </div>
      </div>
    </div>
  );
}
