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
import {
  adoptRetentionPolicy,
  recordRetentionReview,
  setRetentionLegalHold,
} from "../services/retentionGovernance";
import { LoadingState, ErrorState } from "./ui/AsyncStates";

interface TestResult {
  control: string;
  register_ref: string;
  exercised: boolean;
  passed: boolean | null;
  detail: string;
}

interface Policy {
  id: string;
  record_class: string;
  table_name: string;
  retain_years: number;
  status: string;
  legal_hold: boolean;
  legal_hold_reason: string | null;
  records: number;
  beyond_policy: number;
  oldest_record: string | null;
  disposition: string;
  basis: string;
  last_review_at: string | null;
  last_review_note: string | null;
  counted: boolean;
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
  can_govern_retention?: boolean;
  retention: { policies: Policy[]; note: string };
}

function formatWhen(value: string | null): string {
  if (!value) return "None";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function RetentionPolicyCard({
  policy,
  canGovern,
  onChanged,
}: {
  policy: Policy;
  canGovern: boolean;
  onChanged: () => void;
}) {
  const [years, setYears] = useState(String(policy.retain_years));
  const [basis, setBasis] = useState("");
  const [holdReason, setHoldReason] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const yearsId = `retention-years-${policy.id}`;
  const basisId = `retention-basis-${policy.id}`;
  const holdId = `retention-hold-${policy.id}`;
  const reviewId = `retention-review-${policy.id}`;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setBasis("");
      setHoldReason("");
      setReviewNote("");
      onChanged();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Retention act failed");
    } finally {
      setBusy(false);
    }
  }

  function submitPeriod() {
    const retainYears = Number(years);
    if (
      !Number.isFinite(retainYears) ||
      retainYears <= 0 ||
      retainYears > 10000
    ) {
      setMessage(
        "State a finite retention period in years greater than zero and at most 10000, the largest period this catalogue stores",
      );
      return;
    }
    if (basis.trim().length < 20) {
      setMessage(
        "State the organization's legal or corporate basis for this period (20 to 4000 characters)",
      );
      return;
    }
    void run(() =>
      adoptRetentionPolicy({
        policyId: policy.id,
        retainYears,
        basis: basis.trim(),
      }),
    );
  }

  function submitHold() {
    if (holdReason.trim().length < 20) {
      setMessage(
        "State why the legal hold is placed or released (20 to 4000 characters)",
      );
      return;
    }
    void run(() =>
      setRetentionLegalHold({
        policyId: policy.id,
        hold: !policy.legal_hold,
        reason: holdReason.trim(),
      }),
    );
  }

  function submitReview() {
    if (reviewNote.trim().length < 20) {
      setMessage(
        "State what the review decided (20 to 4000 characters). A review does not destroy records",
      );
      return;
    }
    void run(() =>
      recordRetentionReview({
        policyId: policy.id,
        note: reviewNote.trim(),
      }),
    );
  }

  return (
    <article className="border-t border-white/6 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium text-slate-200">
            {policy.record_class}
          </h4>
          <p className="font-mono text-[11px] text-slate-500">
            {policy.table_name}
          </p>
        </div>
        <p className="text-xs uppercase tracking-wide text-slate-400">
          {policy.status}
          {policy.legal_hold ? " · legal hold" : ""}
        </p>
      </div>
      <dl className="mt-2 grid gap-2 text-xs text-slate-300 sm:grid-cols-4">
        <div>
          <dt className="text-slate-500">Retain</dt>
          <dd className="font-mono tabular-nums">{policy.retain_years} yr</dd>
        </div>
        <div>
          <dt className="text-slate-500">Records</dt>
          <dd className="font-mono tabular-nums">
            {policy.records.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Beyond policy</dt>
          <dd
            className={`font-mono tabular-nums ${policy.beyond_policy > 0 ? "text-amber-300" : "text-slate-400"}`}
          >
            {policy.beyond_policy.toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Oldest record</dt>
          <dd>{formatWhen(policy.oldest_record)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">
        {policy.disposition}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">
        {policy.basis}
      </p>
      {policy.legal_hold && policy.legal_hold_reason && (
        <p className="mt-1 text-xs text-amber-200/90">
          Hold: {policy.legal_hold_reason}
        </p>
      )}
      {policy.last_review_at && (
        <p className="mt-1 text-xs text-slate-400">
          Last review {formatWhen(policy.last_review_at)}
          {policy.last_review_note ? ` — ${policy.last_review_note}` : ""}
        </p>
      )}
      {canGovern && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 md:grid-cols-[8rem_1fr_auto] md:items-end">
            <div>
              <label
                htmlFor={yearsId}
                className="text-[11px] uppercase tracking-wide text-slate-500"
              >
                Years for {policy.record_class}
              </label>
              <input
                id={yearsId}
                type="number"
                min={0.01}
                max={10000}
                step="any"
                value={years}
                onChange={(event) => setYears(event.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-sm text-slate-100"
              />
            </div>
            <div>
              <label
                htmlFor={basisId}
                className="text-[11px] uppercase tracking-wide text-slate-500"
              >
                Basis for {policy.record_class}
              </label>
              <textarea
                id={basisId}
                value={basis}
                onChange={(event) => setBasis(event.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
              />
            </div>
            <button
              type="button"
              onClick={submitPeriod}
              disabled={busy}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-cyan disabled:opacity-50"
            >
              {policy.status === "draft"
                ? `Adopt retention period for ${policy.record_class}`
                : `Revise retention period for ${policy.record_class}`}
            </button>
          </div>
          <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <label
                htmlFor={holdId}
                className="text-[11px] uppercase tracking-wide text-slate-500"
              >
                Legal hold reason for {policy.record_class}
              </label>
              <textarea
                id={holdId}
                value={holdReason}
                onChange={(event) => setHoldReason(event.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
              />
            </div>
            <button
              type="button"
              onClick={submitHold}
              disabled={busy}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-cyan disabled:opacity-50"
            >
              {policy.legal_hold
                ? `Release legal hold for ${policy.record_class}`
                : `Place legal hold for ${policy.record_class}`}
            </button>
          </div>
          {policy.status === "adopted" && (
            <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
              <div>
                <label
                  htmlFor={reviewId}
                  className="text-[11px] uppercase tracking-wide text-slate-500"
                >
                  Review note for {policy.record_class}
                </label>
                <textarea
                  id={reviewId}
                  value={reviewNote}
                  onChange={(event) => setReviewNote(event.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-slate-100"
                />
              </div>
              <button
                type="button"
                onClick={submitReview}
                disabled={busy}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/10 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-signal-cyan disabled:opacity-50"
              >
                Record retention review for {policy.record_class}
              </button>
            </div>
          )}
        </div>
      )}
      {message && (
        <p role="alert" className="mt-2 text-xs text-amber-200">
          {message}
        </p>
      )}
    </article>
  );
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

      <div className="overflow-hidden rounded-xl border border-white/6">
        {policies.length === 0 ? (
          <p className="px-4 py-3 text-sm text-slate-400">
            No retention catalogue is visible for this organization.
          </p>
        ) : (
          policies.map((policy) => (
            <RetentionPolicyCard
              key={policy.id}
              policy={policy}
              canGovern={data?.can_govern_retention === true}
              onChanged={refetch}
            />
          ))
        )}
      </div>
    </section>
  );
}
