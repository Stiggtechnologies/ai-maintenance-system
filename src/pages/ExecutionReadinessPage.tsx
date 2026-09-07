/**
 * Sync Develop — the Execution Readiness board (D13.09, spec III.§44; the
 * surface Workflow 4 names, D7.19), at /execution-readiness.
 *
 * WHAT IT ANSWERS: which work packages a person must act on, what is holding
 * each one, and whose it is.
 *
 * WHAT IT DOES NOT DO — and this is the whole design constraint. It computes
 * no readiness. Every sentence on this page is the server's:
 *
 *   * the READINESS SENTENCE per package is `sync_work_package_release_verdict`
 *     verbatim — the same predicate `release_work_package` refuses through and
 *     `get_case_work_packages` renders. Slice 7A shipped, and had to delete, a
 *     second weaker verdict living in a read path: the screen said "every hard
 *     constraint is cleared" over three states the door refuses. There is one
 *     verdict, and a board that recomputed it would be the eighth instance of
 *     this programme's signature defect — on the surface a supervisor acts on;
 *
 *   * the BLOCKING ITEMS are the open hard constraints with their owners, read
 *     from the store, not a client-side filter of a fuller set;
 *
 *   * the FIELD-READINESS position is the last RECORDED assessment
 *     (`calculation_runs`, D11.29), read back as it was written. A package
 *     nobody has assessed says exactly that, in its own row. "Not assessed" is
 *     not a blank and is not a zero — and an assessment the canonical stores
 *     have MOVED PAST is not a current position either: the server returns
 *     `stale` for it, this page wears it in red, and the gaps it names are the
 *     server's own, itemized by element and by job.
 *
 * REFUSAL-FIRST: an organization with no work packages gets the server's
 * refusal sentence, because an empty board reads as "nothing is waiting on
 * anybody" and that is a different fact from "nobody has packaged the work".
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ClipboardCheck, ExternalLink, RefreshCw } from "lucide-react";

import { AWP_ACRONYMS } from "../lib/develop/workPackaging";
import {
  getExecutionReadinessBoard,
  type ExecutionReadinessBoard,
  type ExecutionReadinessPackage,
} from "../services/developService";

/**
 * The verdicts this board can carry, and how each is worn.
 *
 * `ready_for_human` is amber, not green, and that is deliberate: the server's
 * own sentence for it ends "Release is a §70 human act and has not been
 * performed". A green badge would say the package is released when what it
 * means is that the package is waiting for a person.
 *
 * `released` and `cancelled` are NOT in this map, and that is not an omission:
 * the board returns draft packages only, so entries for those two would be
 * unreachable styling for states this surface cannot show. `verdictTone` falls
 * back rather than pretending to cover a state nobody can reach.
 */
const VERDICT_TONE: Record<string, string> = {
  ready_for_human: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  not_ready: "border-red-400/30 bg-red-400/10 text-red-200",
  // A package whose recorded assessment the stores have moved past reads RED,
  // not amber. It is not "waiting for a person": it is a position nobody has
  // re-checked, and the door refuses it.
  stale: "border-red-400/30 bg-red-400/10 text-red-200",
  unassessed: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  empty: "border-red-400/30 bg-red-400/10 text-red-200",
  parent_unreleased: "border-red-400/30 bg-red-400/10 text-red-200",
};

function verdictTone(verdict: string): string {
  return (
    VERDICT_TONE[verdict] ?? "border-white/10 bg-white/[0.02] text-slate-300"
  );
}

function PackageRow({ pkg }: { pkg: ExecutionReadinessPackage }) {
  return (
    <li className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="rounded bg-signal-cyan/10 px-1.5 py-0.5 text-[10px] font-semibold text-signal-cyan">
          L{pkg.level}{" "}
          {AWP_ACRONYMS[pkg.packageType as keyof typeof AWP_ACRONYMS]}
        </span>
        <span className="text-sm font-semibold text-slate-100">
          {pkg.packageCode} — {pkg.title}
        </span>
        <span
          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${verdictTone(
            pkg.readinessVerdict,
          )}`}
        >
          {pkg.readinessVerdict.replace(/_/g, " ")}
        </span>
        <span className="text-[11px] text-slate-500">
          {/* An undated package says so. A blank would read as "no deadline". */}
          required by {pkg.requiredBy ?? "no date stated"}
        </span>
        {pkg.caseId && (
          <Link
            to={`/develop/cases/${pkg.caseId}`}
            className="flex items-center gap-1 text-[11px] text-signal-cyan underline hover:text-signal-cyan/80"
          >
            {pkg.caseTitle ?? "case"}{" "}
            <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
        )}
      </div>

      {/* THE SERVER'S SENTENCE, VERBATIM. */}
      <p className="mt-1.5 text-xs text-slate-300">{pkg.readiness}</p>

      <p className="mt-1 text-[11px] text-slate-500">
        {pkg.workOrders} work order(s) · {pkg.constraintsRecorded} constraint(s)
        recorded · {pkg.openHard} hard and still open
      </p>

      {/* AN ASSESSMENT THAT NO LONGER DESCRIBES THE WORK IS NOT REASSURANCE.
          "Assessed on the 3rd" in quiet grey beside a verdict of `stale` is
          the exact reading this slice exists to prevent, so the note keeps its
          amber register whenever the server says the assessment is not a
          current position. */}
      <p
        className={`mt-1 text-[11px] ${
          pkg.fieldReadinessAssessed && pkg.readinessVerdict !== "stale"
            ? "text-slate-400"
            : "text-amber-200"
        }`}
      >
        {pkg.fieldReadinessNote}
      </p>

      {(pkg.fieldReadinessGaps ?? []).length > 0 && (
        <div className="mt-2">
          <span className="text-[11px] font-semibold text-slate-300">
            What the stores now say that the assessment does not
          </span>
          <ul className="mt-1 space-y-1">
            {(pkg.fieldReadinessGaps ?? []).map((gap) => (
              <li
                key={`${gap.workOrderId}-${gap.element}`}
                className="rounded border border-red-400/25 bg-red-400/5 px-2 py-1.5 text-[11px] text-red-200"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-semibold">
                    {gap.woNumber ?? "—"} · {gap.label}
                  </span>
                  <span className="uppercase tracking-wide text-slate-400">
                    {gap.reason.replace(/_/g, " ")}
                  </span>
                </div>
                <p className="mt-0.5 text-slate-300">{gap.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pkg.blockingItems.length > 0 && (
        <div className="mt-2">
          <span className="text-[11px] font-semibold text-slate-300">
            What is holding it, and whose it is
          </span>
          <ul className="mt-1 space-y-1">
            {pkg.blockingItems.map((item) => (
              <li
                key={item.constraintId}
                className="rounded border border-white/8 bg-white/[0.02] px-2 py-1.5 text-[11px] text-slate-300"
              >
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-semibold text-slate-200">
                    {item.kind}
                  </span>
                  <span className="uppercase tracking-wide text-slate-400">
                    {item.state}
                  </span>
                  <span className="text-slate-500">
                    owner {item.ownerEmail ?? item.ownerRole ?? "nobody named"}
                  </span>
                  <span className="text-slate-500">
                    {item.sourceKind === "derived"
                      ? "raised by the readiness assessment"
                      : "recorded by a person"}
                  </span>
                </div>
                <p className="mt-0.5">{item.description}</p>
                <p className="mt-0.5 text-slate-400">{item.basis}</p>
                <p className="mt-0.5 text-slate-500">
                  needed by {item.requiredBy ?? "no date stated"} · expected
                  clear {item.expectedClearDate ?? "not forecast"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}

export function ExecutionReadinessPage() {
  const [board, setBoard] = useState<ExecutionReadinessBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      setBoard(await getExecutionReadinessBoard(null));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const packages = board?.packages ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-slate-50">
            <ClipboardCheck className="h-4 w-4 text-signal-cyan" aria-hidden />
            Execution readiness
          </h1>
          <p className="text-xs text-slate-400">
            Every work package awaiting a release decision, the verdict the
            release door would give it, what is still holding it and whose that
            is. Nothing on this page is recomputed — the verdict is the one the
            door refuses through.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={busy}
          className="flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-40"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          {busy ? "Reading…" : "Refresh"}
        </button>
      </header>

      {error && (
        <div className="rounded border border-red-400/30 bg-red-400/10 px-2.5 py-2 text-xs whitespace-pre-wrap text-red-300">
          {error}
        </div>
      )}

      {/* THE REFUSAL, IN THE SERVER'S WORDS. Not an empty list. */}
      {board && !board.answered && (
        <div className="rounded border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
          {board.refusal}
        </div>
      )}

      {board?.answered && (
        <>
          {/* THE SERVER'S NOTE, ONCE. It was rendered in the empty branch AND
              again unconditionally below it, so a board answering with no
              DRAFT packages printed the same sentence twice — which reads as
              two findings about two different things. The note is placed in
              exactly one element here; the empty case only changes how it is
              framed, because a note standing alone with no list under it is
              the whole answer and should look like one. */}
          {packages.length === 0 ? (
            <p className="rounded border border-white/8 bg-white/[0.02] px-3 py-2 text-xs text-slate-300">
              {board.note}
            </p>
          ) : (
            <>
              <ul className="space-y-3">
                {packages.map((pkg) => (
                  <PackageRow key={pkg.packageId} pkg={pkg} />
                ))}
              </ul>
              <p className="text-xs text-slate-400">{board.note}</p>
            </>
          )}
          <p className="text-[11px] text-slate-500">{board.basis}</p>
        </>
      )}
    </div>
  );
}

export default ExecutionReadinessPage;
