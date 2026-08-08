/**
 * ControlAssurance — internal auditing and records retention
 * (capability register E4.10, E4.08).
 *
 * The platform enforces several controls in the database. Nothing ever checked
 * that they still work. run_control_audit() does not assert that the triggers
 * exist — it ATTEMPTS the forbidden action and records whether the database
 * refused, then rolls the attempt back. That is behavioural evidence, and it
 * is what an auditor means by "control operating effectiveness".
 *
 * Three outcomes, kept distinct on purpose: passed, failed, and NOT EXERCISED.
 * Showing an untested control as green is the failure this panel exists to
 * prevent, so a skipped test says why it was skipped instead of scoring.
 */
import { useState } from "react";
import {
  ShieldCheck,
  Archive,
  CircleCheck,
  CircleX,
  CircleDashed,
} from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { supabase } from "../lib/supabase";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface TestResult {
  control: string;
  register_ref: string;
  exercised: boolean;
  passed: boolean | null;
  detail: string;
}

interface Policy {
  record_class: string;
  table_name: string;
  retain_years: number;
  status: string;
  legal_hold: boolean;
  records: number;
  beyond_policy: number;
  oldest_record: string | null;
  disposition: string;
  basis: string;
}

interface Assurance {
  role: string;
  can_run: boolean;
  latest_run: {
    run_at: string;
    tests_run: number;
    tests_passed: number;
    results: TestResult[];
  } | null;
  retention: { policies: Policy[]; note: string };
}

function Verdict({ passed }: { passed: boolean | null }) {
  if (passed === null)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-slate-400">
        <CircleDashed className="h-3.5 w-3.5" aria-hidden />
        Not exercised
      </span>
    );
  return passed ? (
    <span className="inline-flex items-center gap-1 text-xs text-green-300">
      <CircleCheck className="h-3.5 w-3.5" aria-hidden />
      Refused as designed
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs text-red-300">
      <CircleX className="h-3.5 w-3.5" aria-hidden />
      Control did not fire
    </span>
  );
}

export function ControlAssurance() {
  const [busy, setBusy] = useState(false);
  const { data, loading, error, refetch } =
    useAsyncData<Assurance>(async () => {
      const { data: r, error: e } = await supabase.rpc(
        "get_control_assurance",
        {},
      );
      if (e) throw new Error(e.message);
      return r as Assurance;
    }, []);

  async function runAudit() {
    setBusy(true);
    const { error: e } = await supabase.rpc("run_control_audit", {});
    setBusy(false);
    if (!e) refetch();
  }

  if (loading) return <LoadingState label="Loading control assurance" />;
  if (error) return <ErrorState message={error} onRetry={refetch} />;

  const run = data?.latest_run ?? null;
  const results = run?.results ?? [];
  const failed = results.filter((r) => r.passed === false).length;
  const skipped = results.filter((r) => r.passed === null).length;
  const policies = data?.retention.policies ?? [];

  return (
    <section aria-labelledby="assurance-heading" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            id="assurance-heading"
            className="flex items-center gap-2 text-lg font-semibold text-white"
          >
            <ShieldCheck className="h-5 w-5 text-signal-cyan" aria-hidden />
            Control Assurance
          </h2>
          <p className="mt-1 text-sm text-slate-300">
            Each enforced control is exercised by attempting the action it
            forbids. The attempt is rolled back; the refusal is the evidence.
          </p>
        </div>
        {data?.can_run && (
          <button
            onClick={runAudit}
            disabled={busy}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-cyan disabled:opacity-50"
          >
            {busy ? "Running…" : "Run internal audit"}
          </button>
        )}
      </div>

      {run === null ? (
        <p className="rounded-xl border border-white/6 bg-white/2 p-4 text-sm text-slate-400">
          No internal audit has been run. Until one is, the enforced controls
          are untested — a trigger that has silently stopped firing would go
          unnoticed.
        </p>
      ) : (
        <>
          <p className="text-xs text-slate-400">
            Last run {new Date(run.run_at).toLocaleString()} —{" "}
            <span className={failed > 0 ? "text-red-300" : "text-green-300"}>
              {run.tests_passed} of {run.tests_run} passed
            </span>
            {skipped > 0 && `, ${skipped} not exercised`}
            {failed > 0 && `, ${failed} FAILED`}.
          </p>
          <ul className="space-y-2">
            {results.map((r) => (
              <li
                key={r.control}
                className={`rounded-xl border p-3.5 ${
                  r.passed === false
                    ? "border-red-500/30 bg-red-500/5"
                    : "border-white/6 bg-overlook-deep/40"
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium text-slate-200">
                    {r.control}
                  </p>
                  <div className="flex items-center gap-2">
                    <Verdict passed={r.passed} />
                    <span className="font-mono text-[10px] text-slate-600">
                      {r.register_ref}
                    </span>
                  </div>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-slate-400">
                  {r.detail}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="pt-2">
        <h3 className="flex items-center gap-2 text-base font-semibold text-white">
          <Archive className="h-4.5 w-4.5 text-signal-gold" aria-hidden />
          Records retention
        </h3>
        <p className="mt-1 text-xs text-slate-400">{data?.retention.note}</p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-white/6">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <caption className="sr-only">
            Retention policy and live position by record class
          </caption>
          <thead className="bg-white/2 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">
                Record class
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Retain
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Records
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Beyond policy
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                Disposition
              </th>
            </tr>
          </thead>
          <tbody>
            {policies.map((p) => (
              <tr
                key={p.record_class}
                className="border-t border-white/6 align-top"
              >
                <td className="px-4 py-2.5">
                  <p className="font-medium text-slate-200">{p.record_class}</p>
                  <p className="font-mono text-[11px] text-slate-500">
                    {p.table_name}
                  </p>
                </td>
                <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums">
                  {p.retain_years} yr
                </td>
                <td className="px-4 py-2.5 font-mono text-slate-300 tabular-nums">
                  {p.records.toLocaleString()}
                </td>
                <td
                  className={`px-4 py-2.5 font-mono tabular-nums ${p.beyond_policy > 0 ? "text-amber-300" : "text-slate-500"}`}
                >
                  {p.beyond_policy}
                </td>
                <td className="px-4 py-2.5 text-xs text-slate-400">
                  {p.disposition}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
