/**
 * Sync Develop — the Assurance Case (D13.06, spec III.§44), at
 * /develop/cases/:caseId/assurance.
 *
 * Claim → evidence → confidence, plus the open issues, the assumptions and
 * the independent review §44 asks for.
 *
 * HONESTY RULES:
 *   * a claim shows the evidence a HUMAN linked to it, with the basis they
 *     stated. Nothing is matched by keyword. "No evidence is linked to this
 *     claim. Nothing supports it and nothing contradicts it — it is an
 *     assertion." is the server's sentence and the most important row here;
 *   * confidence is the §46 composite per evidence item (D11.22), and the
 *     claim shows the HIGHEST and LOWEST of them with the number of items the
 *     computation refused. No single claim-level number is invented: combining
 *     independent evidence needs an independence assumption this product has
 *     not stated;
 *   * contradicting evidence is a first-class link. An assurance case that can
 *     only hold supporting evidence is a marketing document;
 *   * §70: ruling that a claim holds is a human act with a stated basis. The
 *     database refuses the AI-operator identity, and refuses 'supported' on a
 *     claim with nothing linked to it.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  Link2,
  Scale,
  ShieldCheck,
} from "lucide-react";
import {
  adoptTreatmentAdvice,
  dismissTreatmentAdvice,
  getCaseAssuranceCase,
  getCaseTreatmentAdvice,
  getDevelopmentCase,
  linkAssuranceClaimEvidence,
  listOrgMembers,
  recordAssuranceClaim,
  runRiskAgent,
  setAssuranceClaimPosition,
  unlinkAssuranceClaimEvidence,
  type AssuranceClaim,
  type CaseAssuranceCase,
  type OrgMember,
  type TreatmentAdviceRow,
} from "../services/developService";
import type { CaseWorkspace, WorkspaceEvidence } from "../lib/develop";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";

const CLAIM_TYPES = [
  { value: "standalone", label: "Standalone claim" },
  { value: "success_outcome", label: "A recorded success outcome" },
  { value: "gate_requirement", label: "A gate requirement" },
  { value: "regulatory", label: "Regulatory" },
  { value: "safety", label: "Safety" },
];

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded border border-red-400/30 bg-red-400/10 px-2.5 py-2 text-xs whitespace-pre-wrap text-red-300">
      {error}
    </div>
  );
}

/**
 * D12.12: acting on a machine recommendation.
 *
 * The seven fields below are not this screen's invention — they are what
 * create_risk_treatment (the ONE treatment writer, ruling D5.25) demands of a
 * SELECTED treatment, and adoption selects. Introduced risks are assessed by
 * the human here, deliberately: the agent's expectation is not an assessment,
 * and the server refuses an adoption that omits the array even when it is
 * empty.
 */
function AdoptAdviceForm({
  advice,
  members,
  onDone,
  setError,
}: {
  advice: TreatmentAdviceRow;
  members: OrgMember[];
  onDone: () => void;
  setError: (e: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    treatmentOwnerId: "",
    requiredApproverRole: "maintenance_manager",
    requiredCompletionDate: "",
    verificationMethod: "",
    consequenceSummary: "",
    alternativesConsidered: "",
    introducedRisks: "",
    // PRE-FILLED WITH THE AGENT'S NUMBER, NOT INHERITED FROM IT. The server
    // demands residual_risk explicitly for the same reason it demands
    // introduced_risks: this figure becomes the organization's recorded
    // residual, attributed to whoever adopts, and every later risk acceptance
    // is judged against it. Seeing the agent's number and leaving it is a
    // decision; never being shown it is not.
    residualRisk: String(advice.expectedResidual ?? ""),
    strategy: advice.recommendedStrategy,
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-1 mr-3 text-[10px] text-signal-cyan underline hover:text-signal-cyan/80"
      >
        adopt this recommendation
      </button>
    );
  }

  return (
    <div className="mt-1.5 grid grid-cols-1 gap-1.5 rounded border border-white/8 p-2 sm:grid-cols-2">
      <select
        value={form.treatmentOwnerId}
        onChange={(e) =>
          setForm((f) => ({ ...f, treatmentOwnerId: e.target.value }))
        }
        className={inputClass}
      >
        <option value="">Treatment owner…</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.full_name ?? m.email}
          </option>
        ))}
      </select>
      <input
        value={form.requiredApproverRole}
        onChange={(e) =>
          setForm((f) => ({ ...f, requiredApproverRole: e.target.value }))
        }
        placeholder="Required approver role"
        className={inputClass}
      />
      <input
        type="date"
        value={form.requiredCompletionDate}
        onChange={(e) =>
          setForm((f) => ({ ...f, requiredCompletionDate: e.target.value }))
        }
        className={inputClass}
      />
      <input
        value={form.verificationMethod}
        onChange={(e) =>
          setForm((f) => ({ ...f, verificationMethod: e.target.value }))
        }
        placeholder="How completion will be verified"
        className={inputClass}
      />
      <input
        value={form.consequenceSummary}
        onChange={(e) =>
          setForm((f) => ({ ...f, consequenceSummary: e.target.value }))
        }
        placeholder="Consequence if this treatment is wrong"
        className={inputClass}
      />
      <input
        value={form.alternativesConsidered}
        onChange={(e) =>
          setForm((f) => ({ ...f, alternativesConsidered: e.target.value }))
        }
        placeholder="Alternatives considered"
        className={inputClass}
      />
      <input
        value={form.residualRisk}
        onChange={(e) =>
          setForm((f) => ({ ...f, residualRisk: e.target.value }))
        }
        placeholder="Residual risk you expect this to leave (0-100)"
        className={inputClass}
      />
      <input
        value={form.strategy}
        onChange={(e) => setForm((f) => ({ ...f, strategy: e.target.value }))}
        placeholder="ISO 31000 strategy"
        className={inputClass}
      />
      <input
        value={form.introducedRisks}
        onChange={(e) =>
          setForm((f) => ({ ...f, introducedRisks: e.target.value }))
        }
        placeholder="Risks this treatment introduces (comma separated; blank means you assessed none)"
        className={`${inputClass} sm:col-span-2`}
      />
      <p className="text-[10px] text-slate-500 sm:col-span-2">
        Residual and strategy are pre-filled with what the agent expected (
        {advice.expectedResidual},{" "}
        {advice.recommendedStrategy.replace(/_/g, " ")}
        ). They are recorded against your name, so confirm or change them — the
        agent&apos;s expectation is not your assessment.
      </p>
      <button
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await adoptTreatmentAdvice(advice.id, {
              rationale: advice.rationale,
              residual_risk: form.residualRisk,
              strategy: form.strategy,
              treatment_owner_id: form.treatmentOwnerId,
              required_approver_role: form.requiredApproverRole,
              required_completion_date: form.requiredCompletionDate,
              verification_method: form.verificationMethod,
              consequence_summary: form.consequenceSummary,
              alternatives_considered: form.alternativesConsidered,
              introduced_risks: form.introducedRisks
                .split(",")
                .map((x) => x.trim())
                .filter((x) => x.length > 0),
            });
            setOpen(false);
            onDone();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
        disabled={busy}
        className="rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 px-2.5 py-1.5 text-xs font-semibold text-signal-cyan hover:bg-signal-cyan/15 disabled:opacity-50"
      >
        Create the treatment
      </button>
      <button
        onClick={() => setOpen(false)}
        className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5"
      >
        Cancel
      </button>
      <p className="text-[11px] text-slate-500 sm:col-span-2">
        Adopting creates the treatment through the platform&apos;s one treatment
        writer and puts it through the approval contract. Accepting any residual
        risk stays a separate recorded human act.
      </p>
    </div>
  );
}

function ClaimCard({
  claim,
  evidence,
  canRule,
  onChanged,
  setError,
}: {
  claim: AssuranceClaim;
  evidence: WorkspaceEvidence[];
  canRule: boolean;
  onChanged: () => void;
  setError: (e: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [evidenceId, setEvidenceId] = useState("");
  const [basis, setBasis] = useState("");
  const [bearing, setBearing] = useState("supports");
  const [positionBasis, setPositionBasis] = useState("");

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const positionClass =
    claim.position === "supported"
      ? "bg-emerald-400/10 text-emerald-300"
      : claim.position === "refuted"
        ? "bg-red-400/10 text-red-300"
        : claim.position === "withdrawn"
          ? "bg-white/5 text-slate-400"
          : "bg-amber-400/10 text-amber-300";

  return (
    <li className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
      <div className="flex flex-wrap items-start gap-2">
        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300">
          {claim.claimRef}
        </span>
        <span className="flex-1 text-sm text-slate-100">{claim.statement}</span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${positionClass}`}
        >
          {claim.position}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        {claim.claimType.replace(/_/g, " ")} · owner {claim.owner ?? "unnamed"}
        {claim.positionBy ? ` · ruled by ${claim.positionBy}` : ""}
      </p>
      {claim.positionBasis && (
        <p className="mt-1 rounded border border-white/6 bg-white/[0.02] px-2 py-1 text-[11px] text-slate-300">
          Basis: {claim.positionBasis}
        </p>
      )}

      {/* confidence — the spread, never an invented aggregate */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
        <Scale className="h-3.5 w-3.5 text-slate-500" aria-hidden />
        {claim.confidence.scoredCount > 0 && (
          <>
            <span className="rounded-full bg-signal-cyan/10 px-1.5 py-0.5 font-semibold text-signal-cyan">
              highest EC {claim.confidence.highest?.toFixed(2)}
            </span>
            <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-slate-300">
              lowest EC {claim.confidence.lowest?.toFixed(2)}
            </span>
          </>
        )}
        <span className="text-slate-400">{claim.confidence.statement}</span>
      </div>

      {claim.evidence.length > 0 && (
        <ul className="mt-2 space-y-1">
          {claim.evidence.map((e) => (
            <li
              key={e.linkId}
              className="rounded border border-white/6 bg-white/[0.02] px-2 py-1.5 text-[11px]"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    e.bearing === "contradicts"
                      ? "bg-red-400/10 text-red-300"
                      : e.bearing === "qualifies"
                        ? "bg-amber-400/10 text-amber-300"
                        : "bg-emerald-400/10 text-emerald-300"
                  }`}
                >
                  {e.bearing}
                </span>
                <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                  {e.evidenceClass ?? "unclassed"} · {e.verificationStatus}
                </span>
                {typeof e.confidence?.evidenceConfidence === "number" ? (
                  <span className="rounded-full bg-signal-cyan/10 px-1.5 py-0.5 text-[10px] font-semibold text-signal-cyan">
                    EC {e.confidence.evidenceConfidence.toFixed(2)}
                  </span>
                ) : (
                  <span
                    className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400"
                    title={e.confidence?.error ?? e.confidence?.refusal ?? ""}
                  >
                    EC refused
                  </span>
                )}
                <span className="flex-1 truncate text-slate-300">
                  {e.description}
                </span>
              </div>
              <p className="mt-0.5 text-slate-400">Basis: {e.basis}</p>
              {canRule && (
                <button
                  onClick={() =>
                    void act(() =>
                      unlinkAssuranceClaimEvidence(
                        e.linkId,
                        "No longer bears on this claim",
                      ),
                    )
                  }
                  disabled={busy}
                  className="mt-0.5 text-[10px] text-slate-500 underline hover:text-slate-300 disabled:opacity-50"
                >
                  remove this link
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canRule && claim.position !== "withdrawn" && (
        <div className="mt-2 space-y-1.5 border-t border-white/6 pt-2">
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
            <select
              value={evidenceId}
              onChange={(ev) => setEvidenceId(ev.target.value)}
              className={inputClass}
            >
              <option value="">Link recorded evidence…</option>
              {evidence.map((e) => (
                <option key={e.id} value={e.id}>
                  {(e.description ?? "evidence").slice(0, 70)}
                </option>
              ))}
            </select>
            <select
              value={bearing}
              onChange={(ev) => setBearing(ev.target.value)}
              className={inputClass}
            >
              <option value="supports">supports</option>
              <option value="qualifies">qualifies</option>
              <option value="contradicts">contradicts</option>
            </select>
            <input
              value={basis}
              onChange={(ev) => setBasis(ev.target.value)}
              placeholder="How it bears on the claim"
              className={inputClass}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() =>
                void act(async () => {
                  await linkAssuranceClaimEvidence({
                    claimId: claim.id,
                    evidenceId,
                    basis,
                    bearing,
                  });
                  setEvidenceId("");
                  setBasis("");
                })
              }
              disabled={busy || !evidenceId}
              className="flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
            >
              <Link2 className="h-3.5 w-3.5" aria-hidden /> Link evidence
            </button>
            <input
              value={positionBasis}
              onChange={(ev) => setPositionBasis(ev.target.value)}
              placeholder="Basis for ruling on this claim (20 characters minimum)"
              className="min-w-56 flex-1 rounded border border-white/10 bg-white/[0.03] px-2 py-1.5 text-[11px] text-slate-100"
            />
            {(["supported", "refuted", "withdrawn"] as const).map((p) => (
              <button
                key={p}
                onClick={() =>
                  void act(() =>
                    setAssuranceClaimPosition({
                      claimId: claim.id,
                      position: p,
                      basis: positionBasis,
                    }),
                  )
                }
                disabled={busy}
                className="rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-white/5 disabled:opacity-50"
              >
                mark {p}
              </button>
            ))}
          </div>
        </div>
      )}
    </li>
  );
}

export function AssuranceCasePage() {
  const { caseId } = useParams<{ caseId: string }>();
  const [data, setData] = useState<CaseAssuranceCase | null>(null);
  const [workspace, setWorkspace] = useState<CaseWorkspace | null>(null);
  const [advice, setAdvice] = useState<TreatmentAdviceRow[]>([]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** The risk agent's own sentence — its refusal, its record note, or what it
   *  recorded — rendered verbatim rather than summarised. */
  const [agentNote, setAgentNote] = useState<string | null>(null);
  const [agentBusy, setAgentBusy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    claimRef: "",
    statement: "",
    claimType: "standalone",
    ownerId: "",
  });

  const load = useCallback(async () => {
    if (!caseId) return;
    try {
      const [assurance, ws, adv] = await Promise.all([
        getCaseAssuranceCase(caseId),
        getDevelopmentCase(caseId),
        getCaseTreatmentAdvice(caseId).catch(() => ({ caseId, advice: [] })),
      ]);
      setData(assurance);
      setWorkspace(ws);
      setAdvice(adv.advice);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [caseId]);

  useEffect(() => {
    void load();
    listOrgMembers()
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [load]);

  if (!caseId) {
    return <div className="p-6 text-sm text-slate-300">No case named.</div>;
  }

  const evidence = workspace?.evidence ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          to={`/develop/cases/${caseId}`}
          className="flex items-center gap-1 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-white/5"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Case workspace
        </Link>
      </div>

      <header>
        <h1 className="text-lg font-semibold text-slate-50">
          Assurance case — {data?.caseTitle ?? "loading"}
        </h1>
        <p className="text-xs text-slate-400">
          What this project claims, what evidence a human linked to each claim,
          and how confident that evidence is (spec §44).
        </p>
      </header>

      <ErrorLine error={error} />

      {data && (
        <>
          <section className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-100">
              Claims ({data.claimCount})
            </h2>
            {data.claims.length === 0 ? (
              <p className="text-xs text-slate-400">
                No claim has been recorded for this case. An assurance case with
                no claims is not an empty screen — it means nobody has yet
                written down what this project asserts and expects to be held
                to.
              </p>
            ) : (
              <ul className="space-y-2">
                {data.claims.map((c) => (
                  <ClaimCard
                    key={c.id}
                    claim={c}
                    evidence={evidence}
                    canRule
                    onChanged={() => void load()}
                    setError={setError}
                  />
                ))}
              </ul>
            )}

            <div className="mt-3 space-y-1.5 border-t border-white/6 pt-3">
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-4">
                <input
                  value={draft.claimRef}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, claimRef: e.target.value }))
                  }
                  placeholder="Reference (C-01)"
                  className={inputClass}
                />
                <select
                  value={draft.claimType}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, claimType: e.target.value }))
                  }
                  className={inputClass}
                >
                  {CLAIM_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <select
                  value={draft.ownerId}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, ownerId: e.target.value }))
                  }
                  className={inputClass}
                >
                  <option value="">Claim owner…</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name ?? m.email}
                    </option>
                  ))}
                </select>
                <button
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      await recordAssuranceClaim({
                        caseId,
                        claimRef: draft.claimRef,
                        statement: draft.statement,
                        claimType: draft.claimType,
                        ownerId: draft.ownerId,
                      });
                      setDraft({
                        claimRef: "",
                        statement: "",
                        claimType: "standalone",
                        ownerId: "",
                      });
                      await load();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy}
                  className="rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 px-3 py-1.5 text-xs font-semibold text-signal-cyan hover:bg-signal-cyan/15 disabled:opacity-50"
                >
                  Record claim
                </button>
              </div>
              <input
                value={draft.statement}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, statement: e.target.value }))
                }
                placeholder='The claim as a sentence somebody could disagree with — e.g. "the facility can meet 97.5% availability"'
                className={inputClass}
              />
              <p className="text-[11px] text-slate-500">
                Only success-outcome and gate-requirement claims may name a
                typed subject; those are recorded from the case workspace where
                the subject exists. A standalone claim is legitimate — someone
                asserted it, and now it is written down.
              </p>
            </div>
          </section>

          <section className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-100">
              <ShieldCheck className="h-4 w-4 text-slate-400" aria-hidden />
              Independent review
            </h2>
            <p className="text-xs text-slate-300">
              {data.independentReview.required
                ? `Demanded level: ${data.independentReview.demandedLevel}.`
                : "The adopted governance configuration demands no independent assurance of this case."}
            </p>
            {data.independentReview.reviews.length === 0 ? (
              <p className="mt-1 text-xs text-slate-400">
                No assurance review of this case is recorded.
              </p>
            ) : (
              <ul className="mt-1.5 space-y-1">
                {data.independentReview.reviews.map((r) => (
                  <li
                    key={r.id}
                    className="rounded border border-white/6 bg-white/[0.02] px-2 py-1.5 text-[11px] text-slate-300"
                  >
                    <span className="font-semibold text-slate-100">
                      {r.level}
                    </span>{" "}
                    · {r.status}
                    {r.conclusion ? ` · ${r.conclusion}` : ""} · reviewer{" "}
                    {r.reviewer ?? "unnamed"} · competencies{" "}
                    {r.competencies.length > 0
                      ? r.competencies.join(", ")
                      : "none stated"}{" "}
                    ·{" "}
                    {r.conflictsDeclaredAt
                      ? "conflicts declared"
                      : "no conflicts declaration"}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-100">
              Assumptions ({data.assumptions.length})
            </h2>
            {data.assumptions.length === 0 ? (
              <p className="text-xs text-slate-400">
                No assumption is recorded against this case. Every claim above
                rests on something; none of it is written down yet.
              </p>
            ) : (
              <ul className="space-y-1">
                {data.assumptions.map((a) => (
                  <li
                    key={a.id}
                    className="rounded border border-white/6 bg-white/[0.02] px-2 py-1.5 text-[11px] text-slate-300"
                  >
                    <span
                      className={`mr-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        a.status === "invalidated" || a.status === "expired"
                          ? "bg-red-400/10 text-red-300"
                          : "bg-emerald-400/10 text-emerald-300"
                      }`}
                    >
                      {a.status}
                    </span>
                    {a.statement}
                    {a.invalidationReason ? ` — ${a.invalidationReason}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-100">
              <AlertTriangle className="h-4 w-4 text-amber-400" aria-hidden />
              Open issues
            </h2>
            <div className="space-y-1 text-[11px] text-slate-300">
              {data.openIssues.risks.length === 0 &&
              data.openIssues.conditions.length === 0 &&
              data.openIssues.uncoveredCommitments.length === 0 ? (
                <p className="text-slate-400">
                  Nothing unresolved is recorded against this case.
                </p>
              ) : (
                <>
                  {data.openIssues.risks.map((r) => (
                    <p
                      key={r.id}
                      className="flex flex-wrap items-center gap-1.5"
                    >
                      <span className="rounded-full bg-red-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-red-300">
                        {r.level} risk
                      </span>
                      <span className="flex-1">{r.title}</span>
                      {/* D12.12: the risk agent runs FROM HERE. Its recommend /
                          adopt / dismiss forms sat below with nothing in the
                          product able to produce a recommendation for them to
                          act on — the service function had no caller at all.
                          Scoped to this case's own unresolved risks, which is
                          the set §62 asks the agent about. */}
                      <button
                        onClick={async () => {
                          setAgentBusy(r.id);
                          setError(null);
                          setAgentNote(null);
                          try {
                            const out = await runRiskAgent({
                              riskId: r.id,
                              record: true,
                            });
                            setAgentNote(
                              out.refusal ??
                                out.recordNote ??
                                (out.recorded
                                  ? `Recommendation recorded for "${out.riskTitle}" at the ${out.workflowStep} step. It is advisory: adopting it and accepting any residual risk stay separate human acts.`
                                  : `No recommendation was recorded for "${out.riskTitle}".`),
                            );
                            await load();
                          } catch (e) {
                            setError(
                              e instanceof Error ? e.message : String(e),
                            );
                          } finally {
                            setAgentBusy(null);
                          }
                        }}
                        disabled={agentBusy !== null}
                        className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-white/5 disabled:opacity-50"
                      >
                        {agentBusy === r.id ? "reading…" : "ask the risk agent"}
                      </button>
                    </p>
                  ))}
                  {data.openIssues.conditions.map((c) => (
                    <p key={c.id}>
                      <span className="mr-1.5 rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                        condition{c.overdue ? " (overdue)" : ""}
                      </span>
                      {c.description}
                    </p>
                  ))}
                  {data.openIssues.uncoveredCommitments.map((c, i) => (
                    <p key={String(c.commitmentId ?? i)}>
                      <span className="mr-1.5 rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                        commitment
                      </span>
                      {String(c.commitment ?? "")}{" "}
                      {c.stakeholder ? `— ${String(c.stakeholder)}` : ""}
                    </p>
                  ))}
                </>
              )}
            </div>
          </section>

          {/* D12.12 — the risk agent's recommendations against this case's
              risks. Advisory: adoption creates a treatment through the shipped
              writer and acceptance stays a separate human act. */}
          <section className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-100">
              <Bot className="h-4 w-4 text-slate-400" aria-hidden />
              Risk agent recommendations ({advice.length})
            </h2>
            {agentNote && (
              <p className="mb-2 rounded border border-white/8 bg-white/[0.02] px-2.5 py-1.5 text-[11px] whitespace-pre-wrap text-slate-300">
                {agentNote}
              </p>
            )}
            {advice.length === 0 ? (
              <p className="text-xs text-slate-400">
                No treatment recommendation has been recorded against this
                case&apos;s risks. Ask the agent from an open issue above. It
                proposes; it never accepts a risk at any consequence level.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {advice.map((a) => (
                  <li
                    key={a.id}
                    className="rounded border border-white/6 bg-white/[0.02] px-2.5 py-2 text-[11px] text-slate-300"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                        {a.workflowStep}
                      </span>
                      <span className="rounded-full bg-signal-cyan/10 px-1.5 py-0.5 text-[10px] font-semibold text-signal-cyan">
                        {a.recommendedStrategy.replace(/_/g, " ")}
                      </span>
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          a.status === "adopted"
                            ? "bg-emerald-400/10 text-emerald-300"
                            : a.status === "dismissed"
                              ? "bg-white/5 text-slate-400"
                              : "bg-amber-400/10 text-amber-300"
                        }`}
                      >
                        {a.status}
                      </span>
                      <span className="flex-1 font-medium text-slate-100">
                        {a.label}
                      </span>
                    </div>
                    <p className="mt-0.5">
                      {a.riskTitle} ({a.riskLevel ?? "unrated"}) — expected
                      residual {a.expectedResidual}, introduced{" "}
                      {a.expectedIntroduced}
                    </p>
                    <p className="mt-0.5 text-slate-400">{a.rationale}</p>
                    <p className="mt-0.5 text-slate-500">
                      Limitations: {a.limitations}
                    </p>
                    {/* WHO RAN IT. The bot icon above says "an agent"; nothing
                        distinguished agent output from a row written by hand
                        through the RPC until the server returned this. */}
                    <p className="mt-0.5 text-slate-500">
                      {a.agent ?? "an advisory agent"}
                      {a.model ? ` (${a.model})` : ""}, run by{" "}
                      {a.proposedBy ?? "an unnamed account"}
                      {a.adoptedBy ? ` · adopted by ${a.adoptedBy}` : ""}
                      {a.dismissedBy ? ` · dismissed by ${a.dismissedBy}` : ""}
                    </p>
                    {a.dismissedReason && (
                      <p className="mt-0.5 text-slate-500">
                        Dismissed: {a.dismissedReason}
                      </p>
                    )}
                    {a.status === "proposed" && (
                      <AdoptAdviceForm
                        advice={a}
                        members={members}
                        onDone={() => void load()}
                        setError={setError}
                      />
                    )}
                    {a.status === "proposed" && (
                      <button
                        onClick={async () => {
                          setError(null);
                          try {
                            await dismissTreatmentAdvice(
                              a.id,
                              "Reviewed and not taken forward",
                            );
                            await load();
                          } catch (e) {
                            setError(
                              e instanceof Error ? e.message : String(e),
                            );
                          }
                        }}
                        className="mt-1 text-[10px] text-slate-500 underline hover:text-slate-300"
                      >
                        dismiss this recommendation
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default AssuranceCasePage;
