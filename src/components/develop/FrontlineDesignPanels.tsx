/**
 * Sync Develop Slice 5B — the frontline design review, the six-axis
 * scorecard, and the §19 interface register.
 *
 *   D4.10  spec I.25: maintenance, operations and construction review the
 *          design across eight named dimensions BEFORE it is built, and who
 *          was in the room is recorded by name — the participation flags on
 *          design_studies are derived from these rows, so a review with an
 *          empty roster cannot claim otherwise.
 *   D4.11  the disposition: accepted / rejected / accepted with conditions,
 *          in the answerer's own name, with a reason mandatory on every
 *          outcome. THIS is the accountability record, and it is consequential
 *          — an unanswered recommendation is a gate blocker on the same
 *          machinery a broken permit condition rides.
 *   D4.12  spec I.26's six axes. The composite REFUSES while any axis is
 *          unscored and names the axis; it never averages the ones it has.
 *   D4.18  spec III.§19's seven interface types, traversed by the SHARED
 *          dependency arithmetic rather than a second one.
 *
 * THE SURFACE CONVENTION, unchanged from 5A: a REFUSAL is an answer and is
 * rendered as prose, never as an error and never as a zero. Every number here
 * comes off the server; where the server refused to compute one, the panel
 * says so instead of printing 0.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { GitCompareArrows, HardHat, Gauge } from "lucide-react";

import {
  DESIGN_AXES,
  DESIGN_AXIS_SCALE,
  DISPOSITION_DISCIPLINES,
  DISPOSITION_OUTCOMES,
  FINDING_SEVERITIES,
  FRONTLINE_DIMENSIONS,
  FRONTLINE_DISCIPLINES,
  latestDisposition,
  readDesignScorecard,
  readFrontlineReview,
  type DesignScorecardPayload,
  type FrontlineFinding,
  type FrontlineReviewPayload,
} from "../../lib/design";
import {
  INTERFACE_STATUSES,
  INTERFACE_TYPES,
  readInterfaceExposure,
  type InterfaceGraphPayload,
} from "../../lib/develop/interfaces";
import {
  addDesignStudyParticipant,
  carryDesignFindingToRequirement,
  computeCaseDesignScorecard,
  getCaseDesignScorecard,
  dispositionDesignFinding,
  getCaseFrontlineReview,
  getCaseInterfaceGraph,
  listBindableAssets,
  listCaseRequirements,
  raiseDesignReviewFinding,
  recordCaseDesignStudy,
  recordCaseInterface,
  scoreDesignAxis,
  setCaseInterfaceStatus,
} from "../../services/developService";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";
const btnClass =
  "rounded-lg bg-signal-cyan/15 px-3 py-1.5 text-xs font-semibold text-signal-cyan hover:bg-signal-cyan/25 disabled:opacity-40";

function Section({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
      </div>
      <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
      <div className="mt-3 space-y-3">{children}</div>
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded border border-red-400/30 bg-red-400/10 px-2.5 py-1.5 text-xs text-red-300">
      {error}
    </div>
  );
}

/** A refusal is an ANSWER, so it is rendered as prose and never as an error. */
function Refusal({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <div className="rounded border border-amber-400/25 bg-amber-400/5 px-2.5 py-1.5 text-xs text-amber-200">
      {text}
    </div>
  );
}

const OUTCOME_TONE: Record<string, string> = {
  accepted: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  accepted_with_conditions: "border-amber-400/25 bg-amber-400/5 text-amber-200",
  rejected: "border-slate-400/25 bg-white/[0.03] text-slate-300",
};

const label = (
  list: readonly { key: string; label: string }[],
  key: string,
): string => list.find((x) => x.key === key)?.label ?? key;

/**
 * 5B-R7. An acceptance "carried" by a requirement that failed verification (or
 * was waived) is exactly as unbuilt as an uncarried one — the link discharges
 * nothing and the gate still refuses over it. Rendering the ref without the
 * state made the failure invisible on the one screen that reports it.
 */
const carrierFailed = (f: FrontlineFinding): boolean =>
  f.requirementVerification === "failed" ||
  f.requirementVerification === "waived";

export function FrontlineDesignPanel({
  caseId,
  members,
  canPlan,
  canFrontline,
  reloadKey,
}: {
  caseId: string;
  members: { id: string; name: string }[];
  /**
   * Planning acts: recording a study, carrying an acceptance into a
   * requirement, scoring an axis, recording and moving an interface. Matches
   * those RPCs' own role sets.
   */
  canPlan: boolean;
  /**
   * FRONTLINE acts: attending, raising a recommendation, dispositioning one
   * (5B-R10). These RPCs admit `supervisor` and `technician` BY NAME — this
   * slice is the only place in the migration tree that does — because a design
   * review whose findings only a manager may type is not a frontline design
   * review. Gating them on `canPlan` hid every one of them from exactly the
   * people D4.10 exists to give a voice, while showing all of them to
   * `ai_admin`, whose every submission §70 refuses by name.
   */
  canFrontline: boolean;
  reloadKey?: number;
}) {
  const [review, setReview] = useState<FrontlineReviewPayload | null>(null);
  const [scorecard, setScorecard] = useState<DesignScorecardPayload | null>(
    null,
  );
  const [interfaces, setInterfaces] = useState<InterfaceGraphPayload | null>(
    null,
  );
  const [requirements, setRequirements] = useState<
    { id: number; requirement_ref: string; requirement: string }[]
  >([]);
  const [assets, setAssets] = useState<
    { id: string; name: string; tag: string | null }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const [studyForm, setStudyForm] = useState({
    studyKind: "frontline_design_review",
    summary: "",
    performedOn: "",
  });
  const [participantFor, setParticipantFor] = useState<number | null>(null);
  const [participantForm, setParticipantForm] = useState({
    participantId: "",
    discipline: "maintenance",
    basis: "",
  });
  const [findingFor, setFindingFor] = useState<number | null>(null);
  const [findingForm, setFindingForm] = useState({
    findingRef: "",
    dimension: "accessibility",
    recommendation: "",
    severity: "significant",
    raisedBy: "",
    discipline: "",
  });
  const [dispositionFor, setDispositionFor] = useState<number | null>(null);
  const [dispositionForm, setDispositionForm] = useState({
    outcome: "accepted",
    reason: "",
    discipline: "maintenance",
    conditions: "",
  });
  const [carryFor, setCarryFor] = useState<number | null>(null);
  const [carryRequirement, setCarryRequirement] = useState("");
  const [scoreForm, setScoreForm] = useState({
    axis: "design_readiness",
    score: "3",
    basis: "",
  });
  const [interfaceForm, setInterfaceForm] = useState({
    interfaceRef: "",
    sourceObject: "",
    targetObject: "",
    interfaceType: "physical",
    ownerId: "",
    requirement: "",
    dueDate: "",
    sourceAssetId: "",
    targetAssetId: "",
  });
  const [statusFor, setStatusFor] = useState<number | null>(null);
  const [statusForm, setStatusForm] = useState({ status: "agreed", note: "" });

  const load = useCallback(async () => {
    setError(null);
    try {
      // THE READ, not the compute (5B-R9). `compute_case_design_scorecard`
      // appends a calculation_runs row on every call and carries a narrower
      // role set than the read, so calling it here logged a lineage row per
      // page view AND made the whole panel — review, interfaces, everything —
      // throw for a supervisor or a technician, the two roles this feature
      // exists for. Recording a run is an act behind a button, as it is in
      // every other develop panel.
      const [r, s, i, q, a] = await Promise.all([
        getCaseFrontlineReview(caseId),
        getCaseDesignScorecard(caseId),
        getCaseInterfaceGraph(caseId),
        listCaseRequirements(caseId),
        listBindableAssets(),
      ]);
      setReview(r);
      setScorecard(s);
      setInterfaces(i);
      setRequirements(q);
      setAssets(a);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const out = (await fn()) as { note?: string } | undefined;
      if (out && typeof out === "object" && typeof out.note === "string") {
        setNote(out.note);
      }
      after?.();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reading = useMemo(
    () => (review ? readFrontlineReview(review) : null),
    [review],
  );
  const card = useMemo(
    () => (scorecard ? readDesignScorecard(scorecard) : null),
    [scorecard],
  );
  const exposure = useMemo(
    () => (interfaces ? readInterfaceExposure(interfaces) : null),
    [interfaces],
  );

  const findingRow = (f: FrontlineFinding) => {
    const d = latestDisposition(f);
    return (
      <div
        key={f.id}
        className="rounded border border-white/8 bg-white/[0.02] px-3 py-2"
      >
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono text-slate-300">{f.findingRef}</span>
          <span className="rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-slate-400">
            {label(FRONTLINE_DIMENSIONS, f.dimension)}
          </span>
          <span className="rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-slate-400">
            {label(FRONTLINE_DISCIPLINES, f.discipline)}
          </span>
          <span className="text-[11px] text-slate-500">{f.severity}</span>
          {d ? (
            <span
              className={`rounded border px-1.5 py-0.5 text-[11px] ${OUTCOME_TONE[d.outcome] ?? ""}`}
            >
              {label(DISPOSITION_OUTCOMES, d.outcome)} — {d.by} (
              {label(DISPOSITION_DISCIPLINES, d.discipline)})
            </span>
          ) : (
            <span className="rounded border border-red-400/30 bg-red-400/10 px-1.5 py-0.5 text-[11px] text-red-200">
              unanswered — blocks every gate on this case
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-300">{f.recommendation}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          Raised by {f.raisedBy}
          {/* 5B-R3: the scribe is shown only when it differs, so recording for
              the room stays ordinary and a proxy attribution stays visible. */}
          {f.byProxy && f.recordedBy ? (
            <span className="text-amber-200/80">
              {" "}
              · recorded for them by {f.recordedBy}
            </span>
          ) : null}
          {f.requirementRef ? (
            carrierFailed(f) ? (
              <span className="text-red-200">
                {" "}
                · carried by {f.requirementRef}, which is{" "}
                {f.requirementVerification} — that carries nothing, and the gate
                still refuses over it
              </span>
            ) : (
              ` · carried by ${f.requirementRef}${
                f.requirementVerification
                  ? ` (${f.requirementVerification})`
                  : ""
              }`
            )
          ) : d && d.outcome !== "rejected" ? (
            " · no design requirement carries it yet"
          ) : (
            ""
          )}
        </p>
        {d ? (
          <p className="mt-1 text-[11px] text-slate-400">
            <span className="text-slate-500">Reason:</span> {d.reason}
            {d.conditions ? (
              <>
                {" "}
                <span className="text-slate-500">Conditions:</span>{" "}
                {d.conditions}
              </>
            ) : null}
            {f.dispositions.length > 1
              ? ` · ${f.dispositions.length} dispositions recorded; the earlier ones stay visible`
              : ""}
          </p>
        ) : null}

        {canFrontline || canPlan ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {/* Dispositioning is a FRONTLINE act — the RPC admits supervisor
                and technician by name. Carrying it into a requirement is a
                planning act, and its RPC does not. */}
            {canFrontline ? (
              <button
                className={btnClass}
                onClick={() =>
                  setDispositionFor(dispositionFor === f.id ? null : f.id)
                }
              >
                {d
                  ? "Revise the disposition"
                  : "Disposition this recommendation"}
              </button>
            ) : null}
            {canPlan && d && d.outcome !== "rejected" && !f.requirementId ? (
              <button
                className={btnClass}
                onClick={() => setCarryFor(carryFor === f.id ? null : f.id)}
              >
                Carry it into a requirement
              </button>
            ) : null}
          </div>
        ) : null}

        {dispositionFor === f.id ? (
          <div className="mt-2 space-y-2 rounded border border-white/10 bg-black/20 p-2">
            <p className="text-[11px] text-slate-500">
              You record this in your own name, and you cannot answer a finding
              you raised yourself. The reason is mandatory on every outcome — an
              acceptance nobody explained is a promise nobody can check.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select
                className={inputClass}
                value={dispositionForm.outcome}
                onChange={(e) =>
                  setDispositionForm({
                    ...dispositionForm,
                    outcome: e.target.value,
                  })
                }
              >
                {DISPOSITION_OUTCOMES.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                className={inputClass}
                value={dispositionForm.discipline}
                onChange={(e) =>
                  setDispositionForm({
                    ...dispositionForm,
                    discipline: e.target.value,
                  })
                }
              >
                {DISPOSITION_DISCIPLINES.map((d2) => (
                  <option key={d2.key} value={d2.key}>
                    Answering for {d2.label}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              className={inputClass}
              rows={2}
              placeholder="Why (20 characters minimum) — this is the record somebody reads in five years"
              value={dispositionForm.reason}
              onChange={(e) =>
                setDispositionForm({
                  ...dispositionForm,
                  reason: e.target.value,
                })
              }
            />
            {dispositionForm.outcome === "accepted_with_conditions" ? (
              <textarea
                className={inputClass}
                rows={2}
                placeholder="The conditions the acceptance depends on"
                value={dispositionForm.conditions}
                onChange={(e) =>
                  setDispositionForm({
                    ...dispositionForm,
                    conditions: e.target.value,
                  })
                }
              />
            ) : null}
            <button
              className={btnClass}
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    dispositionDesignFinding(f.id, {
                      outcome: dispositionForm.outcome,
                      reason: dispositionForm.reason,
                      discipline: dispositionForm.discipline,
                      conditions:
                        dispositionForm.outcome === "accepted_with_conditions"
                          ? dispositionForm.conditions
                          : undefined,
                    }),
                  () => {
                    setDispositionFor(null);
                    setDispositionForm({
                      outcome: "accepted",
                      reason: "",
                      discipline: "maintenance",
                      conditions: "",
                    });
                  },
                )
              }
            >
              Record the disposition
            </button>
          </div>
        ) : null}

        {carryFor === f.id ? (
          <div className="mt-2 space-y-2 rounded border border-white/10 bg-black/20 p-2">
            <select
              className={inputClass}
              value={carryRequirement}
              onChange={(e) => setCarryRequirement(e.target.value)}
            >
              <option value="">
                Which requirement carries this recommendation?
              </option>
              {requirements.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.requirement_ref} — {r.requirement.slice(0, 70)}
                </option>
              ))}
            </select>
            <button
              className={btnClass}
              disabled={busy || !carryRequirement}
              onClick={() =>
                void run(
                  () =>
                    carryDesignFindingToRequirement(
                      f.id,
                      Number(carryRequirement),
                    ),
                  () => {
                    setCarryFor(null);
                    setCarryRequirement("");
                  },
                )
              }
            >
              Carry it
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <ErrorLine error={error} />
      {note ? (
        <div className="rounded border border-signal-cyan/25 bg-signal-cyan/5 px-2.5 py-1.5 text-xs text-signal-cyan">
          {note}
        </div>
      ) : null}

      {/* ── D4.10 / D4.11 ─────────────────────────────────────────────── */}
      <Section
        icon={<HardHat className="h-4 w-4 text-signal-cyan" />}
        title="Frontline design review"
        subtitle="Spec I.25 — the people who will maintain, operate and build this review the design before it is built, across eight named dimensions. What they recommended and how it was answered is the record; an unanswered recommendation blocks every gate on this case, on the same machinery a breached permit condition rides."
      >
        {reading ? (
          <Refusal text={reading.refused ? reading.headline : null} />
        ) : null}
        {reading && !reading.refused ? (
          <p className="text-xs text-slate-300">{reading.headline}</p>
        ) : null}

        {review && review.blockerCount > 0 ? (
          <div className="rounded border border-red-400/30 bg-red-400/10 px-2.5 py-1.5 text-xs text-red-200">
            <p className="font-semibold">
              {review.blockerCount} gate blocker
              {review.blockerCount === 1 ? "" : "s"} from this review
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {review.blockers.map((b) => (
                <li key={`${b.type}-${b.id}`}>
                  <span className="font-mono text-[11px] text-red-300">
                    {b.type}
                  </span>{" "}
                  — {b.name}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {canPlan ? (
          <div className="space-y-2 rounded border border-white/8 bg-white/[0.02] p-3">
            <p className="text-[11px] text-slate-500">
              Record a review. A review of a kind spec I.25 requires the
              frontline to attend is a gate blocker until somebody is named in
              the room.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <select
                className={inputClass}
                value={studyForm.studyKind}
                onChange={(e) =>
                  setStudyForm({ ...studyForm, studyKind: e.target.value })
                }
              >
                <option value="frontline_design_review">
                  Frontline design review
                </option>
                <option value="maintainability_review">
                  Maintainability review
                </option>
                <option value="access_and_lifting">Access and lifting</option>
                <option value="removal_route">Removal route</option>
                <option value="equipment_selection">Equipment selection</option>
                <option value="standardisation_review">
                  Standardisation review
                </option>
                <option value="sparing_review">Sparing review</option>
                <option value="instrumentation_review">
                  Instrumentation review
                </option>
                <option value="ram_study">RAM study</option>
              </select>
              <input
                type="date"
                className={inputClass}
                value={studyForm.performedOn}
                onChange={(e) =>
                  setStudyForm({ ...studyForm, performedOn: e.target.value })
                }
              />
              <input
                className={`${inputClass} sm:col-span-1`}
                placeholder="What the review covered (20 characters minimum)"
                value={studyForm.summary}
                onChange={(e) =>
                  setStudyForm({ ...studyForm, summary: e.target.value })
                }
              />
            </div>
            <button
              className={btnClass}
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    recordCaseDesignStudy(caseId, {
                      studyKind: studyForm.studyKind,
                      summary: studyForm.summary,
                      performedOn: studyForm.performedOn || undefined,
                    }),
                  () =>
                    setStudyForm({
                      studyKind: "frontline_design_review",
                      summary: "",
                      performedOn: "",
                    }),
                )
              }
            >
              Record the review
            </button>
          </div>
        ) : null}

        {(review?.studies ?? []).map((s) => (
          <div
            key={s.id}
            className="rounded-lg border border-white/8 bg-white/[0.015] p-3"
          >
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
              <span className="font-semibold">
                {s.studyKind.replace(/_/g, " ")}
              </span>
              <span className="text-slate-500">
                {s.performedOn ?? "no date"}
              </span>
              <span className="text-slate-500">
                {s.findingsClosed}/{s.findingsCount} answered
              </span>
              {(["maintenance", "operations", "construction"] as const).map(
                (d) => {
                  const on =
                    d === "maintenance"
                      ? s.maintainerParticipated
                      : d === "operations"
                        ? s.operatorParticipated
                        : s.constructorParticipated;
                  return (
                    <span
                      key={d}
                      className={`rounded border px-1.5 py-0.5 text-[11px] ${
                        on
                          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
                          : "border-white/10 text-slate-500"
                      }`}
                    >
                      {label(FRONTLINE_DISCIPLINES, d)}{" "}
                      {on ? "in the room" : "absent"}
                    </span>
                  );
                },
              )}
            </div>
            {s.summary ? (
              <p className="mt-1 text-xs text-slate-400">{s.summary}</p>
            ) : null}
            {s.participants.length > 0 ? (
              <p className="mt-1 text-[11px] text-slate-500">
                In the room:{" "}
                {s.participants
                  .map(
                    (p) =>
                      `${p.name} (${label(FRONTLINE_DISCIPLINES, p.discipline)})`,
                  )
                  .join(", ")}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-amber-300">
                Nobody is recorded in the room. The participation flags are
                derived from this roster and cannot be typed.
              </p>
            )}

            {canFrontline ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  className={btnClass}
                  onClick={() =>
                    setParticipantFor(participantFor === s.id ? null : s.id)
                  }
                >
                  Record who was in the room
                </button>
                <button
                  className={btnClass}
                  disabled={s.participants.length === 0}
                  title={
                    s.participants.length === 0
                      ? "A finding is raised by somebody who was in the room — record the attendance first"
                      : undefined
                  }
                  onClick={() =>
                    setFindingFor(findingFor === s.id ? null : s.id)
                  }
                >
                  Raise a recommendation
                </button>
              </div>
            ) : null}

            {participantFor === s.id ? (
              <div className="mt-2 space-y-2 rounded border border-white/10 bg-black/20 p-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <select
                    className={inputClass}
                    value={participantForm.participantId}
                    onChange={(e) =>
                      setParticipantForm({
                        ...participantForm,
                        participantId: e.target.value,
                      })
                    }
                  >
                    <option value="">Who attended?</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className={inputClass}
                    value={participantForm.discipline}
                    onChange={(e) =>
                      setParticipantForm({
                        ...participantForm,
                        discipline: e.target.value,
                      })
                    }
                  >
                    {FRONTLINE_DISCIPLINES.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
                <input
                  className={inputClass}
                  placeholder="Why this person speaks for the discipline (optional, and reported as missing rather than invented)"
                  value={participantForm.basis}
                  onChange={(e) =>
                    setParticipantForm({
                      ...participantForm,
                      basis: e.target.value,
                    })
                  }
                />
                <button
                  className={btnClass}
                  disabled={busy || !participantForm.participantId}
                  onClick={() =>
                    void run(
                      () =>
                        addDesignStudyParticipant(s.id, {
                          participantId: participantForm.participantId,
                          discipline: participantForm.discipline,
                          basis: participantForm.basis || undefined,
                        }),
                      () => {
                        setParticipantFor(null);
                        setParticipantForm({
                          participantId: "",
                          discipline: "maintenance",
                          basis: "",
                        });
                      },
                    )
                  }
                >
                  Record the attendance
                </button>
              </div>
            ) : null}

            {findingFor === s.id ? (
              <div className="mt-2 space-y-2 rounded border border-white/10 bg-black/20 p-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <input
                    className={inputClass}
                    placeholder="Reference"
                    value={findingForm.findingRef}
                    onChange={(e) =>
                      setFindingForm({
                        ...findingForm,
                        findingRef: e.target.value,
                      })
                    }
                  />
                  <select
                    className={inputClass}
                    value={findingForm.dimension}
                    onChange={(e) =>
                      setFindingForm({
                        ...findingForm,
                        dimension: e.target.value,
                      })
                    }
                  >
                    {FRONTLINE_DIMENSIONS.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                  <select
                    className={inputClass}
                    value={findingForm.severity}
                    onChange={(e) =>
                      setFindingForm({
                        ...findingForm,
                        severity: e.target.value,
                      })
                    }
                  >
                    {FINDING_SEVERITIES.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <select
                    className={inputClass}
                    value={findingForm.raisedBy}
                    onChange={(e) =>
                      setFindingForm({
                        ...findingForm,
                        raisedBy: e.target.value,
                      })
                    }
                  >
                    <option value="">
                      Raised by me (or pick whoever raised it)
                    </option>
                    {s.participants.map((p) => (
                      <option key={p.id} value={p.participantId}>
                        {p.name} ({label(FRONTLINE_DISCIPLINES, p.discipline)})
                      </option>
                    ))}
                  </select>
                  <select
                    className={inputClass}
                    value={findingForm.discipline}
                    onChange={(e) =>
                      setFindingForm({
                        ...findingForm,
                        discipline: e.target.value,
                      })
                    }
                  >
                    <option value="">
                      Discipline — only needed if they attended in more than one
                    </option>
                    {FRONTLINE_DISCIPLINES.map((d) => (
                      <option key={d.key} value={d.key}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  className={inputClass}
                  rows={2}
                  placeholder="What should change, and why (20 characters minimum)"
                  value={findingForm.recommendation}
                  onChange={(e) =>
                    setFindingForm({
                      ...findingForm,
                      recommendation: e.target.value,
                    })
                  }
                />
                <button
                  className={btnClass}
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        raiseDesignReviewFinding(s.id, {
                          findingRef: findingForm.findingRef,
                          dimension: findingForm.dimension,
                          recommendation: findingForm.recommendation,
                          severity: findingForm.severity,
                          raisedBy: findingForm.raisedBy || undefined,
                          discipline: findingForm.discipline || undefined,
                        }),
                      () =>
                        setFindingForm({
                          findingRef: "",
                          dimension: "accessibility",
                          recommendation: "",
                          severity: "significant",
                          raisedBy: "",
                          discipline: "",
                        }),
                    )
                  }
                >
                  Raise it
                </button>
              </div>
            ) : null}

            {s.findings.length > 0 ? (
              <div className="mt-2 space-y-2">{s.findings.map(findingRow)}</div>
            ) : null}
          </div>
        ))}
      </Section>

      {/* ── D4.12 ─────────────────────────────────────────────────────── */}
      <Section
        icon={<Gauge className="h-4 w-4 text-signal-cyan" />}
        title="Six-axis design score"
        subtitle="Spec I.26 — a design can be technically correct and score poorly on any of these. Each axis is scored by a human with a stated basis; the composite REFUSES while any axis is unscored and names the axis, because the axis nobody scored is usually the axis nobody owns."
      >
        {card ? <Refusal text={card.refused ? card.headline : null} /> : null}
        {card && !card.refused ? (
          <p className="text-xs text-slate-300">{card.headline}</p>
        ) : null}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(card?.rows ?? []).map((r) => (
            <div
              key={r.axis}
              className="rounded border border-white/8 bg-white/[0.02] px-3 py-2"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200">{r.label}</span>
                <span
                  className={
                    r.scored ? "text-slate-200" : "text-amber-300 text-[11px]"
                  }
                >
                  {r.scored ? `${r.score} / 5` : "not scored"}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-500">{r.hint}</p>
              {r.basis ? (
                <p className="mt-1 text-[11px] text-slate-400">
                  {r.basis}
                  {r.scoredBy ? ` — ${r.scoredBy}` : ""}
                </p>
              ) : null}
            </div>
          ))}
        </div>

        {/* Scoring is a FRONTLINE act too — `score_design_axis` admits supervisor
            and technician by name, and operability and maintainability are
            precisely the axes the people who will run and maintain the thing
            are the ones qualified to score (spec I.26). */}
        {canFrontline ? (
          <div className="space-y-2 rounded border border-white/8 bg-white/[0.02] p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <select
                className={inputClass}
                value={scoreForm.axis}
                onChange={(e) =>
                  setScoreForm({ ...scoreForm, axis: e.target.value })
                }
              >
                {DESIGN_AXES.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </select>
              <select
                className={inputClass}
                value={scoreForm.score}
                onChange={(e) =>
                  setScoreForm({ ...scoreForm, score: e.target.value })
                }
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={String(n)}>
                    {n} —{" "}
                    {
                      DESIGN_AXIS_SCALE.anchors[
                        String(
                          n,
                        ) as unknown as keyof typeof DESIGN_AXIS_SCALE.anchors
                      ]
                    }
                  </option>
                ))}
              </select>
              <input
                className={inputClass}
                placeholder="Basis (20 characters minimum)"
                value={scoreForm.basis}
                onChange={(e) =>
                  setScoreForm({ ...scoreForm, basis: e.target.value })
                }
              />
            </div>
            <button
              className={btnClass}
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    scoreDesignAxis(caseId, {
                      axis: scoreForm.axis,
                      score: Number(scoreForm.score),
                      basis: scoreForm.basis,
                    }),
                  () => setScoreForm({ ...scoreForm, basis: "" }),
                )
              }
            >
              Record the score
            </button>
          </div>
        ) : null}

        {canPlan ? (
          <button
            className={btnClass}
            disabled={busy}
            onClick={() => void run(() => computeCaseDesignScorecard(caseId))}
          >
            Record a scorecard calculation
          </button>
        ) : null}
        <p className="text-[11px] text-slate-500">
          Recording a calculation writes a lineage row (D11.29) — including when
          the scorecard refuses. It is an act, not a page view.
        </p>
      </Section>

      {/* ── D4.18 ─────────────────────────────────────────────────────── */}
      <Section
        icon={<GitCompareArrows className="h-4 w-4 text-signal-cyan" />}
        title="Interfaces"
        subtitle="Spec III.§19, critical brownfield — seven typed, owned, dated boundaries. Where both sides are assets the interface joins the SAME dependency graph the asset interdependency analysis traverses, so one traversal answers what a late tie-in takes with it."
      >
        {exposure ? (
          <Refusal text={exposure.refused ? exposure.headline : null} />
        ) : null}
        {exposure && !exposure.refused ? (
          <p className="text-xs text-slate-300">{exposure.headline}</p>
        ) : null}

        {interfaces && interfaces.total > 0 ? (
          <p className="text-[11px] text-slate-500">
            The graph carries {interfaces.interfaceEdgeCount} interface edge
            {interfaces.interfaceEdgeCount === 1 ? "" : "s"} and{" "}
            {interfaces.assetEdgeCount} recorded asset dependenc
            {interfaces.assetEdgeCount === 1 ? "y" : "ies"} among the assets
            they touch — one node space, one traversal.
          </p>
        ) : null}

        {/* The traversal's ANSWER, not a claim that one ran. Both lists come
            straight off propagateLoss and singlePointsOfFailure — the same
            functions the asset interdependency surface uses. */}
        {exposure && exposure.singlePoints.reliable ? (
          <div className="rounded border border-white/8 bg-white/[0.02] px-3 py-2">
            <p className="text-xs font-semibold text-slate-200">
              What the shared traversal says
            </p>
            {exposure.singlePoints.points.length > 0 ? (
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-slate-400">
                {exposure.singlePoints.points.slice(0, 8).map((pt) => (
                  <li key={pt.id}>
                    Losing {pt.name} takes {pt.assetsLost} other object
                    {pt.assetsLost === 1 ? "" : "s"} with it
                    {pt.assetsDegraded > 0
                      ? ` and degrades ${pt.assetsDegraded}`
                      : ""}
                    {pt.underrated
                      ? " — and the register rates it below that consequence"
                      : ""}
                    .
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[11px] text-slate-400">
                {exposure.singlePoints.reason}
              </p>
            )}
            {exposure.cascades.length > 0 ? (
              <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-amber-200">
                {exposure.cascades.map((c) => (
                  <li key={c.interfaceRef}>
                    {c.interfaceRef} is late: {c.result.reason}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {canPlan ? (
          <div className="space-y-2 rounded border border-white/8 bg-white/[0.02] p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input
                className={inputClass}
                placeholder="Reference"
                value={interfaceForm.interfaceRef}
                onChange={(e) =>
                  setInterfaceForm({
                    ...interfaceForm,
                    interfaceRef: e.target.value,
                  })
                }
              />
              <input
                className={inputClass}
                placeholder="Source object (delivers)"
                value={interfaceForm.sourceObject}
                onChange={(e) =>
                  setInterfaceForm({
                    ...interfaceForm,
                    sourceObject: e.target.value,
                  })
                }
              />
              <input
                className={inputClass}
                placeholder="Target object (needs it)"
                value={interfaceForm.targetObject}
                onChange={(e) =>
                  setInterfaceForm({
                    ...interfaceForm,
                    targetObject: e.target.value,
                  })
                }
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <select
                className={inputClass}
                value={interfaceForm.interfaceType}
                onChange={(e) =>
                  setInterfaceForm({
                    ...interfaceForm,
                    interfaceType: e.target.value,
                  })
                }
              >
                {INTERFACE_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
              <select
                className={inputClass}
                value={interfaceForm.ownerId}
                onChange={(e) =>
                  setInterfaceForm({
                    ...interfaceForm,
                    ownerId: e.target.value,
                  })
                }
              >
                <option value="">Owner (mandatory)</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <input
                type="date"
                className={inputClass}
                value={interfaceForm.dueDate}
                onChange={(e) =>
                  setInterfaceForm({
                    ...interfaceForm,
                    dueDate: e.target.value,
                  })
                }
              />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <select
                className={inputClass}
                value={interfaceForm.sourceAssetId}
                onChange={(e) =>
                  setInterfaceForm({
                    ...interfaceForm,
                    sourceAssetId: e.target.value,
                  })
                }
              >
                <option value="">
                  Source asset (optional — joins the shared graph)
                </option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.tag ? `${a.tag} — ` : ""}
                    {a.name}
                  </option>
                ))}
              </select>
              <select
                className={inputClass}
                value={interfaceForm.targetAssetId}
                onChange={(e) =>
                  setInterfaceForm({
                    ...interfaceForm,
                    targetAssetId: e.target.value,
                  })
                }
              >
                <option value="">Target asset (optional)</option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.tag ? `${a.tag} — ` : ""}
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              className={inputClass}
              rows={2}
              placeholder="What must be true across this boundary (20 characters minimum)"
              value={interfaceForm.requirement}
              onChange={(e) =>
                setInterfaceForm({
                  ...interfaceForm,
                  requirement: e.target.value,
                })
              }
            />
            <button
              className={btnClass}
              disabled={busy}
              onClick={() =>
                void run(
                  () =>
                    recordCaseInterface(caseId, {
                      interfaceRef: interfaceForm.interfaceRef,
                      sourceObject: interfaceForm.sourceObject,
                      targetObject: interfaceForm.targetObject,
                      interfaceType: interfaceForm.interfaceType,
                      ownerId: interfaceForm.ownerId,
                      requirement: interfaceForm.requirement,
                      dueDate: interfaceForm.dueDate || undefined,
                      sourceAssetId: interfaceForm.sourceAssetId || undefined,
                      targetAssetId: interfaceForm.targetAssetId || undefined,
                    }),
                  () =>
                    setInterfaceForm({
                      interfaceRef: "",
                      sourceObject: "",
                      targetObject: "",
                      interfaceType: "physical",
                      ownerId: "",
                      requirement: "",
                      dueDate: "",
                      sourceAssetId: "",
                      targetAssetId: "",
                    }),
                )
              }
            >
              Record the interface
            </button>
          </div>
        ) : null}

        <div className="space-y-2">
          {(interfaces?.interfaces ?? []).map((i) => (
            <div
              key={i.id}
              className="rounded border border-white/8 bg-white/[0.02] px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono text-slate-300">
                  {i.interfaceRef}
                </span>
                <span className="rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-slate-400">
                  {label(INTERFACE_TYPES, i.interfaceType)}
                </span>
                <span className="text-slate-400">
                  {i.sourceObject} → {i.targetObject}
                </span>
                <span className="rounded border border-white/10 px-1.5 py-0.5 text-[11px] text-slate-400">
                  {label(INTERFACE_STATUSES, i.status)}
                </span>
                {i.overdue ? (
                  <span className="rounded border border-red-400/30 bg-red-400/10 px-1.5 py-0.5 text-[11px] text-red-200">
                    {i.daysLate} day{i.daysLate === 1 ? "" : "s"} late
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs text-slate-400">{i.requirement}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">
                Owner {i.owner}
                {i.dueDate
                  ? ` · required by ${i.dueDate}`
                  : " · no required-by date, so it can never be late"}
              </p>
              {canPlan ? (
                <div className="mt-2">
                  <button
                    className={btnClass}
                    onClick={() =>
                      setStatusFor(statusFor === i.id ? null : i.id)
                    }
                  >
                    Move it
                  </button>
                </div>
              ) : null}
              {statusFor === i.id ? (
                <div className="mt-2 space-y-2 rounded border border-white/10 bg-black/20 p-2">
                  <select
                    className={inputClass}
                    value={statusForm.status}
                    onChange={(e) =>
                      setStatusForm({ ...statusForm, status: e.target.value })
                    }
                  >
                    {INTERFACE_STATUSES.map((s2) => (
                      <option key={s2.key} value={s2.key}>
                        {s2.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className={inputClass}
                    placeholder="What happened (mandatory for delivered, closed or disputed)"
                    value={statusForm.note}
                    onChange={(e) =>
                      setStatusForm({ ...statusForm, note: e.target.value })
                    }
                  />
                  <button
                    className={btnClass}
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          setCaseInterfaceStatus(
                            i.id,
                            statusForm.status,
                            statusForm.note,
                          ),
                        () => {
                          setStatusFor(null);
                          setStatusForm({ status: "agreed", note: "" });
                        },
                      )
                    }
                  >
                    Record the move
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
