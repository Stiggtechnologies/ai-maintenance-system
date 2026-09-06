/**
 * Sync Develop — the framework shelf (D12.06 §56, and the authoring paths
 * D3.02 / D3.14 / D3.24 / D3.35 / D3.03 were missing).
 *
 * WHY THIS PANEL EXISTS. Slice 3 seeded six reference framework profiles as
 * drafts and shipped every authoring RPC — and none of them had a caller, so
 * a tenant could seed a library it could never adopt, could never add a gate
 * to, and could never state a requirement on. The reachability gate demoted
 * five rows for exactly that. This is the surface those rows were missing.
 *
 * WHAT IT DOES, in the order a tenant does it:
 *   1. CREATE a blank draft framework by hand (D3.01/D3.22) — or run the
 *      METHODOLOGY AGENT over a document in the governed intake register,
 *      which proposes a DRAFT whose every requirement is stamped
 *      AI_SUGGESTION (D12.06);
 *   2. add a STAGE mapped onto the canonical lifecycle_stages vocabulary
 *      (D3.23) and a GATE or CHECKPOINT on that stage (D3.24/D3.37);
 *   3. state a requirement with its provenance tier and weight (D3.14/D3.25/
 *      D3.35);
 *   4. ADOPT (D3.02) — the executive act. The database refuses the
 *      AI-operator identity by name (§70), so the machine that drafted it
 *      cannot put it in force;
 *   5. version an adopted framework (D3.35's clone) when it needs to change,
 *      because an adopted version is immutable.
 *
 * HONESTY RULES: refusals render VERBATIM; the agent's own disclaimer is
 * shown as the server wrote it; a proposal's adoption status is read from the
 * FRAMEWORK, never duplicated onto the proposal row.
 */
import { useCallback, useEffect, useState } from "react";
import { Bot, FileStack, GitBranch, Landmark } from "lucide-react";
import {
  addFrameworkGate,
  addFrameworkStage,
  addTailoringRule,
  adoptProjectFramework,
  createProjectFramework,
  createProjectFrameworkVersion,
  getFrameworkShelf,
  listIntakeDocuments,
  runMethodologyAgent,
  setGateRequirement,
  setRuleSetThresholds,
  withdrawFrameworkProposal,
  type FrameworkProposalResult,
  type FrameworkShelf,
  type IntakeDocumentOption,
} from "../../services/developService";
import { LIFECYCLE_TYPES } from "../../lib/develop";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";

/** The eight D3.14 provenance tiers, as the database enforces them. */
const SOURCE_AUTHORITIES = [
  "LAW",
  "REGULATION",
  "CORPORATE_STANDARD",
  "PROJECT_FRAMEWORK",
  "CONTRACT",
  "INDUSTRY_GUIDANCE",
  "BEST_PRACTICE",
  "AI_SUGGESTION",
];

const CATEGORIES = [
  "business",
  "technical",
  "risk",
  "cost_schedule",
  "operations",
  "supply",
  "regulatory",
];

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded border border-red-400/30 bg-red-400/10 px-2.5 py-2 text-xs whitespace-pre-wrap text-red-300">
      {error}
    </div>
  );
}

export function FrameworkShelfPanel({
  canAdmin,
  canAuthor,
  stageKeys,
  draftRuleSets,
  onChanged,
}: {
  /** Executive or administrator: adoption is theirs (server-enforced too). */
  canAdmin: boolean;
  /** Governance or engineering: authoring on a draft. */
  canAuthor: boolean;
  /** Canonical lifecycle stage keys the case's framework may sit on. */
  stageKeys: string[];
  /** D3.03: draft tailoring rule sets a rule may be authored onto. */
  draftRuleSets: { id: string; name: string; version: number }[];
  onChanged: () => void;
}) {
  const [shelf, setShelf] = useState<FrameworkShelf | null>(null);
  const [documents, setDocuments] = useState<IntakeDocumentOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const [documentId, setDocumentId] = useState("");
  const [retrievalQuery, setRetrievalQuery] = useState("");
  const [proposal, setProposal] = useState<FrameworkProposalResult | null>(
    null,
  );
  const [adoptNote, setAdoptNote] = useState("");
  /** Adoption is the §70 human act of this slice. A draft that would SUPERSEDE
   *  a framework in force is confirmed once, by id, after the consequence has
   *  been read — not adopted by the same click that first shows it. */
  const [confirmSupersede, setConfirmSupersede] = useState<string | null>(null);
  const [frameworkDraft, setFrameworkDraft] = useState({
    name: "",
    source: "",
    sourceAuthority: "INDUSTRY_GUIDANCE",
    basis: "",
    projectClasses: "",
  });
  const [stageDraft, setStageDraft] = useState({
    frameworkId: "",
    stageKey: "",
    sequence: "1",
    displayName: "",
    purpose: "",
  });
  const [gateDraft, setGateDraft] = useState({
    frameworkId: "",
    stageKey: "",
    name: "",
    sequence: "1",
    decisionType: "gate",
    independent: false,
  });
  const [reqDraft, setReqDraft] = useState({
    gateId: "",
    criterion: "",
    isMandatory: false,
    sourceAuthority: "INDUSTRY_GUIDANCE",
    category: "technical",
    guidance: "",
    weight: "1",
  });
  const [ruleDraft, setRuleDraft] = useState({
    ruleSetId: "",
    priority: "50",
    description: "",
    frameworkName: "",
    lifecycleType: "",
    minValueUsd: "",
    intensityFloor: "",
  });
  // The three ascending band boundaries the server demands by name.
  const [thresholdDraft, setThresholdDraft] = useState({
    ruleSetId: "",
    standard: "",
    elevated: "",
    full: "",
  });

  const load = useCallback(async () => {
    try {
      setShelf(await getFrameworkShelf());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    listIntakeDocuments()
      .then(setDocuments)
      .catch(() => setDocuments([]));
  }, [open, load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <FileStack className="h-4 w-4 text-slate-400" aria-hidden />
        <span className="flex-1 text-sm font-semibold text-slate-100">
          Framework shelf — propose, author, adopt
        </span>
        <span className="text-[11px] text-slate-500">
          {open ? "hide" : "show"}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t border-white/6 px-4 py-3">
          <ErrorLine error={error} />
          {notice && (
            <div className="rounded border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1.5 text-xs text-emerald-300">
              {notice}
            </div>
          )}

          {/* 1 — D12.06: the methodology agent. */}
          <div className="rounded-lg border border-white/8 p-2.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-200">
              <Bot className="h-3.5 w-3.5 text-slate-400" aria-hidden />
              Methodology agent — propose a framework from a document
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
              <select
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
                className={`${inputClass} sm:col-span-2`}
              >
                <option value="">Document from the intake register…</option>
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
              <button
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  setNotice(null);
                  try {
                    setProposal(
                      await runMethodologyAgent({
                        documentId,
                        query: retrievalQuery.trim() || undefined,
                        record: false,
                      }),
                    );
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
                disabled={busy || !documentId}
                className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
              >
                {busy ? "Reading…" : "Propose"}
              </button>
              {/* The retrieval query, exposed. It was hardcoded and conjunctive,
                  so the only product path to the agent always refused with
                  "nothing was retrieved". The default is a disjunction now, and
                  the words a particular manual actually uses are something only
                  the reader knows. */}
              <input
                value={retrievalQuery}
                onChange={(e) => setRetrievalQuery(e.target.value)}
                placeholder="Words this document uses for its gates (optional — leave blank for the standard framework query)"
                className={`${inputClass} sm:col-span-3`}
              />
            </div>

            {proposal && (
              <div className="mt-2 space-y-1 rounded border border-white/8 bg-white/[0.02] p-2 text-[11px] text-slate-300">
                {proposal.refusal ? (
                  <p className="text-amber-300">{proposal.refusal}</p>
                ) : (
                  <>
                    <p className="font-semibold text-slate-100">
                      {proposal.proposal?.name}
                    </p>
                    <p>{proposal.proposal?.summary}</p>
                    <p className="text-slate-400">
                      {proposal.proposal?.stages.length} stage(s),{" "}
                      {proposal.proposal?.gates.length} gate(s),{" "}
                      {proposal.proposal?.requirements.length} requirement(s) —
                      every requirement tagged AI_SUGGESTION.
                    </p>
                    {(proposal.droppedElements ?? []).length > 0 && (
                      <ul className="text-slate-500">
                        {(proposal.droppedElements ?? []).map((d) => (
                          <li key={d}>dropped: {d}</li>
                        ))}
                      </ul>
                    )}
                    <button
                      onClick={() =>
                        void act(
                          () =>
                            runMethodologyAgent({
                              documentId,
                              query: retrievalQuery.trim() || undefined,
                              record: true,
                            }),
                          "Proposal recorded as a DRAFT framework. Nothing governs until a human adopts it.",
                        )
                      }
                      disabled={busy}
                      className="mt-1 rounded border border-white/10 px-2 py-1 text-[11px] text-slate-200 hover:bg-white/5 disabled:opacity-50"
                    >
                      Record as a draft framework
                    </button>
                  </>
                )}
                {proposal.recordNote && (
                  <p className="text-amber-300">{proposal.recordNote}</p>
                )}
                {proposal.disclaimer && (
                  <p className="border-t border-white/6 pt-1 text-slate-500">
                    {proposal.disclaimer}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* 2 — the shelf. */}
          {shelf && (
            <div className="space-y-2">
              {shelf.proposals.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-300">
                    Machine proposals
                  </div>
                  <ul className="space-y-1">
                    {shelf.proposals.map((p) => (
                      <li
                        key={p.id}
                        className="rounded border border-white/6 bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-slate-300"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                            {p.agentKey}
                          </span>
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                              p.framework.status === "adopted"
                                ? "bg-emerald-400/10 text-emerald-300"
                                : p.status === "withdrawn"
                                  ? "bg-white/5 text-slate-400"
                                  : "bg-amber-400/10 text-amber-300"
                            }`}
                          >
                            {p.framework.status === "adopted"
                              ? "adopted by a human"
                              : p.status}
                          </span>
                          <span className="flex-1 font-medium text-slate-100">
                            {p.framework.name} v{p.framework.version}
                          </span>
                        </div>
                        <p className="mt-0.5">{p.summary}</p>
                        <p className="mt-0.5 text-slate-500">
                          from “{p.document ?? "a document"}” ·{" "}
                          {p.framework.stages} stage(s), {p.framework.gates}{" "}
                          gate(s), {p.framework.requirements} requirement(s) ·{" "}
                          {p.framework.sourceAuthority}
                        </p>
                        {p.withdrawnReason && (
                          <p className="mt-0.5 text-slate-500">
                            withdrawn: {p.withdrawnReason}
                          </p>
                        )}
                        {p.status === "proposed" &&
                          p.framework.status === "draft" &&
                          canAuthor && (
                            <button
                              onClick={() =>
                                void act(
                                  () =>
                                    withdrawFrameworkProposal(
                                      p.id,
                                      "Reviewed and not taken forward",
                                    ),
                                  "Proposal withdrawn. The record of what was proposed survives.",
                                )
                              }
                              disabled={busy}
                              className="mt-1 text-[10px] text-slate-500 underline hover:text-slate-300 disabled:opacity-50"
                            >
                              withdraw
                            </button>
                          )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-300">
                  Draft frameworks ({shelf.drafts.length}) — adoption is the
                  executive act
                </div>
                {shelf.drafts.length === 0 ? (
                  <p className="text-[11px] text-slate-500">
                    No draft framework exists. Seed the reference library or run
                    the methodology agent above.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {shelf.drafts.map((f) => (
                      <li
                        key={f.id}
                        className="flex flex-wrap items-center gap-2 rounded border border-white/6 bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-slate-300"
                      >
                        <span className="font-medium text-slate-100">
                          {f.name} v{f.version}
                        </span>
                        <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400">
                          {f.sourceAuthority}
                        </span>
                        {f.machineProposed && (
                          <span className="rounded-full bg-violet-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">
                            machine-proposed
                          </span>
                        )}
                        <span className="text-slate-500">
                          {f.stages} stage(s), {f.gates} gate(s),{" "}
                          {f.requirements} requirement(s)
                        </span>
                        {/* What adoption ARMS. Counts alone told an executive
                            nothing about what they were disposing of: one
                            mandatory requirement blocks its gate at any
                            readiness percentage, and an independence flag
                            changes who may record the decision. */}
                        {(f.mandatoryRequirements ?? 0) > 0 && (
                          <span className="rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                            {f.mandatoryRequirements} mandatory
                          </span>
                        )}
                        {(f.independentAssuranceGates ?? 0) > 0 && (
                          <span className="rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300">
                            {f.independentAssuranceGates} gate(s) need
                            independent assurance
                          </span>
                        )}
                        {Object.entries(f.requirementTiers ?? {}).map(
                          ([tier, n]) => (
                            <span
                              key={tier}
                              className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400"
                            >
                              {n} {tier}
                            </span>
                          ),
                        )}
                        {/* What adoption REPLACES. adopt_project_framework
                            supersedes every adopted framework of the same name
                            and apply_case_governance resolves tailoring rules
                            by name, so this swap re-points every rule naming
                            it. Stated before the click, and confirmed. */}
                        {f.willSupersede && (
                          <span className="w-full rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[10px] text-amber-200">
                            Adopting this SUPERSEDES {f.willSupersede.name} v
                            {f.willSupersede.version} (
                            {f.willSupersede.sourceAuthority}), which is in
                            force now — every tailoring rule naming it will
                            resolve to this one instead.
                          </span>
                        )}
                        {canAdmin && (
                          <button
                            onClick={() => {
                              if (
                                f.willSupersede &&
                                confirmSupersede !== f.id
                              ) {
                                setConfirmSupersede(f.id);
                                return;
                              }
                              setConfirmSupersede(null);
                              void act(
                                () => adoptProjectFramework(f.id, adoptNote),
                                `${f.name} v${f.version} adopted — it now governs the cases the tailoring rules select it for.`,
                              );
                            }}
                            disabled={busy}
                            className="rounded border border-signal-cyan/30 bg-signal-cyan/10 px-2 py-0.5 text-[10px] font-semibold text-signal-cyan hover:bg-signal-cyan/15 disabled:opacity-50"
                          >
                            {f.willSupersede && confirmSupersede === f.id
                              ? `confirm: replace v${f.willSupersede.version}`
                              : "adopt"}
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                {canAdmin && (
                  <input
                    value={adoptNote}
                    onChange={(e) => setAdoptNote(e.target.value)}
                    placeholder="Authority and basis for adoption (20 characters minimum)"
                    className={`${inputClass} mt-1.5`}
                  />
                )}
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-300">
                  Adopted frameworks ({shelf.adopted.length}) — immutable;
                  change one by drafting its next version
                </div>
                <ul className="space-y-1">
                  {shelf.adopted.map((f) => (
                    <li
                      key={f.id}
                      className="flex flex-wrap items-center gap-2 rounded border border-white/6 bg-white/[0.02] px-2.5 py-1.5 text-[11px] text-slate-300"
                    >
                      <Landmark
                        className="h-3 w-3 text-slate-500"
                        aria-hidden
                      />
                      <span className="font-medium text-slate-100">
                        {f.name} v{f.version}
                      </span>
                      <span className="text-slate-500">
                        {f.gates} gate(s) · adopted by{" "}
                        {f.adoptedBy ?? "unknown"}
                      </span>
                      {canAuthor && (
                        <button
                          onClick={() =>
                            void act(
                              () => createProjectFrameworkVersion(f.id),
                              `Drafted the next version of ${f.name} — its stages, gates, requirements and weights were cloned. Edit it, then adopt it.`,
                            )
                          }
                          disabled={busy}
                          className="flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 text-[10px] text-slate-200 hover:bg-white/5 disabled:opacity-50"
                        >
                          <GitBranch className="h-3 w-3" aria-hidden /> draft
                          next version
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* 3 — D3.01 / D3.22: a hand-authored draft, not only a seed or a
              machine proposal. A tenant that never seeded the library and
              never ran the agent could not previously start a framework. */}
          {canAuthor && (
            <div className="space-y-2 rounded-lg border border-white/8 p-2.5">
              <div className="text-xs font-semibold text-slate-200">
                Create a draft framework (D3.01) — nothing governs until a
                human adopts it
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                <input
                  value={frameworkDraft.name}
                  onChange={(e) =>
                    setFrameworkDraft((d) => ({ ...d, name: e.target.value }))
                  }
                  placeholder="Framework name"
                  className={inputClass}
                />
                <select
                  value={frameworkDraft.sourceAuthority}
                  onChange={(e) =>
                    setFrameworkDraft((d) => ({
                      ...d,
                      sourceAuthority: e.target.value,
                    }))
                  }
                  className={inputClass}
                >
                  {SOURCE_AUTHORITIES.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
                <input
                  value={frameworkDraft.projectClasses}
                  onChange={(e) =>
                    setFrameworkDraft((d) => ({
                      ...d,
                      projectClasses: e.target.value,
                    }))
                  }
                  placeholder="Project classes (comma-separated)"
                  className={inputClass}
                />
                <input
                  value={frameworkDraft.source}
                  onChange={(e) =>
                    setFrameworkDraft((d) => ({ ...d, source: e.target.value }))
                  }
                  placeholder="Where this content comes from (10 characters minimum)"
                  className={`${inputClass} sm:col-span-3`}
                />
                <input
                  value={frameworkDraft.basis}
                  onChange={(e) =>
                    setFrameworkDraft((d) => ({ ...d, basis: e.target.value }))
                  }
                  placeholder="Basis — at LAW/REGULATION/CORPORATE_STANDARD/CONTRACT this must name the instrument (30 characters)"
                  className={`${inputClass} sm:col-span-2`}
                />
                <button
                  onClick={() =>
                    void act(
                      () =>
                        createProjectFramework({
                          name: frameworkDraft.name,
                          source: frameworkDraft.source,
                          sourceAuthority: frameworkDraft.sourceAuthority,
                          basis: frameworkDraft.basis,
                          projectClasses: frameworkDraft.projectClasses
                            .split(",")
                            .map((s) => s.trim())
                            .filter(Boolean),
                        }),
                      "Draft framework created. Add stages and gates, then adopt it. It governs nothing yet.",
                    )
                  }
                  disabled={busy}
                  className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
                >
                  Create draft
                </button>
              </div>
            </div>
          )}

          {/* 4 — D3.23 / D3.24 / D3.37 / D3.14 / D3.25 / D3.35: authoring on a DRAFT. */}
          {canAuthor && shelf && shelf.drafts.length > 0 && (
            <div className="space-y-2 rounded-lg border border-white/8 p-2.5">
              <div className="text-xs font-semibold text-slate-200">
                Author on a draft (an adopted version is immutable — the server
                refuses it by name)
              </div>

              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                <select
                  value={stageDraft.frameworkId}
                  onChange={(e) =>
                    setStageDraft((d) => ({
                      ...d,
                      frameworkId: e.target.value,
                    }))
                  }
                  className={inputClass}
                >
                  <option value="">Draft framework…</option>
                  {shelf.drafts.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} v{f.version}
                    </option>
                  ))}
                </select>
                <select
                  value={stageDraft.stageKey}
                  onChange={(e) =>
                    setStageDraft((d) => ({ ...d, stageKey: e.target.value }))
                  }
                  className={inputClass}
                >
                  <option value="">Canonical stage…</option>
                  {stageKeys.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <input
                  value={stageDraft.displayName}
                  onChange={(e) =>
                    setStageDraft((d) => ({
                      ...d,
                      displayName: e.target.value,
                    }))
                  }
                  placeholder="Display name for this stage"
                  className={inputClass}
                />
                <input
                  value={stageDraft.sequence}
                  onChange={(e) =>
                    setStageDraft((d) => ({ ...d, sequence: e.target.value }))
                  }
                  placeholder="Sequence"
                  className={inputClass}
                />
                <input
                  value={stageDraft.purpose}
                  onChange={(e) =>
                    setStageDraft((d) => ({ ...d, purpose: e.target.value }))
                  }
                  placeholder="Purpose (optional)"
                  className={inputClass}
                />
                <button
                  onClick={() =>
                    void act(
                      () =>
                        addFrameworkStage({
                          frameworkId: stageDraft.frameworkId,
                          stageKey: stageDraft.stageKey,
                          sequence: Number(stageDraft.sequence) || 1,
                          displayName: stageDraft.displayName,
                          purpose: stageDraft.purpose || null,
                        }),
                      "Stage added to the draft — mapped onto the canonical lifecycle vocabulary, not a second one.",
                    )
                  }
                  disabled={busy}
                  className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
                >
                  Add stage
                </button>
              </div>

              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                <select
                  value={gateDraft.frameworkId}
                  onChange={(e) =>
                    setGateDraft((d) => ({ ...d, frameworkId: e.target.value }))
                  }
                  className={inputClass}
                >
                  <option value="">Draft framework…</option>
                  {shelf.drafts.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name} v{f.version}
                    </option>
                  ))}
                </select>
                <select
                  value={gateDraft.stageKey}
                  onChange={(e) =>
                    setGateDraft((d) => ({ ...d, stageKey: e.target.value }))
                  }
                  className={inputClass}
                >
                  <option value="">Stage…</option>
                  {stageKeys.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <input
                  value={gateDraft.name}
                  onChange={(e) =>
                    setGateDraft((d) => ({ ...d, name: e.target.value }))
                  }
                  placeholder="Gate name"
                  className={inputClass}
                />
                <select
                  value={gateDraft.decisionType}
                  onChange={(e) =>
                    setGateDraft((d) => ({
                      ...d,
                      decisionType: e.target.value,
                    }))
                  }
                  className={inputClass}
                >
                  <option value="gate">gate</option>
                  <option value="checkpoint">checkpoint (lighter row)</option>
                </select>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={gateDraft.independent}
                    onChange={(e) =>
                      setGateDraft((d) => ({
                        ...d,
                        independent: e.target.checked,
                      }))
                    }
                  />
                  independent assurance required
                </label>
                <button
                  onClick={() =>
                    void act(
                      () =>
                        addFrameworkGate({
                          frameworkId: gateDraft.frameworkId,
                          stageKey: gateDraft.stageKey,
                          name: gateDraft.name,
                          sequence: Number(gateDraft.sequence) || 1,
                          decisionType: gateDraft.decisionType,
                          independentAssuranceRequired: gateDraft.independent,
                        }),
                      "Gate added to the draft.",
                    )
                  }
                  disabled={busy}
                  className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
                >
                  Add gate
                </button>
              </div>

              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                <input
                  value={reqDraft.gateId}
                  onChange={(e) =>
                    setReqDraft((d) => ({ ...d, gateId: e.target.value }))
                  }
                  placeholder="Gate id (from the gate list)"
                  className={inputClass}
                />
                <select
                  value={reqDraft.sourceAuthority}
                  onChange={(e) =>
                    setReqDraft((d) => ({
                      ...d,
                      sourceAuthority: e.target.value,
                    }))
                  }
                  className={inputClass}
                >
                  {SOURCE_AUTHORITIES.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
                <select
                  value={reqDraft.category}
                  onChange={(e) =>
                    setReqDraft((d) => ({ ...d, category: e.target.value }))
                  }
                  className={inputClass}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <input
                  value={reqDraft.criterion}
                  onChange={(e) =>
                    setReqDraft((d) => ({ ...d, criterion: e.target.value }))
                  }
                  placeholder="What must be established"
                  className={`${inputClass} sm:col-span-2`}
                />
                <input
                  value={reqDraft.weight}
                  onChange={(e) =>
                    setReqDraft((d) => ({ ...d, weight: e.target.value }))
                  }
                  placeholder="Weight (default 1)"
                  className={inputClass}
                />
                <input
                  value={reqDraft.guidance}
                  onChange={(e) =>
                    setReqDraft((d) => ({ ...d, guidance: e.target.value }))
                  }
                  placeholder="Guidance — at LAW/REGULATION/CORPORATE_STANDARD/CONTRACT this must name the instrument"
                  className={`${inputClass} sm:col-span-2`}
                />
                <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={reqDraft.isMandatory}
                    onChange={(e) =>
                      setReqDraft((d) => ({
                        ...d,
                        isMandatory: e.target.checked,
                      }))
                    }
                  />
                  mandatory (blocks at any readiness percentage)
                </label>
                <button
                  onClick={() =>
                    void act(
                      () =>
                        setGateRequirement({
                          gateId: Number(reqDraft.gateId),
                          criterion: reqDraft.criterion,
                          isMandatory: reqDraft.isMandatory,
                          sourceAuthority: reqDraft.sourceAuthority,
                          category: reqDraft.category,
                          guidance: reqDraft.guidance || null,
                          weight: Number(reqDraft.weight) || 1,
                        }),
                      "Requirement stated on the draft gate, with its provenance tier and weight.",
                    )
                  }
                  disabled={busy}
                  className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
                >
                  State requirement
                </button>
              </div>
            </div>
          )}

          {/* 5 — D3.03: rule and threshold authoring on a DRAFT rule set. */}
          {canAuthor && draftRuleSets.length > 0 && (
            <div className="space-y-2 rounded-lg border border-white/8 p-2.5">
              <div className="text-xs font-semibold text-slate-200">
                Tailoring rules — author on a draft rule set (D3.03)
              </div>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
                <select
                  value={ruleDraft.ruleSetId}
                  onChange={(e) =>
                    setRuleDraft((d) => ({ ...d, ruleSetId: e.target.value }))
                  }
                  className={inputClass}
                >
                  <option value="">Draft rule set…</option>
                  {draftRuleSets.map((rs) => (
                    <option key={rs.id} value={rs.id}>
                      {rs.name} v{rs.version}
                    </option>
                  ))}
                </select>
                <input
                  value={ruleDraft.priority}
                  onChange={(e) =>
                    setRuleDraft((d) => ({ ...d, priority: e.target.value }))
                  }
                  placeholder="Priority (lower wins)"
                  className={inputClass}
                />
                <input
                  value={ruleDraft.frameworkName}
                  onChange={(e) =>
                    setRuleDraft((d) => ({
                      ...d,
                      frameworkName: e.target.value,
                    }))
                  }
                  placeholder="Framework name this rule selects"
                  className={inputClass}
                />
                <select
                  value={ruleDraft.lifecycleType}
                  onChange={(e) =>
                    setRuleDraft((d) => ({
                      ...d,
                      lifecycleType: e.target.value,
                    }))
                  }
                  className={inputClass}
                >
                  <option value="">Any lifecycle type</option>
                  {LIFECYCLE_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <input
                  value={ruleDraft.minValueUsd}
                  onChange={(e) =>
                    setRuleDraft((d) => ({ ...d, minValueUsd: e.target.value }))
                  }
                  placeholder="Minimum case value (USD)"
                  className={inputClass}
                />
                <select
                  value={ruleDraft.intensityFloor}
                  onChange={(e) =>
                    setRuleDraft((d) => ({
                      ...d,
                      intensityFloor: e.target.value,
                    }))
                  }
                  className={inputClass}
                >
                  <option value="">No intensity floor</option>
                  {["light", "standard", "elevated", "full"].map((i) => (
                    <option key={i} value={i}>
                      floor: {i}
                    </option>
                  ))}
                </select>
                <input
                  value={ruleDraft.description}
                  onChange={(e) =>
                    setRuleDraft((d) => ({ ...d, description: e.target.value }))
                  }
                  placeholder="What this rule says, in words"
                  className={`${inputClass} sm:col-span-2`}
                />
                <button
                  onClick={() =>
                    void act(
                      () =>
                        addTailoringRule({
                          ruleSetId: ruleDraft.ruleSetId,
                          priority: Number(ruleDraft.priority) || 50,
                          description: ruleDraft.description,
                          lifecycleTypes: ruleDraft.lifecycleType
                            ? [ruleDraft.lifecycleType]
                            : null,
                          minValueUsd: ruleDraft.minValueUsd
                            ? Number(ruleDraft.minValueUsd)
                            : null,
                          frameworkName: ruleDraft.frameworkName,
                          intensityFloor: ruleDraft.intensityFloor || null,
                        }),
                      "Rule added to the draft set. It selects nothing until the set is adopted.",
                    )
                  }
                  disabled={busy}
                  className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
                >
                  Add rule
                </button>
              </div>

              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-5">
                <select
                  value={thresholdDraft.ruleSetId}
                  onChange={(e) =>
                    setThresholdDraft((d) => ({
                      ...d,
                      ruleSetId: e.target.value,
                    }))
                  }
                  className={inputClass}
                >
                  <option value="">Draft rule set…</option>
                  {draftRuleSets.map((rs) => (
                    <option key={rs.id} value={rs.id}>
                      {rs.name} v{rs.version}
                    </option>
                  ))}
                </select>
                <input
                  value={thresholdDraft.standard}
                  onChange={(e) =>
                    setThresholdDraft((d) => ({
                      ...d,
                      standard: e.target.value,
                    }))
                  }
                  placeholder="standard from (USD)"
                  className={inputClass}
                />
                <input
                  value={thresholdDraft.elevated}
                  onChange={(e) =>
                    setThresholdDraft((d) => ({
                      ...d,
                      elevated: e.target.value,
                    }))
                  }
                  placeholder="elevated from (USD)"
                  className={inputClass}
                />
                <input
                  value={thresholdDraft.full}
                  onChange={(e) =>
                    setThresholdDraft((d) => ({ ...d, full: e.target.value }))
                  }
                  placeholder="full from (USD)"
                  className={inputClass}
                />
                <button
                  onClick={() =>
                    void act(
                      () =>
                        setRuleSetThresholds(thresholdDraft.ruleSetId, {
                          standard_from_usd: Number(thresholdDraft.standard),
                          elevated_from_usd: Number(thresholdDraft.elevated),
                          full_from_usd: Number(thresholdDraft.full),
                        }),
                      "Value thresholds set on the draft rule set.",
                    )
                  }
                  disabled={busy}
                  className="rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-50"
                >
                  Set thresholds
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Thresholds must ascend, every referenced framework must be
                ADOPTED, and an adopted set is immutable — all three refusals
                come from the server, verbatim.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
