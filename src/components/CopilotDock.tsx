/**
 * CopilotDock — the role-aware chat interface, available on every page.
 *
 * One shared reliability brain (ai-agent-processor: GPT-parity prompt with
 * RAM Guide / MIL-HDBK-338B citations), framed per organizational layer via
 * rolePersonas. Every question is grounded in LIVE role-scoped context
 * (audience-filtered KPIs + top pending recommendations) fetched with the
 * caller's own credentials — the copilot can only see what the user can.
 */
import { useEffect, useRef, useState } from "react";
import { Bot, Download, Loader2, Send, Sparkles, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import { getRolePersona } from "../lib/rolePersonas";
import { getKpiDashboard } from "../services/kpiService";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface ChatMessage {
  role: "user" | "agent";
  text: string;
}

const DELIVERABLE_RE =
  /\b(complete|produce|create|build|generate|develop|prepare|draft|perform)\b[\s\S]{0,120}\b(fmea|rca|fracas|rcm|register|assessment|analysis|packet|report|plan|study|review)\b/i;

/** Extract the first markdown table from an agent reply as CSV. */
function markdownTableToCsv(text: string): string | null {
  const lines = text.split("\n").filter((l) => l.trim().startsWith("|"));
  if (lines.length < 3) return null;
  const rows = lines
    .filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l))
    .map((l) =>
      l
        .replace(/^\s*\|/, "")
        .replace(/\|\s*$/, "")
        .split("|")
        .map((c) => `"${c.trim().replace(/"/g, '""')}"`)
        .join(","),
    );
  return rows.length >= 2 ? rows.join("\n") : null;
}

function downloadCsvText(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Compact, role-scoped operating context for grounding answers. */
async function buildLiveContext(): Promise<string> {
  const parts: string[] = [];
  try {
    const dash = await getKpiDashboard();
    const withValues = dash.kpis.filter((k) => k.value != null);
    const breaches = withValues.filter((k) => k.status === "breach");
    parts.push(
      "LIVE KPIs (visible to this role): " +
        withValues
          .slice(0, 14)
          .map(
            (k) =>
              `${k.name}=${k.value}${k.unit === "%" ? "%" : ""} [${k.status}]`,
          )
          .join("; "),
    );
    if (breaches.length > 0) {
      parts.push(
        "BREACHED: " +
          breaches
            .map((k) => `${k.name} (A: ${k.accountable}, R: ${k.responsible})`)
            .join("; "),
      );
    }
  } catch {
    /* KPI context unavailable — proceed without it */
  }
  try {
    const { data } = await supabase
      .from("recommendations")
      .select("title, urgency, status")
      .in("status", ["pending", "escalated"])
      .order("created_at", { ascending: false })
      .limit(6);
    if (data && data.length > 0) {
      parts.push(
        "OPEN RECOMMENDATIONS: " +
          data.map((r) => `${r.title} [${r.urgency}]`).join("; "),
      );
    }
  } catch {
    /* fine */
  }
  return parts.join("\n").slice(0, 1800);
}

export function CopilotDock() {
  const { profile } = useAuth();
  const persona = getRolePersona(profile?.role as string);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [longRun, setLongRun] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, sending]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || sending) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setSending(true);
    try {
      const deliverable = DELIVERABLE_RE.test(q);
      setLongRun(deliverable);
      const context = await buildLiveContext();
      const { data, error } = await supabase.functions.invoke(
        "ai-agent-processor",
        {
          body: {
            agentType: "ReliabilityAgent",
            depth: deliverable ? "deliverable" : "standard",
            query:
              `${persona.framing}\n\n` +
              (context ? `${context}\n\n` : "") +
              `QUESTION: ${q}\n\n` +
              (deliverable
                ? `This is a work-product request: produce the COMPLETE deliverable now.`
                : `Answer for this audience. Where the live context above is relevant, use its real numbers.`),
          },
        },
      );
      if (error) throw new Error(error.message);
      const text =
        (data as { response?: string })?.response ??
        "The copilot returned no content.";
      setMessages((m) => [...m, { role: "agent", text }]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "agent",
          text: "The copilot is unavailable right now — your operating data and actions are unaffected. Please try again shortly.",
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Launcher */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Close copilot" : `Open ${persona.title}`}
        data-testid="copilot-launcher"
        className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-teal-500 text-slate-950 shadow-lg shadow-teal-500/20 hover:bg-teal-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
      >
        {open ? (
          <X className="h-5 w-5" aria-hidden />
        ) : (
          <Bot className="h-6 w-6" aria-hidden />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={persona.title}
          data-testid="copilot-dock"
          className="fixed bottom-20 right-5 z-40 flex h-[560px] max-h-[calc(100vh-7rem)] w-[380px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0D1520] shadow-2xl shadow-black/50"
        >
          <div className="border-b border-white/[0.06] px-4 py-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-teal-300" aria-hidden />
              <h2 className="text-sm font-semibold text-white">
                {persona.title}
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">{persona.intro}</p>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="space-y-2" data-testid="copilot-suggestions">
                <p className="text-xs text-slate-400">Try asking:</p>
                {persona.suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => void ask(s)}
                    className="block w-full rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-left text-xs text-slate-300 hover:border-teal-500/40 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[85%] rounded-xl rounded-br-sm bg-teal-500/15 px-3 py-2 text-sm text-teal-100">
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[92%] rounded-xl rounded-bl-sm border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-slate-200">
                    <MarkdownRenderer content={m.text} />
                    {markdownTableToCsv(m.text) && (
                      <button
                        onClick={() =>
                          downloadCsvText(
                            markdownTableToCsv(m.text)!,
                            "syncai-deliverable.csv",
                          )
                        }
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-teal-500/30 bg-teal-500/10 px-2.5 py-1.5 text-xs font-medium text-teal-300 hover:bg-teal-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden />
                        Download register (CSV)
                      </button>
                    )}
                  </div>
                </div>
              ),
            )}
            {sending && (
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                {longRun
                  ? "Producing the complete deliverable — this can take a minute or two…"
                  : "Reading your live operating data…"}
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
            className="border-t border-white/[0.06] p-3"
          >
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about your operation…"
                aria-label={`Ask the ${persona.title}`}
                className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-400 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                aria-label="Send"
                className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-500 text-slate-950 hover:bg-teal-400 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
              >
                <Send className="h-4 w-4" aria-hidden />
              </button>
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              Grounded in data your role can see · cites the reliability
              knowledge base · advisory only — actions stay human-approved
            </p>
          </form>
        </div>
      )}
    </>
  );
}
