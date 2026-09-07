/**
 * P0.2 Decision Case spine. Rendered after the P0.1 save gate.
 * Persistent loop: Q → Evidence → Rec → Decision → Action → Verify → Learn.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  Shield,
  TriangleAlert,
} from "lucide-react";
import { useOptionalAuth } from "../components/AuthProvider";
import type { InvertedIntentId } from "../lib/onboarding/inverted-opening";
import { INVERTED_OPENING_AUTHORITY } from "../lib/onboarding/inverted-opening";
import {
  CONNECTION_FAILURE_FALLBACKS,
  EVIDENCE_KINDS,
  EVIDENCE_METHODS,
  SPINE_DISPOSITIONS,
  SPINE_STAGES,
  VERIFICATION_EFFECTIVENESS,
  applyDisposition,
  applyInvite,
  applyVerificationPlan,
  attachSpineEvidence,
  buildSpineDecisionCase,
  inviteCopy,
  lineageFromCase,
  policyAdvisory,
  readinessFromCase,
  type CasePeople,
  type EvidenceKind,
  type EvidenceMethod,
  type SpineDisposition,
  type VerificationPlan,
} from "../lib/onboarding/decision-case-spine";
import {
  createPersistedDecisionCase,
} from "../services/decisionCaseService";

const emptyPeople = (): CasePeople => ({
  decisionOwner: "",
  recommendationAuthor: "SyncAI",
  requiredApprover: "",
  verificationOwner: "",
});

const emptyVerification = (): VerificationPlan => ({
  question: "How will we know this worked?",
  expected: "",
  actual: "",
  evidence: "",
  scheduledFor: "",
  effectiveness: "",
});

export function DecisionCaseSpine({
  question,
  intent,
}: {
  question: string;
  intent: InvertedIntentId;
}) {
  const auth = useOptionalAuth();
  const [decisionCase, setDecisionCase] = useState(() =>
    buildSpineDecisionCase({ question, intent }),
  );
  const [saved, setSaved] = useState(false);
  const [saveNotice, setSaveNotice] = useState(
    auth?.user
      ? "Save this assessment to keep the Decision Case on the evaluation workspace."
      : "Provisional Decision Case in this session. Sign in to keep it on an evaluation workspace.",
  );
  const [saving, setSaving] = useState(false);
  const [kind, setKind] = useState<EvidenceKind>("work_history");
  const [method, setMethod] = useState<EvidenceMethod>("paste_data");
  const [evidenceBody, setEvidenceBody] = useState("");
  const [connectFailed, setConnectFailed] = useState(false);
  const [disposition, setDisposition] = useState<SpineDisposition | "">("");
  const [rationale, setRationale] = useState("");
  const [people, setPeople] = useState<CasePeople>(emptyPeople);
  const [verification, setVerification] = useState<VerificationPlan>(
    emptyVerification,
  );
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [invited, setInvited] = useState(false);
  const [manualPath, setManualPath] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lineageOpen, setLineageOpen] = useState(true);

  const lineage = useMemo(
    () => lineageFromCase(decisionCase, verification),
    [decisionCase, verification],
  );
  const readiness = useMemo(
    () =>
      readinessFromCase(decisionCase, {
        saved,
        disposition,
        verification:
          verification.scheduledFor || verification.effectiveness
            ? verification
            : null,
        invited,
        manualEvidencePath: manualPath,
      }),
    [decisionCase, saved, disposition, verification, invited, manualPath],
  );

  const persistIfPossible = async () => {
    if (!auth?.user) {
      setSaved(true);
      setSaveNotice(
        "Assessment saved in this session. Create an evaluation workspace to make it durable.",
      );
      return;
    }
    setSaving(true);
    try {
      const persisted = await createPersistedDecisionCase(decisionCase, {});
      setDecisionCase(persisted);
      setSaved(true);
      setSaveNotice("Decision Case saved to the governed team workspace.");
    } catch {
      setSaved(true);
      setSaveNotice(
        "Case is provisional in this browser. Cloud workspace save did not complete — the loop stays available.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="decision-case-spine" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-teal-500/25 bg-[#0D1520] px-4 py-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-300">
            Decision Case
          </p>
          <p className="mt-1 text-sm font-semibold text-white">
            {decisionCase.caseNumber} · {decisionCase.statusLabel}
          </p>
        </div>
        <button
          type="button"
          data-testid="spine-save-workspace"
          disabled={saving}
          onClick={() => void persistIfPossible()}
          className="rounded-lg bg-teal-400 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-40"
        >
          {auth?.user ? "Save to workspace" : "Keep provisional and continue"}
        </button>
      </div>
      <p className="text-xs text-slate-400" data-testid="spine-save-notice">
        {saveNotice}
      </p>

      <ol
        data-testid="spine-loop"
        className="flex flex-wrap gap-1.5 rounded-2xl border border-white/10 bg-[#0D1520] px-3 py-2"
      >
        {SPINE_STAGES.map((stage) => (
          <li
            key={stage}
            className="rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide text-teal-200/90"
          >
            {stage}
          </li>
        ))}
      </ol>

      <section className="rounded-2xl border border-white/10 bg-[#0D1520] p-4">
        <h2 className="text-sm font-semibold text-white">Question</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-200">
          {decisionCase.objective}
        </p>
        <p className="mt-3 text-xs text-slate-400">
          {policyAdvisory(decisionCase.authorityRole)}
        </p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#0D1520] p-4">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setLineageOpen((value) => !value)}
          data-testid="spine-lineage-toggle"
        >
          <h2 className="text-sm font-semibold text-white">
            Evidence lineage
          </h2>
          {lineageOpen ? (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronRight className="h-4 w-4 text-slate-400" />
          )}
        </button>
        {lineageOpen ? (
          <dl
            data-testid="spine-lineage"
            className="mt-3 grid gap-2 sm:grid-cols-2"
          >
            <LineageCell label="Evidence count" value={String(lineage.evidenceCount)} />
            <LineageCell
              label="Missing"
              value={lineage.missing.join(", ") || "None"}
            />
            <LineageCell
              label="Assumptions"
              value={`${lineage.assumptions.length} stated`}
            />
            <LineageCell
              label="Confidence"
              value={`${lineage.confidencePct}%`}
            />
            <LineageCell
              label="Required authority"
              value={lineage.requiredAuthority}
            />
            <LineageCell
              label="Verification status"
              value={lineage.verificationStatus}
            />
          </dl>
        ) : null}
        <p className="mt-3 text-xs leading-relaxed text-amber-100/90">
          {lineage.honesty}
        </p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#0D1520] p-4">
        <h2 className="text-sm font-semibold text-white">Recommendation</h2>
        <p className="mt-2 text-sm text-slate-100">
          {decisionCase.recommendation}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">
          {decisionCase.recommendationDetail}
        </p>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-slate-400">
          {lineage.assumptions.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section
        data-testid="spine-evidence"
        className="rounded-2xl border border-white/10 bg-[#0D1520] p-4"
      >
        <h2 className="text-sm font-semibold text-white">
          To improve this answer, give me one of these
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          Evidence type first — then file, paste, or source. Not Historian vs
          CMMS as the first question.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {EVIDENCE_KINDS.map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid={`spine-kind-${item.id}`}
              onClick={() => setKind(item.id)}
              className={`rounded-full border px-3 py-1 text-xs ${
                kind === item.id
                  ? "border-teal-400/50 bg-teal-500/10 text-teal-100"
                  : "border-white/15 text-slate-200"
              }`}
            >
              {item.title}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {EVIDENCE_KINDS.find((item) => item.id === kind)?.ask}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {EVIDENCE_METHODS.map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid={`spine-method-${item.id}`}
              onClick={() => {
                setMethod(item.id);
                if (item.id === "connect_source") setConnectFailed(false);
              }}
              className={`rounded-full border px-3 py-1 text-xs ${
                method === item.id
                  ? "border-teal-400/50 bg-teal-500/10 text-teal-100"
                  : "border-white/15 text-slate-200"
              }`}
            >
              {item.title}
            </button>
          ))}
        </div>
        {method === "connect_source" ? (
          <div
            data-testid="spine-connect-panel"
            className="mt-3 space-y-2 rounded-xl border border-amber-400/20 bg-amber-400/5 p-3"
          >
            <p className="text-xs text-amber-100/90">
              Connection is optional and read-only. If it fails, the case does
              not dead-end.
            </p>
            <button
              type="button"
              data-testid="spine-connect-fail"
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-100"
              onClick={() => setConnectFailed(true)}
            >
              Simulate connection failure
            </button>
            {connectFailed ? (
              <div data-testid="spine-connect-fallbacks">
                <p className="text-xs font-semibold text-white">
                  Continue without the connector
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {CONNECTION_FAILURE_FALLBACKS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setMethod(id);
                        setConnectFailed(false);
                      }}
                      className="rounded-lg bg-white/10 px-2 py-1 text-xs text-slate-100"
                    >
                      {EVIDENCE_METHODS.find((item) => item.id === id)?.title}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <textarea
              data-testid="spine-evidence-body"
              value={evidenceBody}
              onChange={(event) => setEvidenceBody(event.target.value)}
              rows={3}
              placeholder="Paste notes, a table, or describe the file you would upload."
              className="mt-3 w-full rounded-xl border border-white/10 bg-[#080c10] px-3 py-2 text-sm text-white"
            />
            <button
              type="button"
              data-testid="spine-add-evidence"
              className="mt-2 rounded-lg bg-teal-400 px-3 py-2 text-xs font-bold text-slate-950"
              onClick={() => {
                const next = attachSpineEvidence(
                  decisionCase,
                  kind,
                  method,
                  evidenceBody,
                );
                setDecisionCase(next);
                setManualPath(true);
                setEvidenceBody("");
              }}
            >
              Add this evidence
            </button>
          </>
        )}
      </section>

      <section
        data-testid="spine-disposition"
        className="rounded-2xl border border-white/10 bg-[#0D1520] p-4"
      >
        <h2 className="text-sm font-semibold text-white">Human decision</h2>
        <p className="mt-1 text-xs text-slate-500">
          Disposition is not Approve-only. Action stays human — Sync does not
          execute on the plant.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {(
            [
              ["decisionOwner", "Decision Owner"],
              ["recommendationAuthor", "Recommendation Author"],
              ["requiredApprover", "Required Approver"],
              ["verificationOwner", "Verification Owner"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="text-xs text-slate-300">
              {label}
              <input
                data-testid={`spine-person-${key}`}
                value={people[key]}
                onChange={(event) =>
                  setPeople((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#080c10] px-3 py-2 text-sm text-white"
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {SPINE_DISPOSITIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid={`spine-disp-${item.id}`}
              onClick={() => setDisposition(item.id)}
              className={`rounded-full border px-3 py-1 text-xs ${
                disposition === item.id
                  ? "border-teal-400/50 bg-teal-500/10 text-teal-100"
                  : "border-white/15 text-slate-200"
              }`}
            >
              {item.title}
            </button>
          ))}
        </div>
        <textarea
          data-testid="spine-rationale"
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
          rows={2}
          placeholder={
            SPINE_DISPOSITIONS.find((item) => item.id === disposition)?.hint ??
            "Short rationale required"
          }
          className="mt-3 w-full rounded-xl border border-white/10 bg-[#080c10] px-3 py-2 text-sm text-white"
        />
        <button
          type="button"
          data-testid="spine-record-disposition"
          className="mt-2 rounded-lg bg-teal-400 px-3 py-2 text-xs font-bold text-slate-950"
          onClick={() => {
            if (!disposition) {
              setError("Choose a disposition.");
              return;
            }
            try {
              setDecisionCase(
                applyDisposition(decisionCase, disposition, rationale, people),
              );
              setError(null);
            } catch (caught) {
              setError(
                caught instanceof Error ? caught.message : "Disposition failed",
              );
            }
          }}
        >
          Record disposition
        </button>
      </section>

      {disposition === "accept" ? (
        <section
          data-testid="spine-verification"
          className="rounded-2xl border border-teal-500/25 bg-[#0D1520] p-4"
        >
          <h2 className="text-sm font-semibold text-white">
            How will we know this worked?
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Schedule verification at decision time. Recording an outcome is
            optional until evidence exists.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-slate-300">
              Expected
              <input
                data-testid="spine-verify-expected"
                value={verification.expected}
                onChange={(event) =>
                  setVerification((current) => ({
                    ...current,
                    expected: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#080c10] px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs text-slate-300">
              Schedule
              <input
                data-testid="spine-verify-date"
                type="date"
                value={verification.scheduledFor}
                onChange={(event) =>
                  setVerification((current) => ({
                    ...current,
                    scheduledFor: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#080c10] px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs text-slate-300">
              Actual
              <input
                data-testid="spine-verify-actual"
                value={verification.actual}
                onChange={(event) =>
                  setVerification((current) => ({
                    ...current,
                    actual: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#080c10] px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="text-xs text-slate-300">
              Evidence
              <input
                data-testid="spine-verify-evidence"
                value={verification.evidence}
                onChange={(event) =>
                  setVerification((current) => ({
                    ...current,
                    evidence: event.target.value,
                  }))
                }
                className="mt-1 w-full rounded-lg border border-white/10 bg-[#080c10] px-3 py-2 text-sm text-white"
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {VERIFICATION_EFFECTIVENESS.map((item) => (
              <button
                key={item.id}
                type="button"
                data-testid={`spine-effect-${item.id}`}
                onClick={() =>
                  setVerification((current) => ({
                    ...current,
                    effectiveness: item.id,
                  }))
                }
                className={`rounded-full border px-3 py-1 text-xs ${
                  verification.effectiveness === item.id
                    ? "border-teal-400/50 bg-teal-500/10 text-teal-100"
                    : "border-white/15 text-slate-200"
                }`}
              >
                {item.title}
              </button>
            ))}
          </div>
          <button
            type="button"
            data-testid="spine-record-verification"
            className="mt-3 rounded-lg bg-teal-400 px-3 py-2 text-xs font-bold text-slate-950"
            onClick={() => {
              try {
                setDecisionCase(
                  applyVerificationPlan(decisionCase, verification),
                );
                setError(null);
              } catch (caught) {
                setError(
                  caught instanceof Error
                    ? caught.message
                    : "Verification failed",
                );
              }
            }}
          >
            Schedule or record verification
          </button>
        </section>
      ) : null}

      <section
        data-testid="spine-invite"
        className="rounded-2xl border border-white/10 bg-[#0D1520] p-4"
      >
        <h2 className="text-sm font-semibold text-white">Invite</h2>
        <p className="mt-2 text-xs leading-relaxed text-slate-300">
          {inviteCopy(decisionCase.authorityRole)}
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-slate-300">
            Name
            <input
              data-testid="spine-invite-name"
              value={inviteName}
              onChange={(event) => setInviteName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#080c10] px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-slate-300">
            Work email
            <input
              data-testid="spine-invite-email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-[#080c10] px-3 py-2 text-sm text-white"
            />
          </label>
        </div>
        <button
          type="button"
          data-testid="spine-record-invite"
          className="mt-3 rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-slate-100"
          onClick={() => {
            try {
              setDecisionCase(
                applyInvite(decisionCase, {
                  name: inviteName,
                  email: inviteEmail,
                  authority: decisionCase.authorityRole,
                }),
              );
              setInvited(true);
              setError(null);
            } catch (caught) {
              setError(
                caught instanceof Error ? caught.message : "Invite failed",
              );
            }
          }}
        >
          Record invite on this case
        </button>
      </section>

      <section
        data-testid="spine-readiness"
        className="rounded-2xl border border-white/10 bg-[#0D1520] p-4"
      >
        <h2 className="text-sm font-semibold text-white">Stage-1 readiness</h2>
        <p className="mt-2 text-xs text-slate-300">{readiness.headline}</p>
        <ul className="mt-3 space-y-2">
          {readiness.gates.map((gate) => (
            <li
              key={gate.id}
              data-testid={`spine-gate-${gate.id}`}
              className={`rounded-xl border px-3 py-2 ${
                gate.met
                  ? "border-teal-400/30 bg-teal-400/5"
                  : "border-white/10"
              }`}
            >
              <p className="text-xs font-semibold text-white">
                {gate.met ? "Met" : "Open"} · {gate.title}
              </p>
              <p className="mt-0.5 text-xs text-slate-400">{gate.evidence}</p>
            </li>
          ))}
        </ul>
      </section>

      {error ? (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      ) : null}

      <div className="flex items-start gap-2 text-[11px] text-slate-500">
        <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-300" />
        <span>
          {INVERTED_OPENING_AUTHORITY} This spine does not claim seamless
          self-guided onboarding is live.
        </span>
      </div>
      {!auth?.user ? (
        <p className="text-center text-[11px] text-slate-600">
          <TriangleAlert className="mr-1 inline h-3 w-3" />
          Optional:{" "}
          <Link
            className="text-teal-400"
            to={`/?view=signup&invertedAsk=${encodeURIComponent(question)}&intent=${intent}`}
          >
            create an evaluation workspace
          </Link>{" "}
          after the first loop — not before Ask.
        </p>
      ) : null}
    </div>
  );
}

function LineageCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 px-3 py-2">
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-xs font-semibold text-white">{value}</dd>
    </div>
  );
}
