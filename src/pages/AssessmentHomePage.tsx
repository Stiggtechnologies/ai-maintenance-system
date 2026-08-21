/**
 * Assessment Home — §4 of the workspace specification: status, scope, sponsor,
 * timeline, readiness rollup, major findings and upcoming decisions.
 *
 * The readiness figure here is deliberately not a percentage. The intake pack's
 * acceptance test has four named conditions, so those four are shown, and
 * "data-ready" means all four — no partial credit.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  CircleCheck,
  ShieldCheck,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../components/AuthProvider";
import { DataRoom } from "../components/assessment/DataRoom";
import { RiaAnalysisWorkbench } from "../components/assessment/RiaAnalysisWorkbench";
import { type ReadinessRollup, loadReadiness } from "../services/riaDataRoom";

interface AssessmentRecord {
  id: string;
  organization_id: string;
  name: string;
  scope_label: string;
  status: string;
  commercial_model: string;
  sponsor_user_id: string | null;
  started_on: string | null;
  target_end_on: string | null;
  source_retention_until: string | null;
  primary_management_question: string | null;
  scope_confirmed_at: string | null;
  notes: string | null;
}

interface MajorFinding {
  id: string;
  title: string;
  severity: string;
  evidence_grade: string;
}

interface UpcomingDecision {
  id: string;
  decision_required: string;
  authority_role: string;
  boundary: string;
  due_on: string | null;
  status: string;
}

const SUPPLY_ROLES = new Set([
  "planner",
  "reliability_engineer",
  "maintenance_manager",
  "admin",
  "ai_admin",
  "assessment_sponsor",
]);

const RATE_ROLES = new Set([
  "reliability_engineer",
  "maintenance_manager",
  "admin",
  "ai_admin",
]);

function Fact({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof UserRound;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0B151F] p-5">
      <p className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500">
        <Icon size={13} />
        {label}
      </p>
      <p className="mt-2 text-sm font-medium leading-6 text-white">{value}</p>
    </div>
  );
}

export function AssessmentHomePage() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const { profile } = useAuth();
  const [assessment, setAssessment] = useState<AssessmentRecord | null>(null);
  const [sponsorName, setSponsorName] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<ReadinessRollup | null>(null);
  const [majorFindings, setMajorFindings] = useState<MajorFinding[]>([]);
  const [upcomingDecisions, setUpcomingDecisions] = useState<
    UpcomingDecision[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const role = (profile?.role as string) ?? "";
  const canSupply = SUPPLY_ROLES.has(role);
  const canRate = RATE_ROLES.has(role);

  useEffect(() => {
    if (!assessmentId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error: queryError } = await supabase
          .from("ria_assessments")
          .select("*")
          .eq("id", assessmentId)
          .maybeSingle();
        if (queryError) throw new Error(queryError.message);
        if (!data)
          throw new Error(
            "No assessment with that identifier is visible to your account.",
          );
        if (cancelled) return;
        const record = data as AssessmentRecord;
        setAssessment(record);

        if (record.sponsor_user_id) {
          const { data: sponsor } = await supabase
            .from("user_profiles")
            .select("full_name,email")
            .eq("id", record.sponsor_user_id)
            .maybeSingle();
          if (!cancelled && sponsor)
            setSponsorName(
              (sponsor as { full_name?: string; email?: string }).full_name ??
                (sponsor as { email?: string }).email ??
                null,
            );
        }
        const rollup = await loadReadiness(assessmentId);
        if (!cancelled) setReadiness(rollup);

        const { data: findings } = await supabase
          .from("ria_findings")
          .select("id,title,severity,evidence_grade")
          .eq("assessment_id", assessmentId)
          .eq("review_state", "published")
          .in("severity", ["critical", "high"])
          .order("severity");
        if (!cancelled) setMajorFindings((findings ?? []) as MajorFinding[]);

        const { data: decisions } = await supabase
          .from("ria_decisions")
          .select("id,decision_required,authority_role,boundary,due_on,status")
          .eq("assessment_id", assessmentId)
          .in("status", ["pending", "changes_requested"])
          .order("due_on", { nullsFirst: false });
        if (!cancelled)
          setUpcomingDecisions((decisions ?? []) as UpcomingDecision[]);
      } catch (caught) {
        if (!cancelled)
          setError(
            caught instanceof Error
              ? caught.message
              : "The assessment could not be loaded.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assessmentId]);

  const timeline = useMemo(() => {
    if (!assessment) return "";
    const start = assessment.started_on ?? "not started";
    const end = assessment.target_end_on ?? "no target date";
    return `${start} → ${end}`;
  }, [assessment]);

  if (loading)
    return (
      <p className="p-8 text-slate-400" role="status">
        Loading the assessment…
      </p>
    );

  if (error || !assessment)
    return (
      <div className="p-8">
        <div
          className="rounded-xl border border-red-300/20 bg-red-300/5 p-6 text-sm text-red-200"
          role="alert"
        >
          {error || "Assessment unavailable."}
        </div>
        <Link
          to="/assessments"
          className="mt-5 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"
        >
          <ArrowLeft size={14} />
          All assessments
        </Link>
      </div>
    );

  return (
    <main className="p-6 sm:p-8">
      <Link
        to="/assessments"
        className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"
      >
        <ArrowLeft size={14} />
        All assessments
      </Link>

      <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">
        Reliability Intelligence Assessment
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">
        {assessment.scope_label}
      </h1>
      <p className="mt-3 text-sm text-slate-500">
        {assessment.commercial_model}
      </p>

      {assessment.primary_management_question ? (
        <blockquote className="mt-6 max-w-3xl border-l-2 border-teal-300/40 pl-4 text-lg leading-8 text-slate-200">
          {assessment.primary_management_question}
        </blockquote>
      ) : (
        <p className="mt-6 flex items-start gap-2 text-sm text-amber-200">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" />
          No primary management question has been agreed. The intake pack makes
          agreeing one a precondition of kickoff.
        </p>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Fact
          icon={ShieldCheck}
          label="Status"
          value={assessment.status.replaceAll("_", " ")}
        />
        <Fact
          icon={UserRound}
          label="Sponsor"
          value={sponsorName ?? "Not assigned"}
        />
        <Fact icon={CalendarDays} label="Timeline" value={timeline} />
        <Fact
          icon={CircleCheck}
          label="Kickoff"
          value={
            readiness
              ? readiness.kickoff_data_ready
                ? "Data-ready"
                : "Not yet data-ready"
              : "Readiness unavailable"
          }
        />
      </div>

      {assessment.source_retention_until && (
        <p className="mt-4 text-xs text-slate-500">
          Source retention until {assessment.source_retention_until}. Retiring a
          source writes its audit stub — file name, fingerprint, who retired it
          and why — and then purges the raw export. Each source card states
          which of the two has actually happened; the stub survives either way.
        </p>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="major-findings-heading">
          <h2
            id="major-findings-heading"
            className="text-xl font-semibold text-white"
          >
            Major findings
          </h2>
          <p className="mt-2 text-xs text-slate-500">
            Published findings only. A draft or reviewed finding has not passed
            the publication gate and is not shown here.
          </p>
          <div className="mt-4 space-y-2">
            {majorFindings.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-500">
                No published findings yet.
              </p>
            ) : (
              majorFindings.map((finding) => (
                <div
                  key={finding.id}
                  className="rounded-lg border border-white/10 p-3"
                  data-testid={`major-finding-${finding.id}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${
                        finding.severity === "critical"
                          ? "border-red-300/25 bg-red-300/10 text-red-200"
                          : "border-amber-300/25 bg-amber-300/10 text-amber-200"
                      }`}
                    >
                      {finding.severity}
                    </span>
                    <span className="text-xs text-slate-500">
                      {finding.evidence_grade.replaceAll("_", " ")}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-white">{finding.title}</p>
                </div>
              ))
            )}
          </div>
        </section>

        <section aria-labelledby="upcoming-decisions-heading">
          <h2
            id="upcoming-decisions-heading"
            className="text-xl font-semibold text-white"
          >
            Upcoming decisions
          </h2>
          <p className="mt-2 text-xs text-slate-500">
            Every decision names the authority that may take it and the boundary
            it may be taken within. Both are constraint-required.
          </p>
          <div className="mt-4 space-y-2">
            {upcomingDecisions.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-500">
                No decisions are outstanding.
              </p>
            ) : (
              upcomingDecisions.map((decision) => (
                <div
                  key={decision.id}
                  className="rounded-lg border border-white/10 p-3"
                  data-testid={`upcoming-decision-${decision.id}`}
                >
                  <p className="text-sm text-white">
                    {decision.decision_required}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {decision.authority_role} · within {decision.boundary}
                    {decision.due_on ? ` · due ${decision.due_on}` : ""}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <hr className="my-10 border-white/10" />

      <DataRoom
        assessmentId={assessment.id}
        organizationId={assessment.organization_id}
        canSupply={canSupply}
        canRate={canRate}
      />

      <hr className="my-10 border-white/10" />

      <RiaAnalysisWorkbench
        assessmentId={assessment.id}
        currentStatus={assessment.status}
        role={role}
      />
    </main>
  );
}

export default AssessmentHomePage;
