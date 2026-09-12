import { useState } from "react";
import { AlertTriangle, Eye, RefreshCw, ShieldCheck } from "lucide-react";
import {
  runGovernanceAgent,
  type GovernanceAgentResult,
} from "../services/governanceAgentService";

const tone = {
  critical: "border-red-500/25 bg-red-500/5 text-red-300",
  warning: "border-amber-500/25 bg-amber-500/5 text-amber-300",
  notice: "border-sky-500/25 bg-sky-500/5 text-sky-300",
};

export function GovernanceAgentPanel() {
  const [result, setResult] = useState<GovernanceAgentResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await runGovernanceAgent(30));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Governance screening unavailable",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      className="rounded-xl border border-white/8 bg-[#0D1520] p-5"
      aria-labelledby="governance-agent-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-signal-cyan" aria-hidden />
            <h2
              id="governance-agent-title"
              className="font-semibold text-white"
            >
              Governance Agent
            </h2>
            <span className="rounded-full border border-signal-cyan/25 bg-signal-cyan/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-signal-cyan">
              Detection only
            </span>
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">
            Screens canonical gate demands, waivers and committed
            blocked-control events. It cannot adjudicate, approve, waive, accept
            risk or pass a gate.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-signal-cyan/25 bg-signal-cyan/10 px-3 py-2 text-xs font-semibold text-signal-cyan disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5${loading ? " animate-spin" : ""}`}
            aria-hidden
          />
          {result ? "Run again" : "Run governance screen"}
        </button>
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-200"
        >
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-white/6 p-3 sm:col-span-2">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">
                Screen result
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {result.analysis.headline}
              </p>
            </div>
            {(["critical", "warning", "notice"] as const).map((key) => (
              <div key={key} className="rounded-lg border border-white/6 p-3">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">
                  {key}
                </p>
                <p className="mt-1 text-xl font-bold text-white">
                  {result.analysis.counts[key]}
                </p>
              </div>
            ))}
          </div>
          <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <Eye className="h-3 w-3" aria-hidden />{" "}
            {result.analysis.coverage.caseCount} tenant cases screened · blocked
            attempts from the last {result.analysis.coverage.lookbackDays} days
            · as of {new Date(result.asOf).toLocaleString()}
          </p>
          {result.analysis.findings.length ? (
            <div className="space-y-2">
              {result.analysis.findings.map((finding) => (
                <article
                  key={finding.id}
                  className={`rounded-lg border p-3 ${tone[finding.severity]}`}
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle
                      className="mt-0.5 h-4 w-4 shrink-0"
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold">
                        {finding.headline}
                      </h3>
                      {finding.caseTitle ? (
                        <p className="mt-0.5 text-[11px] text-slate-400">
                          {finding.caseTitle}
                        </p>
                      ) : null}
                      <p className="mt-2 text-xs leading-5 text-slate-300">
                        {finding.detail}
                      </p>
                      <p className="mt-2 text-xs">
                        <span className="font-semibold">Human action:</span>{" "}
                        {finding.humanAction}
                      </p>
                      <p className="mt-2 break-all font-mono text-[10px] text-slate-500">
                        {finding.sourceRefs.join(" · ")}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-200">
              No finding was detected in this bounded screen. This is not proof
              that no governance issue exists.
            </div>
          )}
          <div className="rounded-lg border border-white/6 p-3 text-[11px] leading-5 text-slate-500">
            <p>{result.analysis.basis}</p>
            {result.analysis.limitations.map((item) => (
              <p key={item}>• {item}</p>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
