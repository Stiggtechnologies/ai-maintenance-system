/**
 * Decision Case spine. Rendered after the ask-first save gate.
 * Persistent loop: Q → Evidence → Rec → Decision → Action → Verify → Learn.
 * P1 adds counterfactual-before-accept, on-case provenance, optional expiry,
 * verification-owner attribution, a case class, and a local proof summary.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Shield, TriangleAlert } from "lucide-react";
import { useOptionalAuth } from "../components/AuthProvider";
import { stageDecisionCaseHandoff } from "../lib/decision-case";
import type { DecisionCase } from "../lib/decision-case";
import { isSeedDecisionCaseId } from "../lib/decision-case-honesty";
import type { InvertedIntentId } from "../lib/onboarding/inverted-opening";
import {
  INVERTED_OPENING_AUTHORITY,
  isExamplePrompt,
} from "../lib/onboarding/inverted-opening";
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
  buildProofSummary,
  buildSpineDecisionCase,
  classifySpineCase,
  counterfactualFromCase,
  describeUploadedFile,
  dispositionFromCase,
  expiryFromCase,
  interpretConnectionAttempt,
  inviteCopy,
  lineageFromCase,
  outcomeAttribution,
  peopleFromCase,
  policyAdvisory,
  proofDownloadName,
  provenanceFromCase,
  rationaleFromCase,
  readinessFromCase,
  spineStageIndex,
  unknownsFromCase,
  verificationFromCase,
  type CasePeople,
  type EvidenceKind,
  type EvidenceMethod,
  type SpineDisposition,
  type VerificationPlan,
} from "../lib/onboarding/decision-case-spine";
import { getIntegrations } from "../services/operatingLoopService";
import {
  createPersistedDecisionCase,
  isPersistedDecisionCase,
  loadPersistedDecisionCase,
  savePersistedDecisionCase,
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
  initialCase,
  initiallySaved = false,
  blockWorkspacePersist = false,
  openingNotice = null,
}: {
  question: string;
  intent: InvertedIntentId;
  initialCase?: DecisionCase;
  initiallySaved?: boolean;
  blockWorkspacePersist?: boolean;
  openingNotice?: string | null;
}) {
  const auth = useOptionalAuth();
  const [decisionCase, setDecisionCase] = useState(
    () => initialCase ?? buildSpineDecisionCase({ question, intent }),
  );
  const [saved, setSaved] = useState(initiallySaved);
  const [saveNotice, setSaveNotice] = useState(
    openingNotice
      ? openingNotice
      : blockWorkspacePersist
        ? "Example preview. This prompt is not saved to a workspace."
        : initiallySaved
          ? "Decision Case is on your evaluation workspace."
          : auth?.user
            ? "Save this assessment to keep the Decision Case on the evaluation workspace."
            : "Provisional Decision Case in this session. Sign in to keep it on an evaluation workspace.",
  );
  const [saving, setSaving] = useState(false);
  const [kind, setKind] = useState<EvidenceKind>("work_history");
  const [method, setMethod] = useState<EvidenceMethod>("paste_data");
  const [evidenceBody, setEvidenceBody] = useState("");
  const [connectResult, setConnectResult] = useState<ReturnType<
    typeof interpretConnectionAttempt
  > | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disposition, setDisposition] = useState<SpineDisposition | "">(() =>
    initialCase ? dispositionFromCase(initialCase) : "",
  );
  const [rationale, setRationale] = useState(() =>
    initialCase ? rationaleFromCase(initialCase) : "",
  );
  const [counterfactual, setCounterfactual] = useState(() =>
    initialCase ? counterfactualFromCase(initialCase) : "",
  );
  const [expiresOn, setExpiresOn] = useState(() =>
    initialCase ? expiryFromCase(initialCase) : "",
  );
  const [people, setPeople] = useState<CasePeople>(() =>
    initialCase ? peopleFromCase(initialCase) : emptyPeople(),
  );
  const [verification, setVerification] = useState<VerificationPlan>(() => {
    if (!initialCase) return emptyVerification();
    return verificationFromCase(initialCase) ?? emptyVerification();
  });
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const [proofNotice, setProofNotice] = useState<string | null>(null);
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
  const classification = useMemo(
    () => classifySpineCase(decisionCase, disposition),
    [decisionCase, disposition],
  );
  const provenance = useMemo(
    () => provenanceFromCase(decisionCase),
    [decisionCase],
  );
  const proof = useMemo(
    () =>
      buildProofSummary({
        decisionCase,
        disposition,
        rationale,
        counterfactual,
        expiresOn,
        people,
        verification,
      }),
    [
      decisionCase,
      disposition,
      rationale,
      counterfactual,
      expiresOn,
      people,
      verification,
    ],
  );
  const attribution = outcomeAttribution(
    verification,
    people.verificationOwner,
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

  const commit = (next: DecisionCase) => {
    setDecisionCase(next);
    if (
      blockWorkspacePersist ||
      isExamplePrompt(next.objective) ||
      !isPersistedDecisionCase(next.id)
    ) {
      return;
    }
    void savePersistedDecisionCase(next).catch(() => {
      setSaveNotice(
        "Updates stayed in this session. Workspace save did not complete.",
      );
    });
  };

  const persistIfPossible = async () => {
    if (blockWorkspacePersist || isExamplePrompt(decisionCase.objective)) {
      setSaveNotice(
        "Example prompts are not saved into a customer workspace. Rewrite the question as your own.",
      );
      return;
    }
    if (!auth?.user) {
      setSaved(true);
      setSaveNotice(
        "Assessment kept in this session. Sign in to create the evaluation workspace — not before Ask.",
      );
      return;
    }
    setSaving(true);
    try {
      const persisted = isPersistedDecisionCase(decisionCase.id)
        ? decisionCase
        : await createPersistedDecisionCase(decisionCase, {});
      if (isPersistedDecisionCase(persisted.id)) {
        await savePersistedDecisionCase(persisted);
      }
      setDecisionCase(persisted);
      setSaved(true);
      setSaveNotice(
        "Decision Case saved on your evaluation workspace. Reload the audit trail on this page.",
      );
    } catch {
      setSaved(true);
      setSaveNotice(
        "Case is provisional in this browser. Workspace save did not complete — the loop stays available.",
      );
    } finally {
      setSaving(false);
    }
  };

  const reloadTrail = async () => {
    if (!isPersistedDecisionCase(decisionCase.id)) {
      setError("This case is not on a workspace yet.");
      return;
    }
    try {
      const loaded = await loadPersistedDecisionCase(decisionCase.id);
      if (!loaded) {
        setError("The saved Decision Case could not be loaded.");
        return;
      }
      setDecisionCase(loaded);
      setCounterfactual(counterfactualFromCase(loaded));
      setExpiresOn(expiryFromCase(loaded));
      setPeople(peopleFromCase(loaded));
      const recordedDisposition = dispositionFromCase(loaded);
      if (recordedDisposition) setDisposition(recordedDisposition);
      const recordedRationale = rationaleFromCase(loaded);
      if (recordedRationale) setRationale(recordedRationale);
      const recordedPlan = verificationFromCase(loaded);
      if (recordedPlan) setVerification(recordedPlan);
      setSaved(true);
      setError(null);
      setSaveNotice("Audit trail reloaded from the evaluation workspace.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Reload failed");
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
          <p
            data-testid="spine-case-class"
            data-class={classification.id}
            className="mt-1 text-xs font-semibold text-teal-100"
          >
            Case class · {classification.label}
          </p>
        </div>
        <button
          type="button"
          data-testid="spine-save-workspace"
          disabled={saving || blockWorkspacePersist}
          onClick={() => void persistIfPossible()}
          className="rounded-lg bg-teal-400 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-40"
        >
          {blockWorkspacePersist
            ? "Example — not saved"
            : saved
              ? "Save updates"
              : auth?.user
                ? "Save to workspace"
                : "Keep provisional and continue"}
        </button>
      </div>
      <p className="text-xs text-slate-400" data-testid="spine-save-notice">
        {saveNotice}
      </p>
      <p
        data-testid="spine-case-class-basis"
        className="text-[11px] leading-relaxed text-slate-400"
      >
        {classification.basis}
      </p>

      <ol
        data-testid="spine-loop"
        className="flex flex-wrap gap-1.5 rounded-2xl border border-white/10 bg-[#0D1520] px-3 py-2"
      >
        {SPINE_STAGES.map((stage, index) => {
          const active = index === spineStageIndex(decisionCase.stage);
          const locked = stage === "ACTION";
          return (
            <li
              key={stage}
              data-active={active ? "true" : "false"}
              data-locked={locked ? "true" : "false"}
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${
                active ? "bg-teal-300 text-slate-950" : "text-teal-200/90"
              }`}
            >
              {stage}
              {locked ? " · locked" : ""}
            </li>
          );
        })}
      </ol>

      <section className="rounded-2xl border border-white/10 bg-[#0D1520] p-4">
        <h2 className="text-sm font-semibold text-white">Question</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-200">
          {decisionCase.objective}
        </p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#0D1520] p-4">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setLineageOpen((value) => !value)}
          data-testid="spine-lineage-toggle"
        >
          <h2 className="text-sm font-semibold text-white">Evidence lineage</h2>
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
            <LineageCell
              label="Evidence count"
              value={String(lineage.evidenceCount)}
            />
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
        <p
          data-testid="spine-advisory"
          className="mt-3 text-xs leading-relaxed text-amber-100/90"
        >
          {policyAdvisory(decisionCase.authorityRole)}
        </p>
        <button
          type="button"
          data-testid="spine-provenance-toggle"
          className="mt-3 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-100"
          onClick={() => setProvenanceOpen((open) => !open)}
        >
          {provenanceOpen ? "Hide provenance" : "Cite sources on this case"}
        </button>
        {provenanceOpen ? (
          <div data-testid="spine-provenance" className="mt-3 space-y-2">
            <p className="text-xs text-slate-300">{provenance.note}</p>
            {provenance.cites.length > 0 ? (
              <ul className="space-y-2">
                {provenance.cites.map((cite) => (
                  <li
                    key={cite.id}
                    className="rounded-xl border border-white/10 px-3 py-2"
                  >
                    <p className="text-xs font-semibold text-white">
                      {cite.title}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {cite.sourceSystem} · {cite.lineage}
                    </p>
                    <p className="mt-1 text-xs text-slate-200">
                      {cite.summary}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
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
                if (item.id === "connect_source") setConnectResult(null);
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
              Connection is optional and read-only. A failed or missing source
              does not end the case. CSV upload, paste, manual notes, and ask an
              admin stay available.
            </p>
            <button
              type="button"
              data-testid="spine-connect-check"
              disabled={connecting}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-100 disabled:opacity-40"
              onClick={() => {
                setConnecting(true);
                void getIntegrations()
                  .then((rows) => {
                    setConnectResult(
                      interpretConnectionAttempt(
                        rows.map((row) => ({
                          name: row.name,
                          status: row.status,
                        })),
                      ),
                    );
                  })
                  .catch((caught: unknown) => {
                    setConnectResult(
                      interpretConnectionAttempt(
                        null,
                        caught instanceof Error
                          ? caught.message
                          : "integration lookup failed",
                      ),
                    );
                  })
                  .finally(() => setConnecting(false));
              }}
            >
              {connecting ? "Checking sources…" : "Check connected sources"}
            </button>
            {connectResult ? (
              <div data-testid="spine-connect-fallbacks">
                <p className="text-xs font-semibold text-white">
                  {connectResult.ok ? connectResult.note : connectResult.reason}
                </p>
                <p className="mt-1 text-xs text-slate-300">
                  Continue without a live pull. A CSV export counts as a file
                  upload.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {CONNECTION_FAILURE_FALLBACKS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setMethod(id);
                        setConnectResult(null);
                        if (id === "manual" || id === "ask_admin") {
                          setManualPath(true);
                        }
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
            {method === "upload_file" ? (
              <label className="mt-3 block text-xs text-slate-300">
                Upload a file (CSV, text, or JSON)
                <input
                  data-testid="spine-evidence-file"
                  type="file"
                  accept=".txt,.csv,.json,.md,text/plain,text/csv,application/json"
                  className="mt-1 block w-full text-xs text-slate-200"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    const textLike =
                      file.size <= 200_000 &&
                      (/text|json|csv|markdown|plain/.test(file.type) ||
                        /\.(txt|csv|json|md)$/i.test(file.name));
                    if (!textLike) {
                      setEvidenceBody(
                        describeUploadedFile({
                          name: file.name,
                          type: file.type,
                          size: file.size,
                          text: null,
                        }),
                      );
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () => {
                      setEvidenceBody(
                        describeUploadedFile({
                          name: file.name,
                          type: file.type,
                          size: file.size,
                          text:
                            typeof reader.result === "string"
                              ? reader.result
                              : null,
                        }),
                      );
                    };
                    reader.onerror = () => {
                      setEvidenceBody(
                        describeUploadedFile({
                          name: file.name,
                          type: file.type,
                          size: file.size,
                          text: null,
                        }),
                      );
                    };
                    reader.readAsText(file);
                  }}
                />
              </label>
            ) : null}
            <textarea
              data-testid="spine-evidence-body"
              value={evidenceBody}
              onChange={(event) => setEvidenceBody(event.target.value)}
              rows={3}
              placeholder="Paste notes, a CSV excerpt, or review extracted file text before adding it."
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
                commit(next);
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
        <label className="mt-3 block text-xs text-slate-300">
          What would change this recommendation?
          <textarea
            data-testid="spine-counterfactual"
            value={counterfactual}
            onChange={(event) => setCounterfactual(event.target.value)}
            rows={2}
            placeholder="The evidence or condition that would change this recommendation"
            className="mt-1 w-full rounded-xl border border-white/10 bg-[#080c10] px-3 py-2 text-sm text-white"
          />
        </label>
        <p className="mt-1 text-[11px] text-slate-500">
          Required before Accept is locked. Other dispositions can be recorded
          without it.
        </p>
        <label className="mt-3 block text-xs text-slate-300">
          Decision expiry (optional)
          <input
            data-testid="spine-decision-expiry"
            type="date"
            value={expiresOn}
            onChange={(event) => setExpiresOn(event.target.value)}
            className="mt-1 w-full rounded-lg border border-white/10 bg-[#080c10] px-3 py-2 text-sm text-white"
          />
        </label>
        <p className="mt-1 text-[11px] text-slate-500">
          Optional date on this decision. Sync does not auto-revoke or execute
          when it passes.
        </p>
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
              commit(
                applyDisposition(decisionCase, disposition, rationale, people, {
                  counterfactual,
                  expiresOn,
                }),
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
          <p
            data-testid="spine-outcome-attribution"
            className="mt-3 text-xs leading-relaxed text-slate-300"
          >
            {attribution.line}
          </p>
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
                commit(
                  applyVerificationPlan(decisionCase, {
                    ...verification,
                    attributedTo: people.verificationOwner,
                  }),
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
              commit(
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
        data-testid="spine-unknowns"
        className="rounded-2xl border border-white/10 bg-[#0D1520] p-4"
      >
        <h2 className="text-sm font-semibold text-white">
          What Sync does not know yet
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-300">
          {unknownsFromCase(decisionCase).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section
        data-testid="spine-audit"
        className="rounded-2xl border border-white/10 bg-[#0D1520] p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-white">Audit trail</h2>
          <button
            type="button"
            data-testid="spine-reload-audit"
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-100"
            onClick={() => void reloadTrail()}
          >
            Reload saved trail
          </button>
        </div>
        <ol className="mt-3 space-y-2">
          {decisionCase.messages.map((message) => (
            <li
              key={message.id}
              className="rounded-xl border border-white/10 px-3 py-2"
            >
              <p className="text-[10px] uppercase tracking-wide text-slate-500">
                {message.author}
                {message.meta ? ` · ${message.meta}` : ""}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-xs text-slate-200">
                {message.text}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section
        data-testid="spine-proof"
        className="rounded-2xl border border-white/10 bg-[#0D1520] p-4"
      >
        <h2 className="text-sm font-semibold text-white">Proof summary</h2>
        <p className="mt-1 text-xs text-slate-500">
          Read-only recap of Ask, evidence, recommendation, the human decision,
          and verification. Copy or download it here. This is not a separate
          vault.
        </p>
        <pre
          data-testid="spine-proof-body"
          className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-white/10 bg-[#080c10] px-3 py-2 text-[11px] leading-relaxed text-slate-200"
        >
          {proof}
        </pre>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            data-testid="spine-proof-copy"
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-100"
            onClick={() => {
              const clipboard = navigator.clipboard;
              if (!clipboard?.writeText) {
                setProofNotice(
                  "Copy is not available in this browser. The summary is still on the page.",
                );
                return;
              }
              void clipboard.writeText(proof).then(
                () => setProofNotice("Proof summary copied."),
                () =>
                  setProofNotice(
                    "Copy did not complete. The summary is still on the page.",
                  ),
              );
            }}
          >
            Copy summary
          </button>
          <button
            type="button"
            data-testid="spine-proof-download"
            className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-slate-100"
            onClick={() => {
              try {
                const blob = new Blob([proof], {
                  type: "text/markdown;charset=utf-8",
                });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = proofDownloadName(decisionCase.caseNumber);
                document.body.appendChild(anchor);
                anchor.click();
                anchor.remove();
                URL.revokeObjectURL(url);
                setProofNotice("Markdown download started in this browser.");
              } catch {
                setProofNotice(
                  "Markdown download is not available in this browser. The summary is still on the page.",
                );
              }
            }}
          >
            Download markdown
          </button>
        </div>
        {proofNotice ? (
          <p
            data-testid="spine-proof-notice"
            className="mt-2 text-xs text-slate-300"
          >
            {proofNotice}
          </p>
        ) : null}
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
            onClick={() => {
              if (
                blockWorkspacePersist ||
                isExamplePrompt(decisionCase.objective) ||
                isSeedDecisionCaseId(decisionCase.id)
              ) {
                return;
              }
              stageDecisionCaseHandoff(window.sessionStorage, decisionCase);
            }}
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
