/**
 * Sync Develop Slice 3C — the chains, on the Case Workspace surface.
 *
 *   * Stakeholder commitments (D3.08) with all seven spec-I.18 fields and
 *     the coverage detector (D3.09) rendered as a first-class verdict, not a
 *     footnote: the uncovered list is what the sentence "Community
 *     commitment C-42 has no corresponding project requirement" looks like
 *     when it is a query rather than a slide.
 *   * The regulatory approval chain (D3.10) — requirement → application →
 *     information request → approval → conditions — and, for every
 *     condition, WHERE IT LANDED (D3.11): the project requirement or the
 *     operations work order the propagation created.
 *   * Case assurance (D3.16) with independence level, verified reviewer
 *     competency, the conflicts declaration and the gate it informs.
 *
 * HONESTY RULES, inherited from the page this mounts on:
 *   * every refusal renders VERBATIM — the server's sentence is the
 *     product, and a client-side paraphrase would soften exactly the part
 *     that matters;
 *   * absence renders as absence: an uncovered commitment says so, an
 *     unpropagated condition says so, a coverage percentage over zero
 *     commitments is not shown at all;
 *   * nothing here computes a governed number. Coverage comes from
 *     get_case_commitment_coverage — the same function the gate blocker
 *     reads — through get_case_chains.
 */
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileCheck,
  Handshake,
  ShieldCheck,
  Stamp,
} from "lucide-react";
import {
  APPLICABILITY_GRADES,
  ASSURANCE_CONCLUSIONS,
  COMMITMENT_KINDS,
  OBLIGATION_DESTINATION,
  OBLIGATION_DOMAINS,
  QUALITY_GRADES,
  blockingCommitments,
  coverageHeadline,
  evidenceConfidence,
  type ApplicabilityGrade,
  type CaseChains,
  type EvidenceConfidenceWeights,
  type ObligationDomain,
  type QualityGrade,
} from "../../lib/develop/chains";
import { REQUIREMENT_CATEGORY_GROUPS } from "../../lib/develop/requirements";
import {
  adoptEvidenceConfidenceProfile,
  closeRegulatoryCondition,
  closeStakeholderCommitment,
  completeCaseAssuranceReview,
  createEvidenceConfidenceProfileVersion,
  getCaseChains,
  gradeEvidenceItem,
  linkCommitmentToRequirement,
  listEvidenceConfidenceProfiles,
  listStakeholders,
  propagateRegulatoryConditions,
  setEvidenceConfidenceWeights,
  submitCaseAssuranceReview,
  recordCaseRequirement,
  recordRegulatoryApproval,
  recordRegulatoryInformationRequest,
  recordRegulatoryRequirement,
  recordStakeholderCommitment,
  registerStakeholder,
  respondRegulatoryInformationRequest,
  submitRegulatoryApplication,
  withdrawStakeholderCommitment,
  type CaseStakeholderOption,
  type EvidenceConfidenceProfileRow,
  type OrgMember,
} from "../../services/developService";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";

const buttonClass =
  "rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-50";

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

function Pill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "good" | "bad" | "warn";
  children: ReactNode;
}) {
  const cls =
    tone === "good"
      ? "bg-emerald-400/10 text-emerald-300"
      : tone === "bad"
        ? "bg-red-400/10 text-red-300"
        : tone === "warn"
          ? "bg-amber-400/10 text-amber-300"
          : "bg-white/5 text-slate-400";
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}
    >
      {children}
    </span>
  );
}

/* ───────────────────────── D3.08 + D3.09 ───────────────────────── */

function CommitmentsSection({
  caseId,
  chains,
  members,
  canPlan,
  canReview,
  onChanged,
}: {
  caseId: string;
  chains: CaseChains;
  members: OrgMember[];
  canPlan: boolean;
  canReview: boolean;
  onChanged: () => void;
}) {
  const [stakeholders, setStakeholders] = useState<CaseStakeholderOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addingCommitment, setAddingCommitment] = useState(false);
  const [addingRequirement, setAddingRequirement] = useState(false);
  const [addingStakeholder, setAddingStakeholder] = useState(false);
  const [linkFor, setLinkFor] = useState<number | null>(null);
  const [linkRequirement, setLinkRequirement] = useState("");
  const [closeFor, setCloseFor] = useState<number | null>(null);
  const [withdrawFor, setWithdrawFor] = useState<number | null>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [closeEvidence, setCloseEvidence] = useState("");

  const [form, setForm] = useState({
    stakeholderId: "",
    commitmentRef: "",
    concern: "",
    commitment: "",
    ownerId: "",
    dueDate: "",
    commitmentKind: "community",
    requirementId: "",
  });
  const [reqForm, setReqForm] = useState({
    requirementRef: "",
    category: "functional",
    requirement: "",
    source: "engineering",
    ownerId: "",
    acceptanceCriteria: "",
  });
  const [stakeholderForm, setStakeholderForm] = useState({
    name: "",
    stakeholderType: "external",
    roleOrRelationship: "",
    externalOrganization: "",
  });

  const loadStakeholders = useCallback(async () => {
    try {
      setStakeholders(await listStakeholders());
    } catch {
      setStakeholders([]);
    }
  }, []);
  useEffect(() => {
    void loadStakeholders();
  }, [loadStakeholders]);

  const run = async (fn: () => Promise<unknown>, after: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The action was refused");
    } finally {
      setBusy(false);
    }
  };

  const coverage = chains.coverage;
  const blocking = blockingCommitments(coverage);

  return (
    <Section
      icon={<Handshake className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Stakeholder commitments and coverage"
      subtitle="What was committed, to whom, about which concern — with an owner, a date, the project requirement that carries it and the evidence that discharged it (spec I.18). A commitment no requirement covers is detected, not assumed away."
    >
      <ErrorLine error={error} />

      {/* The coverage verdict — the whole point of D3.09. */}
      <div
        className={`rounded-lg border px-3 py-2.5 ${
          coverage.uncoveredCount > 0
            ? "border-amber-400/30 bg-amber-400/5"
            : "border-white/8 bg-white/[0.02]"
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          {coverage.uncoveredCount > 0 ? (
            <AlertTriangle className="h-4 w-4 text-amber-300" aria-hidden />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-300" aria-hidden />
          )}
          <span className="text-sm text-slate-200">
            {coverageHeadline(coverage)}
          </span>
          {coverage.coveragePct != null && (
            <Pill tone={coverage.uncoveredCount > 0 ? "warn" : "good"}>
              {coverage.coveragePct}% covered
            </Pill>
          )}
        </div>
        {blocking.length > 0 && (
          <p className="mt-1.5 text-xs text-amber-200">
            {blocking.length} of them {blocking.length === 1 ? "is" : "are"}{" "}
            past its due date with nothing in the project delivering it — those
            block gate readiness by name until a requirement carries them or
            they are discharged.
          </p>
        )}
        {coverage.requirementsWithoutCommitment.length > 0 && (
          <p className="mt-1.5 text-[11px] text-slate-400">
            {coverage.requirementsWithoutCommitment.length} case requirement
            {coverage.requirementsWithoutCommitment.length === 1
              ? ""
              : "s"}{" "}
            back no commitment. That is informational — most requirements are
            engineering decisions rather than promises.
          </p>
        )}
      </div>

      {chains.commitments.length === 0 && (
        <p className="text-xs text-slate-500">
          No stakeholder commitments recorded on this case. Record what was
          promised — to a community, a landowner, a regulator, an employee group
          — and the coverage detector will say which promises the project has
          nothing delivering.
        </p>
      )}

      {chains.commitments.map((c) => (
        <div
          key={c.id}
          className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2.5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-200">
              {c.commitmentRef}
            </span>
            <Pill>{c.kind}</Pill>
            <Pill
              tone={
                c.status === "satisfied"
                  ? "good"
                  : c.status === "breached"
                    ? "bad"
                    : c.overdue
                      ? "warn"
                      : "neutral"
              }
            >
              {c.status}
            </Pill>
            {c.requirement == null ? (
              <Pill tone="warn">no project requirement</Pill>
            ) : (
              <Pill tone="good">covered by {c.requirement.ref}</Pill>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-200">{c.commitment}</p>
          <div className="mt-1 text-[11px] text-slate-400">
            To {c.stakeholder.name}
            {c.stakeholder.externalOrganization
              ? ` (${c.stakeholder.externalOrganization})`
              : ""}{" "}
            · concern: {c.concern} · owner {c.owner ?? c.ownerId} · due{" "}
            {c.dueDate}
            {c.breachedAt
              ? ` · breached ${new Date(c.breachedAt).toLocaleDateString()}`
              : ""}
          </div>
          {c.evidence && (
            <div className="mt-1 text-[11px] text-emerald-300">
              Discharged against evidence: {c.evidence.description} (
              {c.evidence.evidenceClass ?? "unclassified"},{" "}
              {c.evidence.verificationStatus})
            </div>
          )}

          {canPlan && c.status === "open" && c.requirement == null && (
            <div className="mt-2">
              {linkFor === c.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={linkRequirement}
                    onChange={(e) => setLinkRequirement(e.target.value)}
                    className={`${inputClass} max-w-md`}
                  >
                    <option value="">
                      Select the project requirement that carries it…
                    </option>
                    {chains.requirements.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.ref} — {r.requirement.slice(0, 70)}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={busy || linkRequirement === ""}
                    onClick={() =>
                      void run(
                        () =>
                          linkCommitmentToRequirement(
                            c.id,
                            Number(linkRequirement),
                          ),
                        () => {
                          setLinkFor(null);
                          setLinkRequirement("");
                        },
                      )
                    }
                    className={buttonClass}
                  >
                    Link
                  </button>
                  <button
                    onClick={() => setLinkFor(null)}
                    className="text-xs text-slate-400 hover:text-slate-200"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setLinkFor(c.id)}
                  className={buttonClass}
                  disabled={chains.requirements.length === 0}
                >
                  {chains.requirements.length === 0
                    ? "Record a project requirement first"
                    : "Link a project requirement"}
                </button>
              )}
            </div>
          )}

          {canReview && (c.status === "open" || c.status === "breached") && (
            <div className="mt-2">
              {closeFor === c.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={closeEvidence}
                    onChange={(e) => setCloseEvidence(e.target.value)}
                    className={`${inputClass} max-w-md`}
                  >
                    <option value="">
                      Select the evidence it was honoured…
                    </option>
                    {chains.evidenceConfidence.items.map((item) => (
                      <option key={item.evidenceId} value={item.evidenceId}>
                        {item.evidenceId.slice(0, 8)}…
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={busy || closeEvidence === ""}
                    onClick={() =>
                      void run(
                        () =>
                          closeStakeholderCommitment({
                            commitmentId: c.id,
                            evidenceId: closeEvidence,
                          }),
                        () => {
                          setCloseFor(null);
                          setCloseEvidence("");
                        },
                      )
                    }
                    className={buttonClass}
                  >
                    Discharge
                  </button>
                  <button
                    onClick={() => setCloseFor(null)}
                    className="text-xs text-slate-400 hover:text-slate-200"
                  >
                    Cancel
                  </button>
                </div>
              ) : withdrawFor === c.id ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={withdrawReason}
                    onChange={(e) => setWithdrawReason(e.target.value)}
                    placeholder="Why this promise no longer binds (20 characters minimum)"
                    className={`${inputClass} max-w-md`}
                  />
                  <button
                    disabled={busy || withdrawReason.trim().length < 20}
                    onClick={() =>
                      void run(
                        () =>
                          withdrawStakeholderCommitment({
                            commitmentId: c.id,
                            reason: withdrawReason.trim(),
                          }),
                        () => {
                          setWithdrawFor(null);
                          setWithdrawReason("");
                        },
                      )
                    }
                    className={buttonClass}
                  >
                    Withdraw this commitment
                  </button>
                  <button
                    onClick={() => setWithdrawFor(null)}
                    className="text-xs text-slate-400 hover:text-slate-200"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => setCloseFor(c.id)}
                    className={buttonClass}
                  >
                    Discharge with evidence
                  </button>
                  {/* D3.08: 'withdrawn' existed as a status with no act, which
                      made its own reason constraint and the coverage
                      detector's exclusion of it unreachable code. A promise is
                      retired with a stated reason and a named human (§70),
                      never by quietly dropping it. */}
                  <button
                    onClick={() => setWithdrawFor(c.id)}
                    className="text-xs text-slate-400 underline decoration-dotted hover:text-slate-200"
                  >
                    Withdraw with a stated reason
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      {canPlan && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={() => setAddingCommitment((v) => !v)}
            className={buttonClass}
          >
            {addingCommitment ? "Cancel" : "Record a commitment"}
          </button>
          <button
            onClick={() => setAddingRequirement((v) => !v)}
            className={buttonClass}
          >
            {addingRequirement ? "Cancel" : "Record a project requirement"}
          </button>
          {/* The ONE registry's write path (upsert_risk_stakeholder) admits
              governance and engineering roles only, so the affordance is
              gated on the same set the server enforces — offering a button
              that always refuses is worse than not offering it. */}
          {canReview && (
            <button
              onClick={() => setAddingStakeholder((v) => !v)}
              className={buttonClass}
            >
              {addingStakeholder ? "Cancel" : "Register a stakeholder"}
            </button>
          )}
        </div>
      )}

      {canReview && addingStakeholder && (
        <div className="grid gap-2 rounded-lg border border-white/8 p-3 sm:grid-cols-2">
          <input
            value={stakeholderForm.name}
            onChange={(e) =>
              setStakeholderForm({ ...stakeholderForm, name: e.target.value })
            }
            placeholder="Stakeholder name"
            className={inputClass}
          />
          <select
            value={stakeholderForm.stakeholderType}
            onChange={(e) =>
              setStakeholderForm({
                ...stakeholderForm,
                stakeholderType: e.target.value,
              })
            }
            className={inputClass}
          >
            <option value="external">External</option>
            <option value="internal">Internal</option>
          </select>
          <input
            value={stakeholderForm.roleOrRelationship}
            onChange={(e) =>
              setStakeholderForm({
                ...stakeholderForm,
                roleOrRelationship: e.target.value,
              })
            }
            placeholder="Role or relationship to this project"
            className={inputClass}
          />
          <input
            value={stakeholderForm.externalOrganization}
            onChange={(e) =>
              setStakeholderForm({
                ...stakeholderForm,
                externalOrganization: e.target.value,
              })
            }
            placeholder="Organization (optional)"
            className={inputClass}
          />
          <button
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  registerStakeholder({
                    name: stakeholderForm.name,
                    stakeholderType: stakeholderForm.stakeholderType,
                    roleOrRelationship: stakeholderForm.roleOrRelationship,
                    externalOrganization:
                      stakeholderForm.externalOrganization || null,
                  }),
                () => {
                  setAddingStakeholder(false);
                  setStakeholderForm({
                    name: "",
                    stakeholderType: "external",
                    roleOrRelationship: "",
                    externalOrganization: "",
                  });
                  void loadStakeholders();
                },
              )
            }
            className={`${buttonClass} sm:col-span-2`}
          >
            Register on the one stakeholder registry
          </button>
        </div>
      )}

      {canPlan && addingRequirement && (
        <div className="grid gap-2 rounded-lg border border-white/8 p-3 sm:grid-cols-2">
          <input
            value={reqForm.requirementRef}
            onChange={(e) =>
              setReqForm({ ...reqForm, requirementRef: e.target.value })
            }
            placeholder="Reference (e.g. PR-014)"
            className={inputClass}
          />
          {/* Slice 5A / D4.16: the ELEVEN §10 categories, offered first, with
              the five reliability-by-design categories this table predates §10
              with kept below them. A form offering only nine left seven of the
              spec's eleven legal in the table and unwritable through the
              product. */}
          <select
            value={reqForm.category}
            onChange={(e) =>
              setReqForm({ ...reqForm, category: e.target.value })
            }
            className={inputClass}
          >
            {REQUIREMENT_CATEGORY_GROUPS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <textarea
            value={reqForm.requirement}
            onChange={(e) =>
              setReqForm({ ...reqForm, requirement: e.target.value })
            }
            placeholder="What must be true"
            className={`${inputClass} sm:col-span-2`}
            rows={2}
          />
          {/* §10's owner_id and acceptance_criteria. Both optional at the
              table (a requirement recorded before this slice has neither and
              no owner may be invented for it) and both offered here, because
              the Requirements Agent reports their absence and a finding
              nobody can clear from the product is a complaint, not a finding. */}
          <select
            value={reqForm.ownerId}
            onChange={(e) =>
              setReqForm({ ...reqForm, ownerId: e.target.value })
            }
            className={inputClass}
          >
            <option value="">Owner — nobody accountable yet…</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name ?? m.email ?? m.id}
              </option>
            ))}
          </select>
          <input
            value={reqForm.acceptanceCriteria}
            onChange={(e) =>
              setReqForm({ ...reqForm, acceptanceCriteria: e.target.value })
            }
            placeholder="Acceptance criteria — what 'met' means, measurably"
            className={inputClass}
          />
          <button
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  recordCaseRequirement(caseId, {
                    requirementRef: reqForm.requirementRef,
                    category: reqForm.category,
                    requirement: reqForm.requirement,
                    source: reqForm.source,
                    ownerId: reqForm.ownerId || null,
                    acceptanceCriteria: reqForm.acceptanceCriteria || null,
                  }),
                () => {
                  setAddingRequirement(false);
                  setReqForm({
                    requirementRef: "",
                    category: "functional",
                    requirement: "",
                    source: "engineering",
                    ownerId: "",
                    acceptanceCriteria: "",
                  });
                },
              )
            }
            className={`${buttonClass} sm:col-span-2`}
          >
            Record on the one project requirement table
          </button>
        </div>
      )}

      {canPlan && addingCommitment && (
        <div className="grid gap-2 rounded-lg border border-white/8 p-3 sm:grid-cols-2">
          <select
            value={form.stakeholderId}
            onChange={(e) =>
              setForm({ ...form, stakeholderId: e.target.value })
            }
            className={inputClass}
          >
            <option value="">Stakeholder…</option>
            {stakeholders.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.external_organization ? ` · ${s.external_organization}` : ""}
              </option>
            ))}
          </select>
          <select
            value={form.commitmentKind}
            onChange={(e) =>
              setForm({ ...form, commitmentKind: e.target.value })
            }
            className={inputClass}
          >
            {COMMITMENT_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
          <input
            value={form.commitmentRef}
            onChange={(e) =>
              setForm({ ...form, commitmentRef: e.target.value })
            }
            placeholder="Reference (e.g. C-42)"
            className={inputClass}
          />
          <input
            type="date"
            value={form.dueDate}
            onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
            className={inputClass}
          />
          <input
            value={form.concern}
            onChange={(e) => setForm({ ...form, concern: e.target.value })}
            placeholder="The concern this answers"
            className={inputClass}
          />
          <select
            value={form.ownerId}
            onChange={(e) => setForm({ ...form, ownerId: e.target.value })}
            className={inputClass}
          >
            <option value="">Owner…</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.full_name ?? m.email ?? m.id}
              </option>
            ))}
          </select>
          <textarea
            value={form.commitment}
            onChange={(e) => setForm({ ...form, commitment: e.target.value })}
            placeholder="What was committed"
            className={`${inputClass} sm:col-span-2`}
            rows={2}
          />
          <select
            value={form.requirementId}
            onChange={(e) =>
              setForm({ ...form, requirementId: e.target.value })
            }
            className={`${inputClass} sm:col-span-2`}
          >
            <option value="">
              Project requirement — leave empty and the coverage detector will
              report it as uncovered
            </option>
            {chains.requirements.map((r) => (
              <option key={r.id} value={r.id}>
                {r.ref} — {r.requirement.slice(0, 70)}
              </option>
            ))}
          </select>
          <button
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  recordStakeholderCommitment(caseId, {
                    stakeholderId: form.stakeholderId,
                    commitmentRef: form.commitmentRef,
                    concern: form.concern,
                    commitment: form.commitment,
                    ownerId: form.ownerId,
                    dueDate: form.dueDate,
                    commitmentKind: form.commitmentKind,
                    requirementId:
                      form.requirementId === ""
                        ? null
                        : Number(form.requirementId),
                  }),
                () => {
                  setAddingCommitment(false);
                  setForm({
                    stakeholderId: "",
                    commitmentRef: "",
                    concern: "",
                    commitment: "",
                    ownerId: "",
                    dueDate: "",
                    commitmentKind: "community",
                    requirementId: "",
                  });
                },
              )
            }
            className={`${buttonClass} sm:col-span-2`}
          >
            Record the commitment
          </button>
        </div>
      )}
    </Section>
  );
}

/* ───────────────────────── D3.10 + D3.11 ───────────────────────── */

function RegulatorySection({
  caseId,
  chains,
  members,
  canPlan,
  canReview,
  onChanged,
}: {
  caseId: string;
  chains: CaseChains;
  members: OrgMember[];
  canPlan: boolean;
  canReview: boolean;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [applyFor, setApplyFor] = useState<number | null>(null);
  const [decideFor, setDecideFor] = useState<number | null>(null);
  const [rfiFor, setRfiFor] = useState<number | null>(null);

  const [reqForm, setReqForm] = useState({
    requirementRef: "",
    regulator: "",
    jurisdiction: "",
    instrument: "",
    permitType: "",
    description: "",
    triggerCondition: "",
    // NOT "90". A pre-filled lead time is a guess the form makes on the
    // planner's behalf, and every downstream surface — the badge, the
    // expected_decision_by projection, the critical path spec I.19 exists to
    // put the permit on — then presents that guess as a stated fact. The
    // server refuses a missing lead time by name; that refusal is what the
    // user should meet.
    expectedLeadTimeDays: "",
    sourceAuthority: "REGULATION",
    requiredByDate: "",
  });
  const [appForm, setAppForm] = useState({
    applicationRef: "",
    scopeDescription: "",
  });
  const [rfiForm, setRfiForm] = useState({
    requestRef: "",
    requestDetail: "",
    ownerId: "",
    responseDue: "",
  });
  const [decisionForm, setDecisionForm] = useState({
    permitNumber: "",
    decidingAuthority: "",
    decision: "granted_with_conditions",
    expiresAt: "",
    // D3.20: the server refuses a decision with no expiry unless perpetual is
    // declared EXPLICITLY. Without this control the refusal named a remedy
    // the screen did not offer, and the only way forward was to invent an
    // expiry date — which is the exact failure the guard exists to prevent.
    perpetual: false,
    refusalReason: "",
  });
  const [condition, setCondition] = useState({
    condition_ref: "",
    description: "",
    obligation_domain: "monitoring" as ObligationDomain,
    owner_id: "",
    due_date: "",
    evidence_requirement: "",
    consequence_if_missed: "",
    recurrence: "one_time",
  });

  const run = async (fn: () => Promise<unknown>, after: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The action was refused");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<Stamp className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Regulatory approval chain"
      subtitle="Permits out of spreadsheets (spec I.19): requirement → application → information request → approval → conditions. An approval's conditions PROPAGATE — engineering and construction obligations become project requirements, operating, monitoring and reporting obligations become operations work orders."
    >
      <ErrorLine error={error} />

      {chains.regulatory.length === 0 && (
        <p className="text-xs text-slate-500">
          No regulatory requirements identified for this case. Record the
          permits this project needs, with the regulator&apos;s expected lead
          time, and the chain sits on the critical path instead of in somebody
          else&apos;s spreadsheet.
        </p>
      )}

      {chains.regulatory.map((rr) => (
        <div
          key={rr.id}
          className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2.5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-200">
              {rr.ref}
            </span>
            <Pill>{rr.sourceAuthority}</Pill>
            <Pill
              tone={
                rr.status === "granted"
                  ? "good"
                  : rr.status === "refused"
                    ? "bad"
                    : "neutral"
              }
            >
              {rr.status}
            </Pill>
            <span className="text-[11px] text-slate-400">
              {rr.regulator} · {rr.jurisdiction} · {rr.permitType} · lead{" "}
              {rr.expectedLeadTimeDays}d
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-200">{rr.description}</p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Instrument: {rr.instrument} · trigger: {rr.triggerCondition}
            {rr.requiredByDate ? ` · needed by ${rr.requiredByDate}` : ""}
          </p>

          {rr.applications.map((app) => (
            <div
              key={app.id}
              className="mt-2 rounded border border-white/8 px-2.5 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-semibold text-slate-300">
                  Application {app.ref}
                </span>
                <Pill>{app.status}</Pill>
                {app.submittedAt && (
                  <span className="text-[10px] text-slate-500">
                    submitted {new Date(app.submittedAt).toLocaleDateString()}
                    {app.submittedBy ? ` by ${app.submittedBy}` : ""}
                  </span>
                )}
              </div>

              {app.informationRequests.map((q) => (
                <div key={q.id} className="mt-1.5 text-[11px]">
                  <span
                    className={q.overdue ? "text-amber-300" : "text-slate-400"}
                  >
                    RFI {q.ref} — {q.detail} · due {q.responseDue} · {q.status}
                    {q.owner ? ` · owner ${q.owner}` : ""}
                  </span>
                  {canPlan && q.status !== "responded" && (
                    <button
                      disabled={
                        busy || chains.evidenceConfidence.items.length === 0
                      }
                      onClick={() =>
                        void run(
                          () =>
                            respondRegulatoryInformationRequest({
                              requestId: q.id,
                              evidenceId:
                                chains.evidenceConfidence.items[0]
                                  ?.evidenceId ?? "",
                            }),
                          () => undefined,
                        )
                      }
                      className="ml-2 text-[10px] text-signal-cyan hover:underline disabled:opacity-40"
                    >
                      Answer with the latest case evidence
                    </button>
                  )}
                </div>
              ))}

              {app.approval && (
                <div className="mt-2 rounded border border-white/8 bg-white/[0.02] px-2.5 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold text-slate-200">
                      Permit {app.approval.permitNumber}
                    </span>
                    <Pill
                      tone={
                        app.approval.decision === "refused"
                          ? "bad"
                          : app.approval.lapsed
                            ? "bad"
                            : "good"
                      }
                    >
                      {app.approval.decision}
                    </Pill>
                    {app.approval.lapsed && <Pill tone="bad">LAPSED</Pill>}
                    <span className="text-[10px] text-slate-500">
                      {app.approval.decidingAuthority} ·{" "}
                      {app.approval.decisionDate}
                      {app.approval.perpetual
                        ? " · perpetual"
                        : app.approval.expiresAt
                          ? ` · expires ${app.approval.expiresAt}`
                          : ""}
                    </span>
                  </div>
                  {app.approval.refusalReason && (
                    <p className="mt-1 text-[11px] text-red-300">
                      {app.approval.refusalReason}
                    </p>
                  )}

                  {app.approval.conditions.map((rc) => (
                    <div
                      key={rc.id}
                      className="mt-1.5 rounded border border-white/8 px-2 py-1.5"
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-semibold text-slate-300">
                          {rc.ref}
                        </span>
                        <Pill>{rc.obligationDomain}</Pill>
                        {rc.recurrence !== "one_time" && (
                          <Pill>{rc.recurrence}</Pill>
                        )}
                        <Pill
                          tone={
                            rc.status === "satisfied"
                              ? "good"
                              : rc.overdue
                                ? "bad"
                                : "neutral"
                          }
                        >
                          {rc.status}
                        </Pill>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-300">
                        {rc.description}
                      </p>
                      <p className="mt-0.5 text-[10px] text-slate-500">
                        Owner {rc.owner ?? "unassigned"} · due {rc.dueDate} ·
                        evidence required: {rc.evidenceRequirement} ·
                        consequence if missed: {rc.consequenceIfMissed}
                      </p>
                      {rc.propagation == null ? (
                        <p className="mt-0.5 text-[10px] text-amber-300">
                          Not yet propagated — this obligation exists only here.
                        </p>
                      ) : (
                        <p className="mt-0.5 text-[10px] text-emerald-300">
                          Landed in{" "}
                          {rc.propagation.requirement
                            ? `project requirement ${rc.propagation.requirement.ref} (${rc.propagation.requirement.verificationStatus})`
                            : rc.propagation.workOrder
                              ? `operations work order ${rc.propagation.workOrder.number ?? rc.propagation.workOrder.id.slice(0, 8)}${rc.propagation.workOrder.asset ? ` on ${rc.propagation.workOrder.asset}` : ""} (${rc.propagation.workOrder.status ?? "pending"})`
                              : "an unrecorded destination"}
                        </p>
                      )}
                      {canReview &&
                        (rc.status === "open" || rc.status === "missed") &&
                        chains.evidenceConfidence.items.length > 0 && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () =>
                                  closeRegulatoryCondition({
                                    conditionId: rc.id,
                                    evidenceId:
                                      chains.evidenceConfidence.items[0]
                                        ?.evidenceId ?? "",
                                  }),
                                () => undefined,
                              )
                            }
                            className="mt-1 text-[10px] text-signal-cyan hover:underline"
                          >
                            Discharge with the latest case evidence
                          </button>
                        )}
                    </div>
                  ))}

                  {canReview && app.approval.conditions.length > 0 && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => propagateRegulatoryConditions(app.approval!.id),
                          () => undefined,
                        )
                      }
                      className={`${buttonClass} mt-2`}
                    >
                      Re-run propagation
                    </button>
                  )}
                </div>
              )}

              {canPlan && app.status !== "decided" && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    onClick={() => setRfiFor(rfiFor === app.id ? null : app.id)}
                    className={buttonClass}
                  >
                    {rfiFor === app.id ? "Cancel" : "Record an RFI"}
                  </button>
                  {canReview && (
                    <button
                      onClick={() =>
                        setDecideFor(decideFor === app.id ? null : app.id)
                      }
                      className={buttonClass}
                    >
                      {decideFor === app.id
                        ? "Cancel"
                        : "Record the regulator's decision"}
                    </button>
                  )}
                </div>
              )}

              {canPlan && rfiFor === app.id && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <input
                    value={rfiForm.requestRef}
                    onChange={(e) =>
                      setRfiForm({ ...rfiForm, requestRef: e.target.value })
                    }
                    placeholder="RFI reference"
                    className={inputClass}
                  />
                  <input
                    type="date"
                    value={rfiForm.responseDue}
                    onChange={(e) =>
                      setRfiForm({ ...rfiForm, responseDue: e.target.value })
                    }
                    className={inputClass}
                  />
                  <select
                    value={rfiForm.ownerId}
                    onChange={(e) =>
                      setRfiForm({ ...rfiForm, ownerId: e.target.value })
                    }
                    className={inputClass}
                  >
                    <option value="">Owner…</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name ?? m.email ?? m.id}
                      </option>
                    ))}
                  </select>
                  <input
                    value={rfiForm.requestDetail}
                    onChange={(e) =>
                      setRfiForm({ ...rfiForm, requestDetail: e.target.value })
                    }
                    placeholder="What the regulator asked for"
                    className={inputClass}
                  />
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          recordRegulatoryInformationRequest({
                            applicationId: app.id,
                            requestRef: rfiForm.requestRef,
                            requestDetail: rfiForm.requestDetail,
                            ownerId: rfiForm.ownerId,
                            responseDue: rfiForm.responseDue,
                          }),
                        () => {
                          setRfiFor(null);
                          setRfiForm({
                            requestRef: "",
                            requestDetail: "",
                            ownerId: "",
                            responseDue: "",
                          });
                        },
                      )
                    }
                    className={`${buttonClass} sm:col-span-2`}
                  >
                    Record the information request
                  </button>
                </div>
              )}

              {canReview && decideFor === app.id && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <input
                    value={decisionForm.permitNumber}
                    onChange={(e) =>
                      setDecisionForm({
                        ...decisionForm,
                        permitNumber: e.target.value,
                      })
                    }
                    placeholder="Permit / instrument number"
                    className={inputClass}
                  />
                  <input
                    value={decisionForm.decidingAuthority}
                    onChange={(e) =>
                      setDecisionForm({
                        ...decisionForm,
                        decidingAuthority: e.target.value,
                      })
                    }
                    placeholder="Deciding authority"
                    className={inputClass}
                  />
                  <select
                    value={decisionForm.decision}
                    onChange={(e) =>
                      setDecisionForm({
                        ...decisionForm,
                        decision: e.target.value,
                      })
                    }
                    className={inputClass}
                  >
                    <option value="granted">Granted</option>
                    <option value="granted_with_conditions">
                      Granted with conditions
                    </option>
                    <option value="refused">Refused</option>
                  </select>
                  <input
                    type="date"
                    value={decisionForm.expiresAt}
                    disabled={decisionForm.perpetual}
                    onChange={(e) =>
                      setDecisionForm({
                        ...decisionForm,
                        expiresAt: e.target.value,
                      })
                    }
                    placeholder="Expiry"
                    className={inputClass}
                  />
                  <label className="flex items-start gap-2 text-[11px] text-slate-400 sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={decisionForm.perpetual}
                      onChange={(e) =>
                        setDecisionForm({
                          ...decisionForm,
                          perpetual: e.target.checked,
                          expiresAt: e.target.checked
                            ? ""
                            : decisionForm.expiresAt,
                        })
                      }
                      className="mt-0.5"
                    />
                    <span>
                      Perpetual — this instrument states no expiry (D3.20). Tick
                      this only when the regulator granted it without one; an
                      invented expiry date and an unstated one are both worse
                      than saying so.
                    </span>
                  </label>
                  {decisionForm.decision === "refused" && (
                    <input
                      value={decisionForm.refusalReason}
                      onChange={(e) =>
                        setDecisionForm({
                          ...decisionForm,
                          refusalReason: e.target.value,
                        })
                      }
                      placeholder="The regulator's stated reason"
                      className={`${inputClass} sm:col-span-2`}
                    />
                  )}
                  {decisionForm.decision === "granted_with_conditions" && (
                    <>
                      <div className="sm:col-span-2 text-[11px] text-slate-400">
                        Every condition is born complete and routes to{" "}
                        {OBLIGATION_DESTINATION[condition.obligation_domain]}.
                      </div>
                      <input
                        value={condition.condition_ref}
                        onChange={(e) =>
                          setCondition({
                            ...condition,
                            condition_ref: e.target.value,
                          })
                        }
                        placeholder="Condition reference"
                        className={inputClass}
                      />
                      <select
                        value={condition.obligation_domain}
                        onChange={(e) =>
                          setCondition({
                            ...condition,
                            obligation_domain: e.target
                              .value as ObligationDomain,
                          })
                        }
                        className={inputClass}
                      >
                        {OBLIGATION_DOMAINS.map((d) => (
                          <option key={d.value} value={d.value}>
                            {d.label} → {OBLIGATION_DESTINATION[d.value]}
                          </option>
                        ))}
                      </select>
                      <input
                        value={condition.description}
                        onChange={(e) =>
                          setCondition({
                            ...condition,
                            description: e.target.value,
                          })
                        }
                        placeholder="What the condition demands"
                        className={`${inputClass} sm:col-span-2`}
                      />
                      <select
                        value={condition.owner_id}
                        onChange={(e) =>
                          setCondition({
                            ...condition,
                            owner_id: e.target.value,
                          })
                        }
                        className={inputClass}
                      >
                        <option value="">Condition owner…</option>
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.full_name ?? m.email ?? m.id}
                          </option>
                        ))}
                      </select>
                      <input
                        type="date"
                        value={condition.due_date}
                        onChange={(e) =>
                          setCondition({
                            ...condition,
                            due_date: e.target.value,
                          })
                        }
                        className={inputClass}
                      />
                      <input
                        value={condition.evidence_requirement}
                        onChange={(e) =>
                          setCondition({
                            ...condition,
                            evidence_requirement: e.target.value,
                          })
                        }
                        placeholder="Evidence required to discharge it"
                        className={inputClass}
                      />
                      <input
                        value={condition.consequence_if_missed}
                        onChange={(e) =>
                          setCondition({
                            ...condition,
                            consequence_if_missed: e.target.value,
                          })
                        }
                        placeholder="Consequence if missed"
                        className={inputClass}
                      />
                      <select
                        value={condition.recurrence}
                        onChange={(e) =>
                          setCondition({
                            ...condition,
                            recurrence: e.target.value,
                          })
                        }
                        className={inputClass}
                      >
                        <option value="one_time">One time</option>
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="annual">Annual</option>
                      </select>
                    </>
                  )}
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          recordRegulatoryApproval({
                            applicationId: app.id,
                            permitNumber: decisionForm.permitNumber,
                            decidingAuthority: decisionForm.decidingAuthority,
                            decision: decisionForm.decision,
                            expiresAt: decisionForm.perpetual
                              ? null
                              : decisionForm.expiresAt || null,
                            perpetual: decisionForm.perpetual,
                            refusalReason: decisionForm.refusalReason || null,
                            conditions:
                              decisionForm.decision ===
                              "granted_with_conditions"
                                ? [condition]
                                : [],
                          }),
                        () => setDecideFor(null),
                      )
                    }
                    className={`${buttonClass} sm:col-span-2`}
                  >
                    Record the decision (conditions propagate immediately)
                  </button>
                </div>
              )}
            </div>
          ))}

          {canPlan &&
            rr.status !== "granted" &&
            rr.status !== "not_required" && (
              <div className="mt-2">
                {applyFor === rr.id ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input
                      value={appForm.applicationRef}
                      onChange={(e) =>
                        setAppForm({
                          ...appForm,
                          applicationRef: e.target.value,
                        })
                      }
                      placeholder="Application reference"
                      className={inputClass}
                    />
                    <input
                      value={appForm.scopeDescription}
                      onChange={(e) =>
                        setAppForm({
                          ...appForm,
                          scopeDescription: e.target.value,
                        })
                      }
                      placeholder="What the application covers"
                      className={inputClass}
                    />
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            submitRegulatoryApplication({
                              requirementId: rr.id,
                              applicationRef: appForm.applicationRef,
                              scopeDescription: appForm.scopeDescription,
                            }),
                          () => {
                            setApplyFor(null);
                            setAppForm({
                              applicationRef: "",
                              scopeDescription: "",
                            });
                          },
                        )
                      }
                      className={`${buttonClass} sm:col-span-2`}
                    >
                      Submit the application
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setApplyFor(rr.id)}
                    className={buttonClass}
                  >
                    Submit an application
                  </button>
                )}
              </div>
            )}
        </div>
      ))}

      {canPlan && (
        <button onClick={() => setAdding((v) => !v)} className={buttonClass}>
          {adding ? "Cancel" : "Identify a regulatory requirement"}
        </button>
      )}

      {canPlan && adding && (
        <div className="grid gap-2 rounded-lg border border-white/8 p-3 sm:grid-cols-2">
          <input
            value={reqForm.requirementRef}
            onChange={(e) =>
              setReqForm({ ...reqForm, requirementRef: e.target.value })
            }
            placeholder="Reference (e.g. REG-01)"
            className={inputClass}
          />
          <select
            value={reqForm.sourceAuthority}
            onChange={(e) =>
              setReqForm({ ...reqForm, sourceAuthority: e.target.value })
            }
            className={inputClass}
          >
            <option value="REGULATION">REGULATION</option>
            <option value="LAW">LAW</option>
          </select>
          <input
            value={reqForm.regulator}
            onChange={(e) =>
              setReqForm({ ...reqForm, regulator: e.target.value })
            }
            placeholder="Regulator"
            className={inputClass}
          />
          <input
            value={reqForm.jurisdiction}
            onChange={(e) =>
              setReqForm({ ...reqForm, jurisdiction: e.target.value })
            }
            placeholder="Jurisdiction"
            className={inputClass}
          />
          <input
            value={reqForm.instrument}
            onChange={(e) =>
              setReqForm({ ...reqForm, instrument: e.target.value })
            }
            placeholder="Instrument (the act or regulation)"
            className={inputClass}
          />
          <input
            value={reqForm.permitType}
            onChange={(e) =>
              setReqForm({ ...reqForm, permitType: e.target.value })
            }
            placeholder="Permit type"
            className={inputClass}
          />
          <input
            value={reqForm.triggerCondition}
            onChange={(e) =>
              setReqForm({ ...reqForm, triggerCondition: e.target.value })
            }
            placeholder="What triggers the duty"
            className={inputClass}
          />
          <input
            type="number"
            min={1}
            value={reqForm.expectedLeadTimeDays}
            onChange={(e) =>
              setReqForm({ ...reqForm, expectedLeadTimeDays: e.target.value })
            }
            placeholder="Expected regulator lead time (days)"
            className={inputClass}
          />
          <textarea
            value={reqForm.description}
            onChange={(e) =>
              setReqForm({ ...reqForm, description: e.target.value })
            }
            placeholder="What the requirement demands"
            className={`${inputClass} sm:col-span-2`}
            rows={2}
          />
          <button
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  recordRegulatoryRequirement(caseId, {
                    requirementRef: reqForm.requirementRef,
                    regulator: reqForm.regulator,
                    jurisdiction: reqForm.jurisdiction,
                    instrument: reqForm.instrument,
                    permitType: reqForm.permitType,
                    description: reqForm.description,
                    triggerCondition: reqForm.triggerCondition,
                    expectedLeadTimeDays: Number(reqForm.expectedLeadTimeDays),
                    sourceAuthority: reqForm.sourceAuthority,
                    requiredByDate: reqForm.requiredByDate || null,
                  }),
                () => setAdding(false),
              )
            }
            className={`${buttonClass} sm:col-span-2`}
          >
            Identify the requirement
          </button>
        </div>
      )}
    </Section>
  );
}

/* ───────────────────────────── D3.16 ───────────────────────────── */

function AssuranceSection({
  caseId,
  chains,
  gates,
  canReview,
  onChanged,
}: {
  caseId: string;
  chains: CaseChains;
  gates: { id: number; name: string }[];
  canReview: boolean;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    assuranceLevel: "independent",
    scope: "",
    competencies: "",
    competencyBasis: "",
    conflicts: "",
    conflictMitigation: "",
    gateId: "",
    // NOT a default of `true`. An explicit nil conflicts return and "nobody
    // was asked" are different facts the schema keeps different
    // (conflicts_declared = [] WITH a timestamp versus a null timestamp), and
    // the first draft of this form asserted the declaration unconditionally
    // from a literal in the JSX — producing the timestamp whether or not the
    // reviewer had ever been asked. The control below is how the reviewer
    // states it; the server refuses an independent review that leaves it
    // unstated, which is the refusal this default used to defeat.
    declarationMade: false,
  });
  /** The completion form: the conclusion and the evidence are the reviewer's,
   *  never the component's. The first draft hardcoded `conclusion:
   *  "acceptable"` and took whichever evidence item happened to be first. */
  const [completeFor, setCompleteFor] = useState<string | null>(null);
  const [conclusion, setConclusion] = useState("acceptable");
  const [conclusionEvidence, setConclusionEvidence] = useState<string[]>([]);

  const run = async (fn: () => Promise<unknown>, after: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The action was refused");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<ShieldCheck className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Independent assurance"
      subtitle="Spec II.15: independence level, reviewer, VERIFIED reviewer competency, declared conflicts of interest and the gate the review informs. The case sponsor or creator cannot independently assure their own case, and a competency the reviewer does not currently hold on the roster refuses the review by name."
    >
      <ErrorLine error={error} />

      {chains.assurance.length === 0 && (
        <p className="text-xs text-slate-500">
          No assurance review of this case. Where the adopted governance
          intensity demands independent assurance, gate readiness names the
          absence as a blocker until a completed, acceptable review exists.
        </p>
      )}

      {chains.assurance.map((ar) => (
        <div
          key={ar.id}
          className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2.5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={ar.level === "independent" ? "good" : "neutral"}>
              {ar.level.replaceAll("_", " ")}
            </Pill>
            <Pill
              tone={
                ar.status === "completed"
                  ? ar.conclusion === "not_acceptable"
                    ? "bad"
                    : "good"
                  : "neutral"
              }
            >
              {ar.status}
              {ar.conclusion ? ` · ${ar.conclusion.replaceAll("_", " ")}` : ""}
            </Pill>
            {ar.gate && <Pill>gate: {ar.gate.name}</Pill>}
          </div>
          <p className="mt-1 text-sm text-slate-200">{ar.scope}</p>
          <div className="mt-1 text-[11px] text-slate-400">
            Reviewer {ar.reviewer ?? ar.reviewerId}
            {ar.subjectOwner ? ` · subject owner ${ar.subjectOwner}` : ""}
            {ar.competencies.length > 0
              ? ` · competencies verified: ${ar.competencies.join(", ")}`
              : ""}
          </div>
          <div className="mt-1 text-[11px]">
            {ar.conflictsDeclaredAt == null ? (
              <span className="text-amber-300">
                No conflicts-of-interest declaration recorded — nobody was
                asked.
              </span>
            ) : ar.conflictsDeclared.length === 0 ? (
              <span className="text-emerald-300">
                Conflicts declared: none, explicitly, on{" "}
                {new Date(ar.conflictsDeclaredAt).toLocaleDateString()}.
              </span>
            ) : (
              <span className="text-amber-300">
                {ar.conflictsDeclared.length} conflict
                {ar.conflictsDeclared.length === 1 ? "" : "s"} declared:{" "}
                {ar.conflictsDeclared
                  .map((c) => `${c.conflict} → mitigated by ${c.mitigation}`)
                  .join("; ")}
              </span>
            )}
          </div>
          {canReview && ar.status !== "completed" && (
            <div className="mt-2 space-y-2">
              {chains.evidenceConfidence.items.length === 0 ? (
                <p className="text-[11px] text-amber-200">
                  This case carries no evidence, and a completed assurance
                  review carries the evidence it examined. Record the evidence
                  this review looked at before concluding it.
                </p>
              ) : completeFor === ar.id ? (
                <div className="grid gap-2 rounded-lg border border-white/8 p-3 sm:grid-cols-2">
                  <select
                    value={conclusion}
                    onChange={(e) => setConclusion(e.target.value)}
                    className={inputClass}
                  >
                    {ASSURANCE_CONCLUSIONS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <select
                    multiple
                    value={conclusionEvidence}
                    onChange={(e) =>
                      setConclusionEvidence(
                        Array.from(e.target.selectedOptions).map(
                          (o) => o.value,
                        ),
                      )
                    }
                    className={`${inputClass} h-24`}
                  >
                    {chains.evidenceConfidence.items.map((i) => (
                      <option key={i.evidenceId} value={i.evidenceId}>
                        {i.description ?? i.evidenceId.slice(0, 8)} (
                        {i.verificationStatus})
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-slate-500 sm:col-span-2">
                    The conclusion and the evidence behind it are the
                    reviewer&apos;s determination (§70). Select the evidence
                    this review actually examined — a conclusion resting on
                    whichever item happened to be first is not that
                    reviewer&apos;s conclusion.
                  </p>
                  <button
                    disabled={busy || conclusionEvidence.length === 0}
                    onClick={() =>
                      void run(
                        () =>
                          completeCaseAssuranceReview({
                            reviewId: ar.id,
                            conclusion,
                            evidenceItemIds: conclusionEvidence,
                          }),
                        () => {
                          setCompleteFor(null);
                          setConclusionEvidence([]);
                        },
                      )
                    }
                    className={`${buttonClass} sm:col-span-2`}
                  >
                    Complete this review with the stated conclusion
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setCompleteFor(ar.id);
                    setConclusionEvidence([]);
                  }}
                  className={buttonClass}
                >
                  Complete this review
                </button>
              )}
            </div>
          )}
        </div>
      ))}

      {canReview && (
        <button onClick={() => setAdding((v) => !v)} className={buttonClass}>
          {adding ? "Cancel" : "Record an assurance review"}
        </button>
      )}

      {canReview && adding && (
        <div className="grid gap-2 rounded-lg border border-white/8 p-3 sm:grid-cols-2">
          <select
            value={form.assuranceLevel}
            onChange={(e) =>
              setForm({ ...form, assuranceLevel: e.target.value })
            }
            className={inputClass}
          >
            <option value="line_1">Line 1 (self-review)</option>
            <option value="line_2">Line 2 (oversight function)</option>
            <option value="independent">Independent</option>
          </select>
          <input
            value={form.competencies}
            onChange={(e) => setForm({ ...form, competencies: e.target.value })}
            placeholder="Required competency keys, comma separated"
            className={inputClass}
          />
          <textarea
            value={form.scope}
            onChange={(e) => setForm({ ...form, scope: e.target.value })}
            placeholder="What this review examines"
            className={`${inputClass} sm:col-span-2`}
            rows={2}
          />
          <input
            value={form.competencyBasis}
            onChange={(e) =>
              setForm({ ...form, competencyBasis: e.target.value })
            }
            placeholder="Competency basis — why this reviewer is competent to give it"
            className={inputClass}
          />
          <select
            value={form.gateId}
            onChange={(e) => setForm({ ...form, gateId: e.target.value })}
            className={inputClass}
          >
            <option value="">
              No gate — a case-wide review, satisfying no gate&apos;s demand
            </option>
            {gates.map((g) => (
              <option key={g.id} value={String(g.id)}>
                Informs {g.name}
              </option>
            ))}
          </select>
          <input
            value={form.conflicts}
            onChange={(e) => setForm({ ...form, conflicts: e.target.value })}
            placeholder="Declared conflict (leave empty for an explicit nil return)"
            className={inputClass}
          />
          <input
            value={form.conflictMitigation}
            onChange={(e) =>
              setForm({ ...form, conflictMitigation: e.target.value })
            }
            placeholder="How it is mitigated"
            className={inputClass}
          />
          {/* The DECLARATION is an act with a time, distinct from its
              contents. An empty array WITH a timestamp says "I considered
              this and declare none"; a null timestamp says nobody was asked.
              Asserting the first from a literal, as the first draft did,
              manufactures the reviewer's answer. */}
          <label className="flex items-start gap-2 text-[11px] text-slate-400 sm:col-span-2">
            <input
              type="checkbox"
              checked={form.declarationMade}
              onChange={(e) =>
                setForm({ ...form, declarationMade: e.target.checked })
              }
              className="mt-0.5"
            />
            <span>
              I was asked about conflicts of interest and I am declaring them
              here (spec II.15). Leave this unticked if nobody has asked — the
              record will show that nobody was asked, which is a different fact
              from &ldquo;none&rdquo;, and an independent review will be refused
              until it is stated.
            </span>
          </label>
          <button
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  submitCaseAssuranceReview(caseId, {
                    assuranceLevel: form.assuranceLevel,
                    scope: form.scope,
                    gateId: form.gateId === "" ? null : Number(form.gateId),
                    reviewerCompetencyKeys: form.competencies
                      .split(",")
                      .map((s) => s.trim())
                      .filter((s) => s !== ""),
                    reviewerCompetencyBasis: form.competencyBasis || null,
                    conflictsDeclared:
                      form.conflicts.trim() === ""
                        ? []
                        : [
                            {
                              conflict: form.conflicts.trim(),
                              mitigation: form.conflictMitigation.trim(),
                            },
                          ],
                    conflictsDeclarationMade: form.declarationMade,
                  }),
                () => setAdding(false),
              )
            }
            className={`${buttonClass} sm:col-span-2`}
          >
            Record the review
          </button>
        </div>
      )}
    </Section>
  );
}

/* ──────────────────────────── D11.22 ──────────────────────────── */

/**
 * D11.22 — THE WEIGHT SET, AS A SURFACE.
 *
 * The §46 refusal for an unarmed tenant names two acts, and the first draft of
 * this slice shipped neither of them on any screen: `adopt_evidence_confidence_
 * profile` had a service wrapper nobody called and `set_evidence_confidence_
 * weights` had no wrapper at all, so every organization's EC refused forever
 * and the row's central argument — "no built-in default, because a hidden
 * default is one opinion imposed on every tenant" — was defeated in practice:
 * every tenant got the same seeded numbers and could not change them.
 *
 * This panel is the arming step: read the versions, edit the DRAFT's weights,
 * adopt it, and open a NEW VERSION of an adopted one — the exact verb
 * `set_evidence_confidence_weights` names in its own refusal.
 */
function WeightSetPanel({ onChanged }: { onChanged: () => void }) {
  const [profiles, setProfiles] = useState<EvidenceConfidenceProfileRow[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setProfiles(await listEvidenceConfidenceProfiles());
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not read the weight sets",
      );
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The action was refused");
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (p: EvidenceConfidenceProfileRow) => {
    setEditing(p.id);
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(p.quality_weights ?? {}))
      next[`quality.${k}`] = String(v);
    for (const [k, v] of Object.entries(p.applicability_weights ?? {}))
      next[`applicability.${k}`] = String(v);
    for (const [k, v] of Object.entries(p.verification_weights ?? {}))
      next[`verification.${k}`] = String(v);
    setDraft(next);
  };

  const saveEdit = (p: EvidenceConfidenceProfileRow) => {
    const group = (prefix: string) =>
      Object.entries(draft)
        .filter(([k]) => k.startsWith(`${prefix}.`))
        .reduce<Record<string, number>>((acc, [k, v]) => {
          acc[k.slice(prefix.length + 1)] = Number(v);
          return acc;
        }, {});
    return run(() =>
      setEvidenceConfidenceWeights({
        profileId: p.id,
        qualityWeights: group("quality"),
        applicabilityWeights: group("applicability"),
        verificationWeights: group("verification"),
      }).then(() => setEditing(null)),
    );
  };

  return (
    <div className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
      <button onClick={() => setOpen((v) => !v)} className={buttonClass}>
        {open ? "Hide the weight sets" : "Weight sets (§46): read, edit, adopt"}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <ErrorLine error={error} />
          <p className="text-[11px] text-slate-500">
            The weights travel with every number this organization computes.
            They are the tenant&apos;s position, not a universal science — a
            draft arms nothing until it is adopted, and an adopted set is never
            edited in place, because a computed confidence must be able to name
            the version that produced it.
          </p>
          {profiles.length === 0 && (
            <p className="text-[11px] text-slate-500">
              No weight set exists for this organization.
            </p>
          )}
          {profiles.map((p) => (
            <div
              key={p.id}
              className="rounded border border-white/6 px-2.5 py-2 text-[11px] text-slate-400"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-slate-200">
                  {p.name} v{p.version}
                </span>
                <Pill
                  tone={
                    p.status === "adopted"
                      ? "good"
                      : p.status === "draft"
                        ? "warn"
                        : "neutral"
                  }
                >
                  {p.status}
                </Pill>
              </div>
              <p className="mt-1 italic text-slate-500">{p.basis}</p>
              {editing === p.id ? (
                <div className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
                  {Object.keys(draft)
                    .sort()
                    .map((k) => (
                      <label key={k} className="flex items-center gap-1.5">
                        <span className="w-32 shrink-0 truncate">{k}</span>
                        <input
                          value={draft[k]}
                          onChange={(e) =>
                            setDraft({ ...draft, [k]: e.target.value })
                          }
                          className={inputClass}
                        />
                      </label>
                    ))}
                  <button
                    disabled={busy}
                    onClick={() => void saveEdit(p)}
                    className={`${buttonClass} sm:col-span-3`}
                  >
                    Save this draft&apos;s weights
                  </button>
                </div>
              ) : (
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {p.status === "draft" && (
                    <>
                      <button
                        onClick={() => startEdit(p)}
                        className={buttonClass}
                      >
                        Edit the weights
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(() => adoptEvidenceConfidenceProfile(p.id))
                        }
                        className={buttonClass}
                      >
                        Adopt this weight set
                      </button>
                    </>
                  )}
                  {p.status === "adopted" && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          createEvidenceConfidenceProfileVersion({
                            fromProfileId: p.id,
                          }),
                        )
                      }
                      className={buttonClass}
                    >
                      Open a new version to edit
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function EvidenceConfidenceSection({
  chains,
  canPlan,
  onChanged,
}: {
  chains: CaseChains;
  canPlan: boolean;
  onChanged: () => void;
}) {
  const ec = chains.evidenceConfidence;
  const [gradeFor, setGradeFor] = useState<string | null>(null);
  const [quality, setQuality] = useState("moderate");
  const [applicability, setApplicability] = useState("direct");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The §46 preview: what EC these grades WOULD produce, computed offline
   * from the tenant's own adopted weights by the documented mirror of
   * compute_evidence_confidence. It is a preview and says so — the number the
   * product reports is always the server's, recomputed after the grade lands.
   * When any other factor is still missing the mirror refuses exactly as the
   * server does, and the refusal is what the user sees.
   */
  const preview = (item: (typeof ec.items)[number]): string | null => {
    if (ec.profile == null) return null;
    const weights: EvidenceConfidenceWeights = {
      quality: ec.profile.quality as EvidenceConfidenceWeights["quality"],
      applicability: ec.profile
        .applicability as EvidenceConfidenceWeights["applicability"],
      verification: ec.profile.verification,
      freshness: ec.profile.freshness,
    };
    const result = evidenceConfidence(
      {
        qualityGrade: quality as QualityGrade,
        applicabilityGrade: applicability as ApplicabilityGrade,
        evidenceClass: item.evidenceClass,
        observedAt: item.observedAt,
        verificationStatus: item.verificationStatus,
      },
      weights,
    );
    return result.ok
      ? `These grades would give EC ${(result.evidenceConfidence * 100).toFixed(1)}% at today's weights.`
      : `Still refused after grading: ${result.missingFactors.join("; ")}`;
  };

  const grade = async (evidenceId: string) => {
    setBusy(true);
    setError(null);
    try {
      await gradeEvidenceItem({
        evidenceId,
        qualityGrade: quality,
        applicabilityGrade: applicability,
      });
      setGradeFor(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Grading was refused");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      icon={<FileCheck className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Evidence confidence (§46)"
      subtitle="EC = Q × A × F × V — quality, applicability, freshness, verification — with the tenant's own adopted weights. A missing factor refuses the calculation and names it: no factor is defaulted to a midpoint, because a made-up factor produces a number that looks like a measurement."
    >
      <ErrorLine error={error} />
      {ec.profile == null ? (
        <div className="rounded border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-xs text-amber-200">
          No evidence-confidence weight set is adopted in this organization, so
          EC cannot be computed for anything. Spec §46 is explicit that the
          weights are configurable and not universal science, so there is no
          built-in default to fall back to — a hidden default would be one
          opinion imposed on every tenant. A draft weight set is seeded for
          every organization; read it, argue with it and adopt it below.
        </div>
      ) : (
        <div className="rounded border border-white/8 bg-white/[0.02] px-3 py-2 text-[11px] text-slate-400">
          <span className="font-semibold text-slate-300">
            {ec.profile.name} v{ec.profile.version}
          </span>{" "}
          — quality{" "}
          {Object.entries(ec.profile.quality)
            .map(([k, v]) => `${k}=${v}`)
            .join(" · ")}{" "}
          | applicability{" "}
          {Object.entries(ec.profile.applicability)
            .map(([k, v]) => `${k}=${v}`)
            .join(" · ")}{" "}
          | verification{" "}
          {Object.entries(ec.profile.verification)
            .map(([k, v]) => `${k}=${v}`)
            .join(" · ")}
          <p className="mt-1 italic text-slate-500">{ec.profile.basis}</p>
        </div>
      )}

      {canPlan && <WeightSetPanel onChanged={onChanged} />}

      <div className="text-xs text-slate-400">
        {ec.scoredCount} scored · {ec.refusedCount} refused
        {ec.meanConfidence != null
          ? ` · mean EC ${(ec.meanConfidence * 100).toFixed(1)}%`
          : " · no mean: nothing scored"}
      </div>

      {ec.items.length === 0 && (
        <p className="text-xs text-slate-500">
          No evidence recorded against this case yet.
        </p>
      )}

      {ec.items.map((item) => (
        <div
          key={item.evidenceId}
          className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2"
        >
          {item.computed ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Pill
                  tone={
                    (item.evidenceConfidencePct ?? 0) >= 60
                      ? "good"
                      : (item.evidenceConfidencePct ?? 0) >= 30
                        ? "warn"
                        : "bad"
                  }
                >
                  EC {item.evidenceConfidencePct}%
                </Pill>
                <span className="text-[11px] text-slate-500">
                  {item.evidenceId.slice(0, 8)}…
                </span>
              </div>
              {item.factors && (
                <div className="mt-1 text-[11px] text-slate-400">
                  Q {item.factors.quality.grade} = {item.factors.quality.weight}{" "}
                  · A {item.factors.applicability.grade} ={" "}
                  {item.factors.applicability.weight} · F{" "}
                  {item.factors.freshness.evidenceClass} aged{" "}
                  {item.factors.freshness.ageDays}d ={" "}
                  {item.factors.freshness.weight} · V{" "}
                  {item.factors.verification.status} ={" "}
                  {item.factors.verification.weight}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone="warn">EC refused</Pill>
                <span className="text-[11px] text-slate-500">
                  {item.evidenceId.slice(0, 8)}…
                </span>
              </div>
              <p className="mt-1 text-[11px] text-amber-200">{item.reason}</p>
              {canPlan && gradeFor !== item.evidenceId && (
                <button
                  onClick={() => setGradeFor(item.evidenceId)}
                  className={`${buttonClass} mt-1.5`}
                >
                  Grade this evidence
                </button>
              )}
              {canPlan && gradeFor === item.evidenceId && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <select
                    value={quality}
                    onChange={(e) => setQuality(e.target.value)}
                    className={`${inputClass} max-w-[12rem]`}
                  >
                    {QUALITY_GRADES.map((g) => (
                      <option key={g} value={g}>
                        Quality: {g}
                      </option>
                    ))}
                  </select>
                  <select
                    value={applicability}
                    onChange={(e) => setApplicability(e.target.value)}
                    className={`${inputClass} max-w-[12rem]`}
                  >
                    {APPLICABILITY_GRADES.map((g) => (
                      <option key={g} value={g}>
                        Applicability: {g}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={busy}
                    onClick={() => void grade(item.evidenceId)}
                    className={buttonClass}
                  >
                    Record the grades
                  </button>
                  <button
                    onClick={() => setGradeFor(null)}
                    className="text-xs text-slate-400 hover:text-slate-200"
                  >
                    Cancel
                  </button>
                  {preview(item) && (
                    <p className="w-full text-[10px] text-slate-500">
                      {preview(item)}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      ))}
    </Section>
  );
}

/* ───────────────────────────── The panel ───────────────────────────── */

export function CaseChainsPanel({
  caseId,
  members,
  gates,
  canPlan,
  canReview,
  reloadKey,
}: {
  caseId: string;
  members: OrgMember[];
  /** The case framework's own gates — an assurance review satisfies a demand
   *  at the gate it names, so the reviewer has to be able to name one. */
  gates: { id: number; name: string }[];
  canPlan: boolean;
  canReview: boolean;
  reloadKey: number;
}) {
  const [chains, setChains] = useState<CaseChains | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setChains(await getCaseChains(caseId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the chains");
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (error) {
    return (
      <div className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-300">
        {error}
      </div>
    );
  }
  if (chains == null) {
    return (
      <div className="rounded-xl border border-white/6 bg-[#0D1520] p-5 text-xs text-slate-500">
        Loading commitments, permits, assurance and evidence confidence…
      </div>
    );
  }

  return (
    <>
      <CommitmentsSection
        caseId={caseId}
        chains={chains}
        members={members}
        canPlan={canPlan}
        canReview={canReview}
        onChanged={() => void load()}
      />
      <RegulatorySection
        caseId={caseId}
        chains={chains}
        members={members}
        canPlan={canPlan}
        canReview={canReview}
        onChanged={() => void load()}
      />
      <AssuranceSection
        caseId={caseId}
        chains={chains}
        gates={gates}
        canReview={canReview}
        onChanged={() => void load()}
      />
      <EvidenceConfidenceSection
        chains={chains}
        canPlan={canPlan}
        onChanged={() => void load()}
      />
    </>
  );
}
