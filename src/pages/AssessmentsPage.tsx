/**
 * The assessment list.
 *
 * RLS decides what appears here, not this component. A sponsor's account and
 * an engineer's account both run `select * from ria_assessments`; the tenancy
 * policy is what makes the results differ. That is deliberate — a list filtered
 * only in the browser is a list anyone can unfilter.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardCheck, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabase";

interface AssessmentRow {
  id: string;
  scope_label: string;
  status: string;
  commercial_model: string;
  started_on: string | null;
  target_end_on: string | null;
  primary_management_question: string | null;
}

export function AssessmentsPage() {
  const [rows, setRows] = useState<AssessmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: queryError } = await supabase
          .from("ria_assessments")
          .select(
            "id,scope_label,status,commercial_model,started_on,target_end_on,primary_management_question",
          )
          .order("created_at", { ascending: false });
        if (queryError) throw new Error(queryError.message);
        if (!cancelled) setRows((data ?? []) as AssessmentRow[]);
      } catch (caught) {
        if (!cancelled)
          setError(
            caught instanceof Error
              ? caught.message
              : "Assessments could not be loaded.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="p-6 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">
        Reliability Intelligence Assessment
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
        Assessments
      </h1>
      <p className="mt-3 max-w-3xl text-slate-400">
        Fixed-scope, export-based engagements. Each one carries its own data
        room, evidence, findings and 30/60/90-day verification.
      </p>

      {loading && (
        <p className="mt-8 text-slate-400" role="status">
          Loading assessments…
        </p>
      )}

      {error && (
        <div
          className="mt-8 rounded-xl border border-red-300/20 bg-red-300/5 p-5 text-sm text-red-200"
          role="alert"
        >
          {error}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <p className="mt-8 rounded-xl border border-dashed border-white/10 p-10 text-center text-slate-500">
          No assessment is activated for this organization. An assessment
          workspace is provisioned after scope and commercial acceptance.
        </p>
      )}

      <div className="mt-8 space-y-3">
        {rows.map((row) => (
          <Link
            key={row.id}
            to={`/assessments/${row.id}`}
            className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#0B151F] p-5 hover:border-teal-300/30"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-medium text-white">
                <ClipboardCheck size={15} className="text-teal-300" />
                {row.scope_label}
              </p>
              <p className="mt-1 truncate text-sm text-slate-500">
                {row.primary_management_question ??
                  "No primary management question agreed yet."}
              </p>
              <p className="mt-2 text-xs uppercase tracking-wider text-slate-600">
                {row.status.replaceAll("_", " ")}
                {row.target_end_on ? ` · target ${row.target_end_on}` : ""}
              </p>
            </div>
            <ChevronRight size={18} className="shrink-0 text-slate-600" />
          </Link>
        ))}
      </div>
    </main>
  );
}

export default AssessmentsPage;
