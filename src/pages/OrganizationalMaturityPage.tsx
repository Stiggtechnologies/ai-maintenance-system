import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import { ErrorState, LoadingState } from "../components/ui/AsyncStates";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import {
  ORGANIZATIONAL_MATURITY_DOMAINS,
  getOrganizationalMaturityWorkspace,
  recordOrganizationalMaturityAssessment,
  reviewOrganizationalMaturityAssessment,
  type OrganizationalMaturityDomain,
  type OrganizationalMaturityDomainKey,
} from "../services/organizationalMaturityService";

interface EvidenceOption {
  id: string;
  description: string | null;
  source_system: string | null;
}

const LABELS: Record<OrganizationalMaturityDomainKey, string> = {
  leadership: "Leadership",
  hierarchy: "Asset hierarchy",
  work_management: "Work management",
  planning_scheduling: "Planning & scheduling",
  failure_coding: "Failure coding",
  pm_quality: "PM quality",
  condition_monitoring: "Condition monitoring",
  materials: "Materials",
  engineering_governance: "Engineering governance",
  data_quality: "Data quality",
  workforce: "Workforce",
  financial_integration: "Financial integration",
  ai_governance: "AI governance",
};

const SCALE = [
  "Not evidenced",
  "Ad hoc",
  "Repeatable",
  "Defined",
  "Measured",
  "Continuously improved",
];

function emptyDomains(): OrganizationalMaturityDomain[] {
  return ORGANIZATIONAL_MATURITY_DOMAINS.map((domainKey) => ({
    domainKey,
    score: 0,
    finding: "",
    evidenceItemId: "",
  }));
}

function scoreTone(score: number): string {
  if (score >= 4) return "bg-emerald-500/15 text-emerald-300";
  if (score >= 2) return "bg-amber-500/15 text-amber-300";
  return "bg-red-500/15 text-red-300";
}

export function OrganizationalMaturityPage() {
  const { profile } = useAuth();
  const role = String(profile?.role ?? "");
  const canAssess = [
    "admin",
    "executive",
    "maintenance_manager",
    "reliability_engineer",
  ].includes(role);
  const canReview = role === "admin" || role === "executive";
  const workspace = useAsyncData(getOrganizationalMaturityWorkspace, [], {
    isEmpty: () => false,
  });
  const evidence = useAsyncData(async () => {
    const { data, error } = await supabase
      .from("evidence_items")
      .select("id,description,source_system")
      .eq("verification_status", "verified")
      .order("created_at", { ascending: false })
      .limit(200)
      .returns<EvidenceOption[]>();
    if (error) throw new Error(error.message);
    return data ?? [];
  });
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState("");
  const [evidenceSummary, setEvidenceSummary] = useState("");
  const [nextReview, setNextReview] = useState("");
  const [domains, setDomains] = useState(emptyDomains);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const complete = useMemo(
    () =>
      title.trim().length >= 3 &&
      scope.trim().length >= 10 &&
      evidenceSummary.trim().length >= 20 &&
      domains.every(
        (domain) =>
          domain.finding.trim().length >= 20 && domain.evidenceItemId,
      ),
    [domains, evidenceSummary, scope, title],
  );

  const updateDomain = (
    domainKey: OrganizationalMaturityDomainKey,
    patch: Partial<OrganizationalMaturityDomain>,
  ) =>
    setDomains((current) =>
      current.map((domain) =>
        domain.domainKey === domainKey ? { ...domain, ...patch } : domain,
      ),
    );

  const run = async (operation: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setNotice(null);
    setMutationError(null);
    try {
      await operation();
      setNotice(success);
      workspace.refetch();
    } catch (error) {
      setMutationError(
        error instanceof Error ? error.message : "The governed operation failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (workspace.loading || evidence.loading)
    return <LoadingState label="Loading organizational maturity…" />;
  if (workspace.error)
    return <ErrorState message={workspace.error} onRetry={workspace.refetch} />;
  if (evidence.error)
    return <ErrorState message={evidence.error} onRetry={evidence.refetch} />;
  if (!workspace.data)
    return <ErrorState message="No maturity workspace was returned." onRetry={workspace.refetch} />;

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
            <ClipboardCheck className="h-4 w-4" /> Organizational capability
          </div>
          <h1 className="text-2xl font-bold text-white">Maturity assessment</h1>
          <p className="mt-1 max-w-4xl text-sm text-slate-400">
            Thirteen evidence-backed dimensions, independently reviewed before
            SyncAI proposes maturity-appropriate improvement work.
          </p>
        </div>
        <button
          onClick={workspace.refetch}
          className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-300"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </header>

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-amber-200">
          <LockKeyhole className="h-4 w-4" /> Assessment, not certification
        </div>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">
          Scores are recorded human judgements, never inferred from product use.
          Every dimension requires verified evidence. A different executive or
          administrator must review the complete record; resulting actions stay
          pending recommendations and grant no operational authority.
        </p>
      </div>

      {notice ? (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">
          <CheckCircle2 className="h-4 w-4" /> {notice}
        </div>
      ) : null}
      {mutationError ? (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4" /> {mutationError}
        </div>
      ) : null}

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Assessment history</h2>
          <p className="text-xs text-slate-500">Immutable submissions with their review state and canonical recommendations.</p>
        </div>
        {workspace.data.assessments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 p-10 text-center text-sm text-slate-500">
            <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-slate-600" />
            No organizational maturity assessment has been submitted.
          </div>
        ) : (
          workspace.data.assessments.map((assessment) => (
            <article key={assessment.id} className="rounded-2xl border border-white/8 bg-[#0D1520] p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-white">{assessment.title}</h3>
                  <p className="mt-1 max-w-3xl text-sm text-slate-400">{assessment.scope}</p>
                  <p className="mt-2 text-xs text-slate-500">Assessed {new Date(assessment.assessedAt).toLocaleDateString()} · {assessment.status}</p>
                </div>
                <div className="flex gap-2">
                  <div className="rounded-lg border border-white/8 bg-black/20 px-4 py-2 text-center">
                    <div className="text-xl font-black text-white">{Number(assessment.overallLevel).toFixed(2)}</div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">overall / 5</div>
                  </div>
                  <div className="rounded-lg border border-white/8 bg-black/20 px-4 py-2 text-center">
                    <div className="text-xl font-black text-white">{assessment.minimumLevel}</div>
                    <div className="text-[10px] uppercase tracking-wide text-slate-500">lowest / 5</div>
                  </div>
                </div>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {assessment.domains.map((domain) => (
                  <div key={domain.domainKey} className="rounded-lg border border-white/6 bg-black/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-200">{LABELS[domain.domainKey]}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${scoreTone(domain.score)}`}>{domain.score}/5</span>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-400">{domain.finding}</p>
                    <p className="mt-2 truncate text-[10px] text-slate-600">Evidence: {domain.evidenceDescription ?? domain.evidenceItemId}</p>
                  </div>
                ))}
              </div>
              {assessment.recommendations.length > 0 ? (
                <div className="mt-4 rounded-xl border border-cyan-400/10 bg-cyan-400/[0.03] p-4">
                  <h4 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-cyan-200"><TrendingUp className="h-4 w-4" /> Approved improvement recommendations</h4>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {assessment.recommendations.map((recommendation) => (
                      <div key={recommendation.id} className="rounded-lg border border-white/6 bg-black/20 p-3">
                        <div className="text-sm font-semibold text-white">{recommendation.title}</div>
                        <p className="mt-1 text-xs text-slate-400">{recommendation.action}</p>
                        <p className="mt-2 text-[10px] text-amber-300">{recommendation.approvalRequired}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {assessment.status === "submitted" && canReview ? (
                <div className="mt-4 flex flex-col gap-2 border-t border-white/6 pt-4 md:flex-row">
                  <textarea
                    aria-label={`Review note for ${assessment.title}`}
                    value={reviewNotes[assessment.id] ?? ""}
                    onChange={(event) => setReviewNotes((current) => ({ ...current, [assessment.id]: event.target.value }))}
                    placeholder="Independent review basis (minimum 20 characters)"
                    className="min-h-20 flex-1 rounded-lg border border-white/8 bg-black/20 p-3 text-sm text-white placeholder:text-slate-600"
                  />
                  <div className="flex gap-2 md:flex-col">
                    {(["approved", "rejected"] as const).map((decision) => (
                      <button
                        key={decision}
                        disabled={busy || (reviewNotes[assessment.id] ?? "").trim().length < 20}
                        onClick={() => run(() => reviewOrganizationalMaturityAssessment({ assessmentId: assessment.id, decision, reviewNote: reviewNotes[assessment.id] ?? "" }), `Assessment ${decision}; the decision is now in the canonical approval trail.`)}
                        className={`rounded-lg px-4 py-2 text-xs font-semibold disabled:opacity-40 ${decision === "approved" ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300"}`}
                      >
                        {decision === "approved" ? "Approve assessment" : "Reject assessment"}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </article>
          ))
        )}
      </section>

      {canAssess ? (
        <section className="rounded-2xl border border-white/8 bg-[#0D1520] p-5">
          <h2 className="text-lg font-semibold text-white">Submit a complete assessment</h2>
          <p className="mt-1 text-xs text-slate-500">No partial score is promoted as a result: all 13 dimensions, findings, and verified evidence are required.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <input aria-label="Assessment title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Assessment title" className="rounded-lg border border-white/8 bg-black/20 p-3 text-sm text-white placeholder:text-slate-600" />
            <input aria-label="Next review date" type="date" value={nextReview} onChange={(event) => setNextReview(event.target.value)} className="rounded-lg border border-white/8 bg-black/20 p-3 text-sm text-white" />
            <textarea aria-label="Assessment scope" value={scope} onChange={(event) => setScope(event.target.value)} placeholder="Organization, sites, functions and time period in scope" className="min-h-24 rounded-lg border border-white/8 bg-black/20 p-3 text-sm text-white placeholder:text-slate-600" />
            <textarea aria-label="Evidence summary" value={evidenceSummary} onChange={(event) => setEvidenceSummary(event.target.value)} placeholder="Overall evidence basis and important limitations" className="min-h-24 rounded-lg border border-white/8 bg-black/20 p-3 text-sm text-white placeholder:text-slate-600" />
          </div>
          <div className="mt-5 grid gap-3 lg:grid-cols-2">
            {domains.map((domain) => (
              <div key={domain.domainKey} className="rounded-xl border border-white/6 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm font-semibold text-white" htmlFor={`score-${domain.domainKey}`}>{LABELS[domain.domainKey]}</label>
                  <select id={`score-${domain.domainKey}`} aria-label={`${LABELS[domain.domainKey]} score`} value={domain.score} onChange={(event) => updateDomain(domain.domainKey, { score: Number(event.target.value) })} className="rounded-lg border border-white/8 bg-[#111b28] p-2 text-xs text-white">
                    {SCALE.map((label, level) => <option key={label} value={level}>{level} — {label}</option>)}
                  </select>
                </div>
                <textarea aria-label={`${LABELS[domain.domainKey]} finding`} value={domain.finding} onChange={(event) => updateDomain(domain.domainKey, { finding: event.target.value })} placeholder="Specific observed practice, gap, and boundary" className="mt-3 min-h-20 w-full rounded-lg border border-white/8 bg-[#111b28] p-2 text-xs text-white placeholder:text-slate-600" />
                <select aria-label={`${LABELS[domain.domainKey]} evidence`} value={domain.evidenceItemId} onChange={(event) => updateDomain(domain.domainKey, { evidenceItemId: event.target.value })} className="mt-2 w-full rounded-lg border border-white/8 bg-[#111b28] p-2 text-xs text-white">
                  <option value="">Select independently verified evidence…</option>
                  {(evidence.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.description ?? item.id} · {item.source_system ?? "unknown source"}</option>)}
                </select>
              </div>
            ))}
          </div>
          <button
            disabled={busy || !complete}
            onClick={() => run(async () => {
              await recordOrganizationalMaturityAssessment({ title, scope, evidenceSummary, nextReview: nextReview || undefined, domains });
              setTitle(""); setScope(""); setEvidenceSummary(""); setNextReview(""); setDomains(emptyDomains());
            }, "Assessment submitted for independent review.")}
            className="mt-5 rounded-lg bg-cyan-500/15 px-5 py-3 text-sm font-semibold text-cyan-300 disabled:opacity-40"
          >
            Submit all 13 dimensions
          </button>
        </section>
      ) : (
        <p className="text-xs text-slate-500">This is a read-only view for your role. The server controls assessment and review authority.</p>
      )}
    </div>
  );
}
