/**
 * Sync Develop — the governance regime panel for the Case Workspace
 * (D3.03/D3.04/D3.05/D11.14): which framework governs this case and why,
 * the six-factor GovernanceIntensity determination, what the adopted
 * intensity binding ENFORCES at every gate, and the org-tree inheritance
 * chain the profile resolved through.
 *
 * HONESTY RULES, inherited from the page this mounts on:
 *   * the determination shown is the persisted development_case_governance
 *     row — the same row the gate-review RPC and the persistence-boundary
 *     trigger consult; nothing is recomputed as display truth;
 *   * the PREVIEW under the classification form is computed by the pure lib
 *     (computeGovernanceIntensity + compileGovernanceRegime — the documented
 *     mirrors of the SQL) and is labeled a preview; the recorded level and
 *     selection only ever come back from apply_case_governance;
 *   * the binding's OUTSTANDING demands shown are the server's own
 *     case_binding_gate_demands result — the same predicate the gate
 *     trigger, advance and sanction consume;
 *   * refusals render VERBATIM, including the named missing factors;
 *   * a level with no ADOPTED binding says so — enforcement is armed by
 *     adoption, never implied.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Landmark, Scale, ShieldCheck, TreePine } from "lucide-react";
import {
  FACTOR_RATING_SCALES,
  compileGovernanceRegime,
  computeGovernanceIntensity,
  type GovernanceFactorInputs,
  type RatedFactor,
  type TailoringRule,
} from "../../lib/develop/governance";
import {
  adoptGovernanceRuleSet,
  adoptIntensityBinding,
  applyCaseGovernance,
  createGovernanceRuleSetVersion,
  getCaseGovernance,
  seedGovernanceLibrary,
  type CaseGovernance,
} from "../../services/developService";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";

const LEVEL_BADGE: Record<string, string> = {
  light: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  standard: "border-signal-cyan/30 bg-signal-cyan/10 text-signal-cyan",
  elevated: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  full: "border-red-400/30 bg-red-400/10 text-red-300",
};

const FACTOR_LABELS: Array<{ key: RatedFactor; label: string }> = [
  { key: "risk", label: "Risk" },
  { key: "complexity", label: "Complexity" },
  { key: "novelty", label: "Novelty" },
  { key: "regulatory_exposure", label: "Regulatory exposure" },
  { key: "interfaces", label: "Interfaces" },
];

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div className="rounded border border-red-400/30 bg-red-400/10 px-2.5 py-1.5 text-xs text-red-300 whitespace-pre-wrap">
      {error}
    </div>
  );
}

function LevelBadge({ level }: { level: string }) {
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${LEVEL_BADGE[level] ?? "border-white/10 text-slate-300"}`}
    >
      {level}
    </span>
  );
}

export function GovernancePanel({
  caseId,
  canReview,
  canAdmin,
  onChanged,
}: {
  caseId: string;
  canReview: boolean;
  canAdmin: boolean;
  onChanged: () => void;
}) {
  const [gov, setGov] = useState<CaseGovernance | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Record<RatedFactor, string>>({
    risk: "",
    complexity: "",
    novelty: "",
    regulatory_exposure: "",
    interfaces: "",
  });
  const [basis, setBasis] = useState("");
  const [adoptNote, setAdoptNote] = useState("");

  const load = useCallback(async () => {
    try {
      setGov(await getCaseGovernance(caseId));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const thresholds = useMemo(() => {
    const t = gov?.adoptedRuleSet?.valueThresholds;
    if (
      t == null ||
      t.standard_from_usd == null ||
      t.elevated_from_usd == null ||
      t.full_from_usd == null
    ) {
      return null;
    }
    return {
      standardFromUsd: Number(t.standard_from_usd),
      elevatedFromUsd: Number(t.elevated_from_usd),
      fullFromUsd: Number(t.full_from_usd),
    };
  }, [gov]);

  // The pure-lib PREVIEW (D3.04's mirror) — labeled as such; the recorded
  // level only ever comes back from apply_case_governance.
  const preview = useMemo(() => {
    if (gov == null) return null;
    const inputs: GovernanceFactorInputs = {
      valueUsd: gov.caseValueUsd,
      risk: ratings.risk || null,
      complexity: ratings.complexity || null,
      novelty: ratings.novelty || null,
      regulatoryExposure: ratings.regulatory_exposure || null,
      interfaces: ratings.interfaces || null,
    };
    return computeGovernanceIntensity(inputs, thresholds);
  }, [gov, ratings, thresholds]);

  // The full compiler mirror (D3.03): which rule and framework the stated
  // ratings would select, and the effective level after the rule floor —
  // labeled a preview; apply_case_governance makes the record.
  const regimePreview = useMemo(() => {
    if (gov?.adoptedRuleSet == null) return null;
    const rules: TailoringRule[] = gov.adoptedRuleSet.rules.map((r) => ({
      id: r.id,
      priority: r.priority,
      description: r.description,
      lifecycleTypes: r.lifecycleTypes,
      minValueUsd: r.minValueUsd,
      maxValueUsd: r.maxValueUsd,
      minIntensity: r.minIntensity,
      maxIntensity: r.maxIntensity,
      frameworkName: r.frameworkName,
      intensityFloor: r.intensityFloor,
    }));
    const inputs: GovernanceFactorInputs = {
      valueUsd: gov.caseValueUsd,
      risk: ratings.risk || null,
      complexity: ratings.complexity || null,
      novelty: ratings.novelty || null,
      regulatoryExposure: ratings.regulatory_exposure || null,
      interfaces: ratings.interfaces || null,
    };
    return compileGovernanceRegime(
      rules,
      inputs,
      gov.lifecycleType,
      thresholds,
    );
  }, [gov, ratings, thresholds]);

  async function act(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setActError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      setAdoptNote("");
      await load();
      onChanged();
    } catch (e) {
      setActError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    setActError(null);
    setNotice(null);
    try {
      const result = await applyCaseGovernance({
        caseId,
        risk: ratings.risk,
        complexity: ratings.complexity,
        novelty: ratings.novelty,
        regulatoryExposure: ratings.regulatory_exposure,
        interfaces: ratings.interfaces,
        basis,
      });
      setNotice(
        `Determined: ${result.intensity_level} intensity under rule ${result.rule.priority} — framework ${result.framework.name} v${result.framework.version}.` +
          (result.binding_note ? ` ${result.binding_note}` : ""),
      );
      setBasis("");
      await load();
      onChanged();
    } catch (e) {
      setActError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function seedLibrary() {
    setBusy(true);
    setActError(null);
    try {
      const r = await seedGovernanceLibrary();
      setNotice(
        `Library seeded: ${r.profiles_added} profile(s) added as drafts.${r.note ? ` ${r.note}` : ""}`,
      );
      await load();
      onChanged();
    } catch (e) {
      setActError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const det = gov?.determination ?? null;

  return (
    <div className="rounded-xl border border-white/6 bg-[#0D1520] p-5">
      <div className="mb-1 flex items-center gap-2">
        <Scale className="h-4 w-4 text-slate-500" aria-hidden />
        <h2 className="text-sm font-semibold text-slate-100">
          Governance regime
        </h2>
        {det && <LevelBadge level={det.intensityLevel} />}
      </div>
      <p className="text-xs text-slate-400">
        Risk-based governance intensity (spec I.2): six factors — value, risk,
        complexity, novelty, regulatory exposure, interfaces — computed from
        stated inputs, matched against the adopted tailoring rules, and ENFORCED
        at every gate through the adopted intensity binding.
      </p>

      {loadError && (
        <div className="mt-3">
          <ErrorLine error={loadError} />
        </div>
      )}
      {gov && (
        <div className="mt-4 space-y-4">
          {/* Current determination — the persisted, enforced row. */}
          {det ? (
            <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                <span className="font-semibold text-slate-100">
                  Determined intensity:
                </span>
                <LevelBadge level={det.intensityLevel} />
                {det.intensityLevel !== det.computedLevel && (
                  <span className="text-slate-400">
                    (computed {det.computedLevel}; raised by rule floor)
                  </span>
                )}
                <span className="text-slate-500">
                  drivers: {det.drivers.join(", ")}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(det.factorLevels).map(([factor, level]) => (
                  <span
                    key={factor}
                    className="rounded border border-white/8 px-1.5 py-0.5 text-[10px] text-slate-400"
                  >
                    {factor}: {level}/4
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Rule {det.rule.priority} of {det.ruleSet.name} v
                {det.ruleSet.version}: {det.rule.description} — framework{" "}
                {det.framework.name} v{det.framework.version}. Determined{" "}
                {new Date(det.determinedAt).toLocaleDateString()}
                {det.determinedBy ? ` by ${det.determinedBy}` : ""}. Basis:{" "}
                {det.basis}
              </p>
              <div className="mt-2 flex items-start gap-2 rounded border border-white/8 px-2.5 py-2 text-[11px]">
                <ShieldCheck
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500"
                  aria-hidden
                />
                {det.binding ? (
                  <span className="text-slate-300">
                    Adopted binding v{det.binding.version} at this level
                    enforces:{" "}
                    {det.binding.evidenceLinkedDeliverablesRequired
                      ? "an ACCEPTED deliverable behind every mandatory gate requirement (gate passes are refused at the database without one); "
                      : ""}
                    {det.binding.independentAssuranceRequired
                      ? "independent recording on every gate (sponsor/creator refused); "
                      : ""}
                    assurance level {det.binding.assuranceLevel}
                    {det.binding.reviewCadenceDays != null
                      ? `; review cadence ${det.binding.reviewCadenceDays} days`
                      : ""}
                    .
                  </span>
                ) : (
                  <span className="text-amber-300">
                    No ADOPTED binding exists at or below this intensity level —
                    its requirements are not yet armed
                    (adopt_intensity_binding).
                  </span>
                )}
              </div>
              {gov.bindingUnmet && (
                <div className="mt-2 rounded border border-amber-400/25 bg-amber-400/5 px-2.5 py-2 text-[11px] text-amber-200">
                  Outstanding binding demands on the current stage (the same
                  predicate that refuses gate passes, stage advance and
                  sanction):
                  {gov.bindingUnmet.unlinked_mandatory.length > 0 && (
                    <>
                      {" "}
                      {gov.bindingUnmet.unlinked_mandatory.length} mandatory
                      criterion/criteria without an ACCEPTED deliverable (
                      {gov.bindingUnmet.unlinked_mandatory.join("; ")}).
                    </>
                  )}
                  {gov.bindingUnmet.non_independent_gates.length > 0 && (
                    <>
                      {" "}
                      {gov.bindingUnmet.non_independent_gates.length} gate(s)
                      whose passing review was recorded by the case
                      sponsor/creator where independent assurance is required (
                      {gov.bindingUnmet.non_independent_gates.join("; ")}).
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3 text-xs text-slate-400">
              No governance determination is recorded for this case. Until one
              is applied, intensity-based enforcement holds nothing here — the
              gates still enforce their own mandatory criteria.
            </div>
          )}

          {/* Inheritance chain (D11.14). */}
          <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
            <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-slate-200">
              <TreePine className="h-3.5 w-3.5 text-slate-500" aria-hidden />
              Organization tree &amp; profile inheritance
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              {gov.orgChain.map((n, i) => (
                <span key={n.nodeId} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-slate-600">↑</span>}
                  <span
                    className={`rounded border px-1.5 py-0.5 ${n.carriesProfile ? "border-signal-cyan/30 text-signal-cyan" : "border-white/8 text-slate-400"}`}
                  >
                    {n.name} ({n.orgLevel})
                    {n.carriesProfile ? " • carries profile" : ""}
                  </span>
                </span>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              {gov.framework ? (
                <>
                  This case is governed by {gov.framework.name} v
                  {gov.framework.version}
                  {gov.inheritedProfile &&
                  gov.inheritedProfile.frameworkId === gov.framework.id &&
                  gov.inheritedProfile.depth > 0
                    ? ` — inherited from ${gov.inheritedProfile.sourceNode?.name} (${gov.inheritedProfile.sourceNode?.orgLevel}).`
                    : "."}
                </>
              ) : gov.inheritedProfile ? (
                <>
                  Nothing explicit on the case; the tree resolves{" "}
                  {gov.inheritedProfile.name} v{gov.inheritedProfile.version}{" "}
                  from {gov.inheritedProfile.sourceNode?.name} (
                  {gov.inheritedProfile.sourceNode?.orgLevel})
                  {gov.inheritedProfile.operableHere
                    ? " — new cases created without a framework inherit it."
                    : " — owned by an ancestor node, not yet operable at this node (cross-node framework operation is named future work)."}
                </>
              ) : (
                "No organization on this case's tree carries a governance profile — attach one (set_org_governance_profile) or select a framework explicitly at intake."
              )}
            </p>
          </div>

          {/* Arming & succession (executive/administrator): adoption is what
              makes rules determine and bindings enforce — surfaced here so
              the chain never stalls at a psql step. Server-side role gates
              stay the authority; refusals render verbatim below. */}
          {canAdmin &&
            (gov.draftRuleSets.length > 0 ||
              gov.draftBindings.length > 0 ||
              gov.adoptedRuleSet != null) && (
              <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-200">
                  <ShieldCheck
                    className="h-3.5 w-3.5 text-slate-500"
                    aria-hidden
                  />
                  Arm the governance machinery (adoption is the recorded act)
                </div>
                <input
                  className={`${inputClass} mb-2`}
                  placeholder="Adoption note — authority and basis (20 characters minimum)"
                  value={adoptNote}
                  onChange={(e) => setAdoptNote(e.target.value)}
                />
                <div className="space-y-1.5">
                  {gov.draftRuleSets.map((rs) => (
                    <div
                      key={rs.id}
                      className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400"
                    >
                      <span>
                        Draft rule set: {rs.name} v{rs.version} — drafts
                        determine nothing until adopted
                      </span>
                      <button
                        onClick={() =>
                          void act(
                            () => adoptGovernanceRuleSet(rs.id, adoptNote),
                            `Rule set ${rs.name} v${rs.version} adopted — the compiler now runs this configuration.`,
                          )
                        }
                        disabled={busy}
                        className="rounded border border-white/10 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-50"
                      >
                        Adopt rule set
                      </button>
                    </div>
                  ))}
                  {gov.adoptedRuleSet != null && (
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                      <span>
                        Adopted: {gov.adoptedRuleSet.name} v
                        {gov.adoptedRuleSet.version} — immutable; change it by
                        drafting the next version
                      </span>
                      <button
                        onClick={() => {
                          const ars = gov.adoptedRuleSet;
                          if (ars == null) return;
                          void act(
                            () => createGovernanceRuleSetVersion(ars.id),
                            `Drafted the next version of ${ars.name} (rules cloned) — edit it, then adopt it.`,
                          );
                        }}
                        disabled={busy}
                        className="rounded border border-white/10 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-50"
                      >
                        Draft new version
                      </button>
                    </div>
                  )}
                  {gov.draftBindings.map((b) => (
                    <div
                      key={b.id}
                      className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400"
                    >
                      <span>
                        Draft binding: <LevelBadge level={b.intensityLevel} /> v
                        {b.version} —{" "}
                        {b.evidenceLinkedDeliverablesRequired
                          ? "evidence-linked deliverables; "
                          : ""}
                        {b.independentAssuranceRequired
                          ? "independent assurance; "
                          : ""}
                        assurance {b.assuranceLevel} — arms nothing until
                        adopted
                      </span>
                      <button
                        onClick={() =>
                          void act(
                            () => adoptIntensityBinding(b.id, adoptNote),
                            `Intensity binding ${b.intensityLevel} v${b.version} adopted — enforcement at this level is now armed.`,
                          )
                        }
                        disabled={busy}
                        className="rounded border border-white/10 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-50"
                      >
                        Adopt binding
                      </button>
                    </div>
                  ))}
                </div>
                {!canReview && (
                  <div className="mt-2 space-y-2">
                    <ErrorLine error={actError} />
                    {notice && (
                      <div className="rounded border border-emerald-400/25 bg-emerald-400/5 px-2.5 py-1.5 text-xs text-emerald-200">
                        {notice}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

          {/* The determination act (review roles). */}
          {canReview && (
            <div className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-200">
                <Landmark className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                {det ? "Re-determine the regime" : "Determine the regime"}
              </div>
              {gov.adoptedRuleSet == null ? (
                <div className="space-y-2 text-xs text-slate-400">
                  <p>
                    No ADOPTED tailoring rule set exists in this organization,
                    so nothing can be determined — a determination without
                    adopted rules would be an opinion. Seed the reference
                    library (drafts), then adopt a rule set
                    (adopt_governance_rule_set).
                  </p>
                  {canAdmin && (
                    <button
                      onClick={() => void seedLibrary()}
                      disabled={busy}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-50"
                    >
                      {busy
                        ? "Seeding…"
                        : "Seed the framework library (drafts)"}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <p className="mb-2 text-[11px] text-slate-500">
                    Value factor:{" "}
                    {gov.caseValueUsd != null
                      ? `$${Number(gov.caseValueUsd).toLocaleString()} (from the case's stated ${(det?.factorInputs?.value_source ?? gov.caseValueSource) === "sanctioned_value" ? "sanctioned value" : "capex"})`
                      : "NOT STATED — record estimated_capex on the case; the calculation refuses without it"}
                    {" · rules: "}
                    {gov.adoptedRuleSet.name} v{gov.adoptedRuleSet.version} (
                    {gov.adoptedRuleSet.rules.length} rules)
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
                    {FACTOR_LABELS.map(({ key, label }) => (
                      <label key={key} className="text-[11px] text-slate-400">
                        {label}
                        <select
                          className={`${inputClass} mt-1`}
                          value={ratings[key]}
                          onChange={(e) =>
                            setRatings((r) => ({ ...r, [key]: e.target.value }))
                          }
                        >
                          <option value="">not stated</option>
                          {FACTOR_RATING_SCALES[key].map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  <textarea
                    className={`${inputClass} mt-2`}
                    rows={2}
                    placeholder="Basis for these classifications — who assessed them and from what (20 characters minimum)"
                    value={basis}
                    onChange={(e) => setBasis(e.target.value)}
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => void apply()}
                      disabled={busy}
                      className="rounded-lg bg-signal-cyan/90 px-3 py-1.5 text-xs font-semibold text-[#06121D] hover:bg-signal-cyan disabled:opacity-50"
                    >
                      {busy ? "Determining…" : "Apply governance determination"}
                    </button>
                    {preview && (
                      <span className="text-[11px] text-slate-500">
                        {preview.ok ? (
                          <>
                            preview (pure lib, not the record):{" "}
                            <LevelBadge level={preview.level} /> drivers{" "}
                            {preview.drivers.join(", ")}
                          </>
                        ) : (
                          <>preview: {preview.reason}</>
                        )}
                      </span>
                    )}
                  </div>
                  <div className="mt-1">
                    {regimePreview && preview?.ok && (
                      <span className="text-[11px] text-slate-500">
                        {regimePreview.ok ? (
                          <>
                            rule preview: rule {regimePreview.rule.priority}{" "}
                            selects {regimePreview.frameworkName} — effective{" "}
                            <LevelBadge level={regimePreview.effectiveLevel} />
                            {regimePreview.effectiveLevel !==
                              regimePreview.computedLevel &&
                              " (raised by the rule floor)"}
                          </>
                        ) : (
                          <>rule preview: {regimePreview.reason}</>
                        )}
                      </span>
                    )}
                  </div>
                </>
              )}
              <div className="mt-2 space-y-2">
                <ErrorLine error={actError} />
                {notice && (
                  <div className="rounded border border-emerald-400/25 bg-emerald-400/5 px-2.5 py-1.5 text-xs text-emerald-200">
                    {notice}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
