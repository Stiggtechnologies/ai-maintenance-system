/**
 * FailureCoding — what the source vocabulary actually contains, and how much
 * of it has been coded to a real failure mechanism
 * (capability register C2.03).
 *
 * `actual_failure_mode` on 6,000 work orders holds three different kinds of
 * value: system groups, planned-activity types and delay reasons. That is not
 * a fault in the CMMS — a downtime-coding vocabulary is doing its job, and it
 * is genuinely useful for Pareto and bad-actor work. It simply is not a
 * failure mechanism.
 *
 * The platform never infers one from the other. Deriving "bearing spalling"
 * from "Engine Group" would fabricate the single most consequential field in
 * reliability analysis. Each system group offers CANDIDATES; a person codes
 * the record; the coded percentage below is what has actually been determined.
 */
import { Tags, TriangleAlert } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface VocabRow {
  label_kind: string;
  labels: number;
  work_orders: number;
}

interface UncodedGroup {
  system_group: string;
  work_orders: number;
  candidate_mechanisms: number;
}

interface Payload {
  vocabulary: VocabRow[];
  corrective_work_orders: number;
  mechanism_coded: number;
  mechanism_coded_pct: number | null;
  corrective_with_non_equipment_label: number;
  top_uncoded_system_groups: UncodedGroup[];
  unclassified_labels: string[];
  note: string;
}

const KIND_LABEL: Record<string, string> = {
  system_group: "System groups — equipment",
  activity_type: "Activity types — planned work",
  delay_reason: "Delay reasons — not equipment failures",
  mechanism: "True failure mechanisms",
  unclassified: "Unclassified — review needed",
};

const KIND_STYLE: Record<string, string> = {
  system_group: "text-slate-200",
  activity_type: "text-amber-300",
  delay_reason: "text-amber-300",
  mechanism: "text-green-300",
  unclassified: "text-red-300",
};

export function FailureCoding() {
  const { data, loading, error, refetch } = useAsyncData<Payload>(async () => {
    const { data: r, error: e } = await supabase.rpc(
      "get_failure_coding_position",
      {},
    );
    if (e) throw new Error(e.message);
    return r as Payload;
  }, []);

  if (loading) return <LoadingState label="Loading failure-coding position" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const vocab = data?.vocabulary ?? [];
  const uncoded = data?.top_uncoded_system_groups ?? [];
  const unclassified = data?.unclassified_labels ?? [];

  return (
    <section aria-labelledby="coding-heading" className="space-y-4">
      <div>
        <h2
          id="coding-heading"
          className="flex items-center gap-2 text-lg font-semibold text-white"
        >
          <Tags className="h-5 w-5 text-signal-gold" aria-hidden />
          Failure Coding
          <span className="text-xs font-normal text-slate-500">
            {data?.mechanism_coded} of{" "}
            {data?.corrective_work_orders?.toLocaleString()} coded to a
            mechanism
          </span>
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">{data?.note}</p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/6">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <caption className="sr-only">
            What the source coding vocabulary actually contains
          </caption>
          <thead className="bg-white/2 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Kind of value
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Distinct labels
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Work orders
              </th>
            </tr>
          </thead>
          <tbody>
            {vocab.map((v) => (
              <tr key={v.label_kind} className="border-t border-white/6">
                <td className={`px-4 py-2.5 ${KIND_STYLE[v.label_kind]}`}>
                  {KIND_LABEL[v.label_kind] ?? v.label_kind}
                </td>
                <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums">
                  {v.labels}
                </td>
                <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums">
                  {Number(v.work_orders).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(data?.corrective_with_non_equipment_label ?? 0) > 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200/90">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <strong>
              {data?.corrective_with_non_equipment_label.toLocaleString()}
            </strong>{" "}
            corrective work orders carry a planned-activity or delay label
            rather than an equipment one. They are excluded from mechanism
            analysis rather than silently counted as failures — the count is
            shown so the size of the recoding job is visible.
          </span>
        </p>
      )}

      {unclassified.length > 0 && (
        <p className="rounded-xl border border-red-500/25 bg-red-500/5 p-3 text-xs text-red-200/90">
          {unclassified.length} label(s) appear in history but not in the
          reviewed vocabulary: {unclassified.join(", ")}. Classify before use.
        </p>
      )}

      <div>
        <h3 className="text-base font-semibold text-white">
          Largest uncoded system groups
        </h3>
        <p className="mt-1 text-xs text-slate-400">
          Where coding effort buys the most analysis. Each group offers
          candidate mechanisms drawn from the detectability matrix — a shortlist
          for the person coding, never an assignment.
        </p>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {uncoded.map((g) => (
          <li
            key={g.system_group}
            className="flex items-baseline justify-between gap-3 rounded-xl border border-white/6 bg-overlook-deep/40 p-3.5"
          >
            <div>
              <p className="text-sm text-slate-200">{g.system_group}</p>
              <p className="text-xs text-slate-500">
                {g.candidate_mechanisms > 0
                  ? `${g.candidate_mechanisms} candidate mechanisms`
                  : "No candidate shortlist yet"}
              </p>
            </div>
            <span className="font-mono text-sm text-slate-300 tabular-nums">
              {g.work_orders.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
