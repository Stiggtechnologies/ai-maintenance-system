/**
 * Sync Develop — the value spine of the Case Workspace (Slice 2):
 * the §44 Objective section (D11.15), the ProjectSuccessContract (D1.01),
 * the business case with its machine-readable hypothesis, thirteen-dimension
 * finance model, declared viability envelope and recorded value trajectory
 * (D2.01–D2.07), the since-sanction delta (D2.05), benefits with mandatory
 * owners (D9.10), and the §44 Cost section.
 *
 * HONESTY RULES, inherited from the page these mount on:
 *   * every number is either a ROW a governed RPC returned or a kernel
 *     computation over recorded inputs whose completeness the SERVER
 *     asserted (npvInputsComplete) — nothing else renders as a number;
 *   * refusals render VERBATIM — "NPV unavailable: no discount rate source
 *     recorded", "not evaluated at this gate", "no value evaluation was
 *     recorded at or before sanction" are the product, not error states;
 *   * the trajectory renders recorded points only; a gate without a linked
 *     evaluation says so in words at that gate;
 *   * the collapse verdict (D2.03) is shown exactly as the deterministic
 *     rule returned it — the recommendation it raises is a Case Workspace
 *     action a HUMAN decides.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Banknote,
  Coins,
  Landmark,
  LineChart,
  ListChecks,
  Target,
  TrendingDown,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  SUCCESS_DIMENSIONS,
  type CaseFinanceModel,
  type CaseValueTrajectory,
  type CaseWorkspace,
  type CollapseVerdict,
  type SinceSanctionDelta,
} from "../../lib/develop";
import { cashFlowsDefect, irr, npv, paybackPeriod, type CashFlow } from "../../lib/value";
import {
  addBusinessCaseOption,
  createCaseBusinessCase,
  draftSuccessContract,
  getCaseFinanceModel,
  getCaseValueTrajectory,
  getSinceSanctionDelta,
  listCaseRamTargets,
  recordCaseAssumption,
  recordCaseBenefit,
  recordCaseValueEvaluation,
  recordSuccessContract,
  recordValueHypothesis,
  setCaseViabilityFloor,
  setSuccessOutcome,
  upsertFinancialAssumption,
  type CaseRamTargetOption,
  type OrgMember,
} from "../../services/developService";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";

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

function money(value: number | null | undefined, currency = "USD"): string {
  if (value == null) return "not stated";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)} ${currency}`;
}

// ---------------------------------------------------------------------------
// §44 Objective — the case's anchor in the ONE objective store (D11.15).
// ---------------------------------------------------------------------------
export function ObjectiveSection({ workspace }: { workspace: CaseWorkspace }) {
  const objective = workspace.objective;
  return (
    <Section
      icon={<Target className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Objective"
      subtitle="What this case exists to move — the risk-objective store is the one objective vocabulary (spec §2)."
    >
      {objective == null ? (
        <p className="text-xs text-slate-500">
          No objective anchors this case. Set one at creation, or adopt an
          objective in the Risk Operating System and re-create the case
          against it — risks, benefits and the success contract all anchor
          there.
        </p>
      ) : (
        <div className="space-y-2 text-sm">
          {objective.ancestors.length > 0 && (
            <p className="text-[11px] text-slate-500">
              {objective.ancestors
                .map((a) => `${a.level.replaceAll("_", " ")}: ${a.description}`)
                .join(" → ")}{" "}
              →
            </p>
          )}
          <p className="text-slate-200">{objective.description}</p>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 md:grid-cols-4">
            <div>
              <span className="block text-[11px] uppercase text-slate-500">
                Level
              </span>
              {objective.level.replaceAll("_", " ")}
            </div>
            <div>
              <span className="block text-[11px] uppercase text-slate-500">
                Target
              </span>
              {objective.target}
            </div>
            <div>
              <span className="block text-[11px] uppercase text-slate-500">
                Typed target
              </span>
              {objective.targetValue != null
                ? `${objective.targetValue} ${objective.unit ?? ""}${objective.targetDate ? ` by ${objective.targetDate}` : ""}`
                : "not stated"}
            </div>
            <div>
              <span className="block text-[11px] uppercase text-slate-500">
                Linked risks
              </span>
              {objective.linkedRisks}
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            Tolerance: {objective.tolerance} · Owner:{" "}
            {objective.owner ?? "not stated"} · {objective.status}
          </p>
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// ProjectSuccessContract (D1.01) — success defined before design (D1.02).
// ---------------------------------------------------------------------------
export function SuccessContractSection({
  workspace,
  members,
  canPlan,
  canReview,
  onChanged,
}: {
  workspace: CaseWorkspace;
  members: OrgMember[];
  canPlan: boolean;
  canReview: boolean;
  onChanged: () => void;
}) {
  const contract = workspace.successContract;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [dimension, setDimension] = useState<string>("business");
  const [statement, setStatement] = useState("");
  const [basis, setBasis] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [targetValue, setTargetValue] = useState("");
  const [unit, setUnit] = useState("");
  const [ramTargetId, setRamTargetId] = useState("");
  const [ramTargets, setRamTargets] = useState<CaseRamTargetOption[]>([]);
  const [recordNote, setRecordNote] = useState("");

  useEffect(() => {
    listCaseRamTargets(workspace.id)
      .then(setRamTargets)
      .catch(() => setRamTargets([]));
  }, [workspace.id]);

  const covered = new Set((contract?.outcomes ?? []).map((o) => o.dimension));
  const isRamDimension = ["reliability", "availability", "maintainability"].includes(
    dimension,
  );

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refused");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      icon={<Landmark className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Success contract"
      subtitle="Eleven outcome dimensions, each with a target, a stated basis and an accountable owner — recorded before design-stage gates can pass (spec I.3)."
    >
      <ErrorLine error={error} />
      {contract == null ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">
            No success contract exists on this case. Design-and-later gates
            will refuse to pass until one is recorded — that is the D1.02
            invariant, not a warning.
          </p>
          {canPlan && (
            <button
              onClick={() =>
                void run(() => draftSuccessContract(workspace.id))
              }
              disabled={busy}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-50"
            >
              Draft the contract
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`rounded-full px-2 py-0.5 font-semibold ${contract.status === "recorded" ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"}`}
            >
              v{contract.version} · {contract.status}
            </span>
            <span className="text-slate-400">
              {covered.size} of {contract.dimensionsTotal} dimensions covered
            </span>
            {contract.recordedAt && (
              <span className="text-slate-500">
                recorded {new Date(contract.recordedAt).toLocaleDateString()}
                {contract.recordedBy ? ` by ${contract.recordedBy}` : ""}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {SUCCESS_DIMENSIONS.map((d) => (
              <span
                key={d}
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${covered.has(d) ? "bg-signal-cyan/10 text-signal-cyan" : "bg-white/5 text-slate-500"}`}
              >
                {d}
              </span>
            ))}
          </div>
          {contract.outcomes.length === 0 ? (
            <p className="text-xs text-slate-500">
              No outcomes stated yet — a contract with no outcomes defines no
              success and cannot be recorded.
            </p>
          ) : (
            <div className="space-y-1.5">
              {contract.outcomes.map((o) => (
                <div
                  key={o.id}
                  className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs"
                >
                  <span className="font-semibold text-slate-200">
                    {o.dimension}
                  </span>{" "}
                  <span className="text-slate-300">{o.statement}</span>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {o.ramTarget
                      ? `References RAM target ${o.ramTarget.systemLabel} (availability ${(o.ramTarget.targetAvailability * 100).toFixed(1)}%) — the canonical record, never duplicated`
                      : o.targetValue != null
                        ? `Target ${o.targetValue} ${o.unit ?? ""}`
                        : "Target: stated in words"}
                    {" · "}Basis: {o.basis} · Owner: {o.owner ?? "not stated"}
                  </div>
                </div>
              ))}
            </div>
          )}

          {contract.status === "draft" && canPlan && (
            <div className="space-y-2 rounded-lg border border-white/8 p-3">
              {!adding ? (
                <button
                  onClick={() => setAdding(true)}
                  className="text-xs font-semibold text-signal-cyan hover:underline"
                >
                  + State an outcome
                </button>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <select
                    value={dimension}
                    onChange={(e) => setDimension(e.target.value)}
                    className={inputClass}
                  >
                    {SUCCESS_DIMENSIONS.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <select
                    value={ownerId}
                    onChange={(e) => setOwnerId(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Outcome owner (required)</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name ?? m.email ?? m.id}
                      </option>
                    ))}
                  </select>
                  <input
                    value={statement}
                    onChange={(e) => setStatement(e.target.value)}
                    placeholder="Outcome statement (verifiable sentence)"
                    className={`${inputClass} sm:col-span-2`}
                  />
                  <input
                    value={basis}
                    onChange={(e) => setBasis(e.target.value)}
                    placeholder="Basis — where this target comes from (required)"
                    className={`${inputClass} sm:col-span-2`}
                  />
                  {isRamDimension && ramTargets.length > 0 ? (
                    <select
                      value={ramTargetId}
                      onChange={(e) => setRamTargetId(e.target.value)}
                      className={`${inputClass} sm:col-span-2`}
                    >
                      <option value="">
                        Reference a RAM target (the canonical record)
                      </option>
                      {ramTargets.map((rt) => (
                        <option key={rt.id} value={rt.id}>
                          {rt.system_label} — availability{" "}
                          {(rt.target_availability * 100).toFixed(1)}%
                        </option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <input
                        type="number"
                        step="any"
                        value={targetValue}
                        onChange={(e) => setTargetValue(e.target.value)}
                        placeholder="Target value (optional)"
                        className={inputClass}
                      />
                      <input
                        value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                        placeholder="Unit (required with a value)"
                        className={inputClass}
                      />
                    </>
                  )}
                  <button
                    onClick={() =>
                      void run(async () => {
                        await setSuccessOutcome({
                          contractId: contract.id,
                          dimension,
                          statement,
                          basis,
                          ownerId,
                          targetValue:
                            targetValue === "" ? null : Number(targetValue),
                          unit: unit || null,
                          ramTargetId:
                            ramTargetId === "" ? null : Number(ramTargetId),
                        });
                        setStatement("");
                        setBasis("");
                        setTargetValue("");
                        setUnit("");
                        setRamTargetId("");
                      })
                    }
                    disabled={busy}
                    className="rounded-lg bg-signal-cyan/10 border border-signal-cyan/30 px-3 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-50 sm:col-span-2"
                  >
                    {busy ? "Stating…" : "State outcome"}
                  </button>
                </div>
              )}
              {canReview && (
                <div className="flex gap-2 pt-1">
                  <input
                    value={recordNote}
                    onChange={(e) => setRecordNote(e.target.value)}
                    placeholder="Basis for recording this contract (20 characters minimum)"
                    className={inputClass}
                  />
                  <button
                    onClick={() =>
                      void run(() =>
                        recordSuccessContract({
                          contractId: contract.id,
                          note: recordNote,
                        }),
                      )
                    }
                    disabled={busy}
                    className="shrink-0 rounded-lg bg-emerald-400/10 border border-emerald-400/30 px-3 py-1.5 text-xs font-semibold text-emerald-300 disabled:opacity-50"
                  >
                    Record contract
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Business case & value (D2.01–D2.07): hypothesis, finance model, viability
// envelope, evaluations, trajectory, since-sanction delta.
// ---------------------------------------------------------------------------
export function BusinessCaseSection({
  workspace,
  members,
  canPlan,
  canReview,
  onChanged,
}: {
  workspace: CaseWorkspace;
  members: OrgMember[];
  canPlan: boolean;
  canReview: boolean;
  onChanged: () => void;
}) {
  const [model, setModel] = useState<CaseFinanceModel | null>(null);
  const [trajectory, setTrajectory] = useState<CaseValueTrajectory | null>(
    null,
  );
  const [delta, setDelta] = useState<SinceSanctionDelta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapse, setCollapse] = useState<CollapseVerdict | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, t, d] = await Promise.all([
        getCaseFinanceModel(workspace.id),
        getCaseValueTrajectory(workspace.id),
        getSinceSanctionDelta(workspace.id),
      ]);
      setModel(m);
      setTrajectory(t);
      setDelta(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load the model");
    }
  }, [workspace.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refused");
    } finally {
      setBusy(false);
    }
  };

  // Kernel numbers — computed ONLY when the server said the inputs are
  // complete; otherwise the server's refusals render verbatim.
  const kernelRows = useMemo(() => {
    if (!model?.available || !model.npvInputsComplete || !model.businessCase) {
      return [];
    }
    const rate = model.businessCase.discountRate;
    return (model.options ?? []).map((option) => {
      const flows = option.cashFlows as CashFlow[];
      // The DB refuses malformed flows at the schema; this is the same
      // refusal at the render boundary — a defective row gets a NAMED
      // refusal, never NaN dressed as money.
      const defect = cashFlowsDefect(flows);
      const rateResult = irr(flows);
      const payback = paybackPeriod(flows);
      if (defect != null) {
        return {
          option,
          defect,
          npv: null,
          irr: rateResult,
          payback,
          capital: null,
          operatingTotal: null,
        };
      }
      const value = npv(flows, rate);
      const capital = flows
        .filter((f) => f.period === 0 && f.amount < 0)
        .reduce((s, f) => s + f.amount, 0);
      const operating = flows.filter((f) => f.period > 0 && f.amount < 0);
      return {
        option,
        defect: null,
        npv: value,
        irr: rateResult,
        payback,
        capital,
        operatingTotal: operating.reduce((s, f) => s + f.amount, 0),
      };
    });
  }, [model]);

  return (
    <Section
      icon={<Banknote className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Business case & value"
      subtitle="The economics this case is judged by: hypothesis, thirteen-dimension finance model, declared viability envelope, recorded trajectory. Refusals render verbatim — a missing number is named, never invented."
    >
      <ErrorLine error={error} />
      {collapse && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs ${collapse.collapsed ? "border-red-400/40 bg-red-400/10 text-red-200" : "border-white/10 bg-white/[0.03] text-slate-300"}`}
        >
          {collapse.collapsed
            ? `Collapse rule fired: recorded EV ${money(collapse.expectedValue)} is below the declared floor ${money(collapse.viabilityFloor)} — sanction-reconsideration recommendation ${collapse.already_open ? "already open" : "raised"} in Actions. A human re-decides; nothing changed automatically.`
            : collapse.evaluated
              ? `Above the declared floor: headroom ${money(collapse.headroom)}.`
              : `Collapse not evaluable: ${collapse.reason}`}
        </div>
      )}

      {model == null ? (
        <p className="text-xs text-slate-500">Loading the finance model…</p>
      ) : !model.available ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">{model.reason}</p>
          {canPlan && <NewBusinessCaseForm workspace={workspace} run={run} busy={busy} />}
        </div>
      ) : (
        <div className="space-y-4">
          <BusinessCaseHeader model={model} />
          <HypothesisBlock model={model} run={run} busy={busy} canPlan={canPlan} />
          <ViabilityBlock model={model} run={run} busy={busy} canReview={canReview} />
          <OptionsBlock model={model} kernelRows={kernelRows} run={run} busy={busy} canPlan={canPlan} />
          <AssumptionsBlock
            workspace={workspace}
            model={model}
            members={members}
            run={run}
            busy={busy}
            canPlan={canPlan}
          />
          <EvaluationBlock
            workspace={workspace}
            model={model}
            kernelRows={kernelRows}
            run={run}
            busy={busy}
            canPlan={canPlan}
            onCollapse={setCollapse}
          />
          <TrajectoryBlock trajectory={trajectory} />
          <DeltaBlock delta={delta} />
        </div>
      )}
    </Section>
  );
}

function NewBusinessCaseForm({
  workspace,
  run,
  busy,
}: {
  workspace: CaseWorkspace;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
}) {
  const [caseRef, setCaseRef] = useState("");
  const [title, setTitle] = useState("");
  const [driver, setDriver] = useState("reliability");
  const [rate, setRate] = useState("");
  const [rateSource, setRateSource] = useState("");
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <input value={caseRef} onChange={(e) => setCaseRef(e.target.value)} placeholder="Case reference (unique)" className={inputClass} />
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Business case title" className={inputClass} />
      <select value={driver} onChange={(e) => setDriver(e.target.value)} className={inputClass}>
        {["safety", "regulatory", "reliability", "capacity", "cost_reduction", "obsolescence", "environmental"].map((d) => (
          <option key={d} value={d}>{d.replaceAll("_", " ")}</option>
        ))}
      </select>
      <input type="number" step="any" min="0" max="0.99" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="Discount rate (fraction, e.g. 0.08)" className={inputClass} />
      <input value={rateSource} onChange={(e) => setRateSource(e.target.value)} placeholder="Discount rate SOURCE (required — a rate nobody owns is refused)" className={`${inputClass} sm:col-span-2`} />
      <button
        onClick={() =>
          void run(() =>
            createCaseBusinessCase({
              caseId: workspace.id,
              caseRef,
              title,
              driver,
              discountRate: Number(rate),
              discountRateSource: rateSource,
            }),
          )
        }
        disabled={busy}
        className="rounded-lg bg-signal-cyan/10 border border-signal-cyan/30 px-3 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-50 sm:col-span-2"
      >
        {busy ? "Recording…" : "Record business case"}
      </button>
    </div>
  );
}

function BusinessCaseHeader({ model }: { model: CaseFinanceModel }) {
  const bc = model.businessCase;
  if (!bc) return null;
  return (
    <div className="text-xs text-slate-400">
      <span className="font-semibold text-slate-200">{bc.caseRef}</span> ·{" "}
      {bc.title} · {bc.driver.replaceAll("_", " ")} · discount rate{" "}
      {(bc.discountRate * 100).toFixed(1)}%{" "}
      {bc.discountRateSource ? (
        <span className="text-slate-500">({bc.discountRateSource})</span>
      ) : (
        <span className="text-amber-300">— no recorded source</span>
      )}
    </div>
  );
}

function HypothesisBlock({
  model,
  run,
  busy,
  canPlan,
}: {
  model: CaseFinanceModel;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  canPlan: boolean;
}) {
  const [spend, setSpend] = useState("");
  const [effect, setEffect] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [valuePerYear, setValuePerYear] = useState("");
  const [basis, setBasis] = useState("");
  const currency = model.businessCase?.currency ?? "USD";
  if (model.hypothesis) {
    const h = model.hypothesis;
    return (
      <div className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
        <span className="font-semibold text-slate-200">Value hypothesis:</span>{" "}
        spending {money(h.spend, currency)} will {h.effect}
        {h.effectQuantity != null
          ? ` (${h.effectQuantity} ${h.effectUnit ?? ""})`
          : ""}{" "}
        worth {money(h.valuePerYear, currency)}/year.{" "}
        <span className="text-slate-500">Basis: {h.basis}</span>
      </div>
    );
  }
  if (!canPlan) {
    return (
      <p className="text-xs text-slate-500">
        No machine-readable value hypothesis is recorded (spec I.4: spend →
        effect → value, with its basis).
      </p>
    );
  }
  return (
    <div className="space-y-2 rounded-lg border border-white/8 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">
        Value hypothesis (spend → effect → value, all-or-refuse)
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input type="number" step="any" value={spend} onChange={(e) => setSpend(e.target.value)} placeholder={`Spend (${currency})`} className={inputClass} />
        <input type="number" step="any" value={valuePerYear} onChange={(e) => setValuePerYear(e.target.value)} placeholder={`Value per year (${currency})`} className={inputClass} />
        <input value={effect} onChange={(e) => setEffect(e.target.value)} placeholder="Effect — what the spend eliminates or creates" className={`${inputClass} sm:col-span-2`} />
        <input type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Effect quantity (optional)" className={inputClass} />
        <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Effect unit (h/year, t/day…)" className={inputClass} />
        <input value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="Basis — where spend, effect and value come from (20 characters minimum)" className={`${inputClass} sm:col-span-2`} />
      </div>
      <button
        onClick={() =>
          void run(() =>
            recordValueHypothesis({
              businessCaseId: model.businessCase?.id ?? 0,
              spend: Number(spend),
              effect,
              effectQuantity: quantity === "" ? null : Number(quantity),
              effectUnit: unit || null,
              valuePerYear: Number(valuePerYear),
              basis,
            }),
          )
        }
        disabled={busy}
        className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-50"
      >
        Record hypothesis
      </button>
    </div>
  );
}

function ViabilityBlock({
  model,
  run,
  busy,
  canReview,
}: {
  model: CaseFinanceModel;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  canReview: boolean;
}) {
  const [floor, setFloor] = useState("");
  const [basis, setBasis] = useState("");
  const currency = model.businessCase?.currency ?? "USD";
  return (
    <div className="space-y-2">
      {model.viability ? (
        <div className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
          <span className="font-semibold text-slate-200">Viability floor:</span>{" "}
          {money(model.viability.floor, currency)} — below this, the collapse
          rule raises sanction reconsideration (D2.03).{" "}
          <span className="text-slate-500">Basis: {model.viability.basis}</span>
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          No viability floor is declared — without the tripwire, collapse
          detection has nothing to compare against and says so.
        </p>
      )}
      {canReview && (
        <div className="flex gap-2">
          <input type="number" step="any" value={floor} onChange={(e) => setFloor(e.target.value)} placeholder={`Floor (${currency})`} className={inputClass} />
          <input value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="Basis — why viability ends at this value (20 characters minimum)" className={inputClass} />
          <button
            onClick={() =>
              void run(() =>
                setCaseViabilityFloor({
                  businessCaseId: model.businessCase?.id ?? 0,
                  floor: Number(floor),
                  basis,
                }),
              )
            }
            disabled={busy}
            className="shrink-0 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-50"
          >
            {model.viability ? "Revise floor" : "Declare floor"}
          </button>
        </div>
      )}
    </div>
  );
}

function OptionsBlock({
  model,
  kernelRows,
  run,
  busy,
  canPlan,
}: {
  model: CaseFinanceModel;
  kernelRows: {
    option: NonNullable<CaseFinanceModel["options"]>[number];
    defect: string | null;
    npv: number | null;
    irr: ReturnType<typeof irr>;
    payback: ReturnType<typeof paybackPeriod>;
    capital: number | null;
    operatingTotal: number | null;
  }[];
  run: (fn: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  canPlan: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [life, setLife] = useState("");
  const [flows, setFlows] = useState("");
  const [doNothing, setDoNothing] = useState(false);
  const [contingency, setContingency] = useState("");
  const [contingencyBasis, setContingencyBasis] = useState("");
  const currency = model.businessCase?.currency ?? "USD";
  const refusals = model.refusals ?? [];
  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">
        Options & the computed dimensions (NPV / IRR / payback — one kernel,
        refusal-first)
      </p>
      {refusals.length > 0 && (
        <div className="space-y-1">
          {refusals.map((r) => (
            <p key={r} className="text-xs text-amber-300">
              {r}
            </p>
          ))}
        </div>
      )}
      {(model.options ?? []).length === 0 ? (
        <p className="text-xs text-slate-500">
          No options recorded. NPV, IRR and payback are computed from dated
          cash flows or not at all.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[11px] uppercase text-slate-500">
                <th className="py-1 pr-3">Option</th>
                <th className="py-1 pr-3">Capital (p0)</th>
                <th className="py-1 pr-3">NPV</th>
                <th className="py-1 pr-3">IRR</th>
                <th className="py-1 pr-3">Payback</th>
                <th className="py-1 pr-3">Contingency</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {(model.options ?? []).map((option) => {
                const k = kernelRows.find((row) => row.option.id === option.id);
                return (
                  <tr key={option.id} className="border-t border-white/5">
                    <td className="py-1.5 pr-3">
                      {option.label}
                      {option.isDoNothing ? " (do nothing)" : ""}
                      <span className="text-slate-500">
                        {" "}
                        · {option.lifePeriods}p
                      </span>
                    </td>
                    <td className="py-1.5 pr-3">
                      {k && k.capital != null ? money(k.capital, currency) : "—"}
                    </td>
                    <td className="py-1.5 pr-3">
                      {k ? (
                        k.npv != null ? (
                          money(Math.round(k.npv), currency)
                        ) : (
                          <span className="text-amber-300/80" title={k.defect ?? undefined}>
                            refused: malformed flows
                          </span>
                        )
                      ) : (
                        <span className="text-amber-300/80">inputs incomplete</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3" title={k?.irr.reason}>
                      {k
                        ? k.irr.rate != null
                          ? `${(k.irr.rate * 100).toFixed(1)}%${k.irr.reason.includes("CAVEAT") ? " ⚠" : ""}`
                          : "unavailable"
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-3" title={k?.payback.reason}>
                      {k
                        ? k.payback.periods != null
                          ? `${k.payback.periods}p`
                          : "does not return"
                        : "—"}
                    </td>
                    <td className="py-1.5 pr-3">
                      {option.contingency != null
                        ? money(option.contingency, currency)
                        : "not stated"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {canPlan &&
        (adding ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Option label" className={inputClass} />
            <input type="number" min="1" value={life} onChange={(e) => setLife(e.target.value)} placeholder="Life (periods)" className={inputClass} />
            <input
              value={flows}
              onChange={(e) => setFlows(e.target.value)}
              placeholder="Dated cash flows: period:amount, comma-separated (0:-4500000, 1:1200000, …)"
              className={`${inputClass} sm:col-span-2`}
            />
            <input type="number" step="any" value={contingency} onChange={(e) => setContingency(e.target.value)} placeholder="Contingency (optional)" className={inputClass} />
            <input value={contingencyBasis} onChange={(e) => setContingencyBasis(e.target.value)} placeholder="Contingency basis (required with a value)" className={inputClass} />
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input type="checkbox" checked={doNothing} onChange={(e) => setDoNothing(e.target.checked)} />
              This is the do-nothing option
            </label>
            <button
              onClick={() =>
                void run(async () => {
                  const parsed = flows
                    .split(",")
                    .map((part) => part.trim())
                    .filter(Boolean)
                    .map((part) => {
                      const [period, amount] = part.split(":");
                      return {
                        period: Number(period),
                        amount: Number(amount),
                      };
                    });
                  await addBusinessCaseOption({
                    businessCaseId: model.businessCase?.id ?? 0,
                    label,
                    lifePeriods: Number(life),
                    cashFlows: parsed,
                    isDoNothing: doNothing,
                    contingency:
                      contingency === "" ? null : Number(contingency),
                    contingencyBasis: contingencyBasis || null,
                  });
                  setAdding(false);
                  setLabel("");
                  setFlows("");
                })
              }
              disabled={busy}
              className="rounded-lg bg-signal-cyan/10 border border-signal-cyan/30 px-3 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-50"
            >
              {busy ? "Adding…" : "Add option"}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="text-xs font-semibold text-signal-cyan hover:underline"
          >
            + Add option with dated cash flows
          </button>
        ))}
      <EconomicAssumptionRows model={model} />
      <FundingRows model={model} />
    </div>
  );
}

function EconomicAssumptionRows({ model }: { model: CaseFinanceModel }) {
  const rows = model.economicAssumptions ?? [];
  const byKind = (kind: string) => rows.filter((r) => r.kind === kind);
  const dims: { label: string; kind: string }[] = [
    { label: "Escalation", kind: "escalation" },
    { label: "Foreign exchange", kind: "fx" },
    { label: "Commodity prices", kind: "commodity_price" },
    { label: "Funding", kind: "funding" },
  ];
  return (
    <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
      {dims.map((dim) => {
        const matching = byKind(dim.kind);
        return (
          <div key={dim.kind} className="rounded-lg bg-white/[0.02] px-3 py-2">
            <span className="text-[11px] uppercase text-slate-500">
              {dim.label}
            </span>
            {matching.length === 0 ? (
              <p className="text-slate-500">
                not recorded — this dimension renders when a{" "}
                {dim.kind.replaceAll("_", " ")} assumption series exists
              </p>
            ) : (
              matching.map((r) => (
                <p key={r.key} className="text-slate-300">
                  {r.label}: {r.value} {r.unit ?? ""}{" "}
                  <span className="text-slate-500">
                    ({r.source}, from {r.effectiveFrom})
                  </span>
                </p>
              ))
            )}
          </div>
        );
      })}
      <div className="rounded-lg bg-white/[0.02] px-3 py-2 md:col-span-2">
        <span className="text-[11px] uppercase text-slate-500">
          Economic assumptions register ({rows.length})
        </span>
        {rows.length === 0 ? (
          <p className="text-slate-500">
            no financial assumption series recorded — record them with their
            sources; every version is a new row
          </p>
        ) : (
          <p className="text-slate-400">
            {rows.map((r) => `${r.key}=${r.value}${r.unit ?? ""}`).join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}

function FundingRows({ model }: { model: CaseFinanceModel }) {
  const funding = model.fundingConstraints;
  const items = funding?.capitalPlanItems ?? [];
  const lines = funding?.capitalBudgetLines ?? [];
  return (
    <div className="rounded-lg bg-white/[0.02] px-3 py-2 text-xs">
      <span className="text-[11px] uppercase text-slate-500">
        Funding constraints
      </span>
      {items.length === 0 && lines.length === 0 ? (
        <p className="text-slate-500">
          none recorded — capital plan items and capital budget lines render
          here when the organization records them
        </p>
      ) : (
        <div className="space-y-0.5 text-slate-300">
          {items.map((item) => (
            <p key={`${item.planYear}-${item.label}`}>
              {item.planYear}: {item.label} — cost {money(item.cost)}
              {item.mandatory ? ` (mandatory: ${item.mandatoryBasis})` : ""}
            </p>
          ))}
          {lines.map((line) => (
            <p key={`${line.budgetYear}-${line.category}`}>
              {line.budgetYear} capital budget: {money(line.budgeted)} budgeted,{" "}
              {money(line.committed)} committed, {money(line.actual)} actual
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function AssumptionsBlock({
  workspace,
  model,
  members,
  run,
  busy,
  canPlan,
}: {
  workspace: CaseWorkspace;
  model: CaseFinanceModel;
  members: OrgMember[];
  run: (fn: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  canPlan: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [statement, setStatement] = useState("");
  const [trigger, setTrigger] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [parameter, setParameter] = useState("");
  const [comparator, setComparator] = useState(">=");
  const [threshold, setThreshold] = useState("");
  const [unit, setUnit] = useState("");
  const [faKey, setFaKey] = useState("");
  const [faLabel, setFaLabel] = useState("");
  const [faValue, setFaValue] = useState("");
  const [faUnit, setFaUnit] = useState("");
  const [faSource, setFaSource] = useState("");
  const [faKind, setFaKind] = useState("general");
  const thresholds = model.viabilityThresholds ?? [];
  return (
    <div className="space-y-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">
        Viability envelope — threshold assumptions on the one assumption
        family (D2.06), monitored where the numeric leg moves (D2.07)
      </p>
      {workspace.caseAssumptions.length === 0 ? (
        <p className="text-xs text-slate-500">
          No case assumptions recorded. &quot;Works only if production gain ≥
          5.2%&quot; belongs here — as a monitored predicate, not a slide.
        </p>
      ) : (
        <div className="space-y-1.5">
          {workspace.caseAssumptions.map((a) => {
            const live = thresholds.find((t) => t.assumptionId === a.id);
            return (
              <div
                key={a.id}
                className={`rounded-lg px-3 py-2 text-xs ${a.status === "invalidated" ? "bg-red-400/5 border border-red-400/20" : "bg-white/[0.03]"}`}
              >
                <span className="font-semibold text-slate-200">
                  {a.statement}
                </span>{" "}
                <span
                  className={
                    a.status === "invalidated"
                      ? "text-red-300"
                      : "text-slate-500"
                  }
                >
                  ({a.status})
                </span>
                {a.threshold && (
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    Predicate: {a.threshold.parameter} {a.threshold.comparator}{" "}
                    {a.threshold.value} {a.threshold.unit ?? ""}
                    {live?.operativeValue != null && (
                      <>
                        {" "}
                        · operative {live.operativeValue} (
                        {live.operativeSource}) · margin{" "}
                        {live.margin != null ? live.margin : "—"}
                      </>
                    )}
                    {live?.operativeValue == null &&
                      " · no operative value recorded yet for this series"}
                  </div>
                )}
                {a.invalidation && (
                  <div className="mt-0.5 text-[11px] text-red-300/80">
                    {a.invalidation.reason}
                  </div>
                )}
                <div className="mt-0.5 text-[11px] text-slate-500">
                  Owner: {a.owner ?? "not stated"}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {canPlan && (
        <div className="space-y-2">
          {!adding ? (
            <button
              onClick={() => setAdding(true)}
              className="text-xs font-semibold text-signal-cyan hover:underline"
            >
              + Declare an assumption (optionally with a monitored threshold)
            </button>
          ) : (
            <div className="grid grid-cols-1 gap-2 rounded-lg border border-white/8 p-3 sm:grid-cols-2">
              <input value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="Assumption statement (10 characters minimum)" className={`${inputClass} sm:col-span-2`} />
              <input value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="Measurable review trigger (10 characters minimum)" className={`${inputClass} sm:col-span-2`} />
              <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={inputClass}>
                <option value="">Assumption owner (required)</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.full_name ?? m.email ?? m.id}</option>
                ))}
              </select>
              <div className="grid grid-cols-3 gap-2">
                <input value={parameter} onChange={(e) => setParameter(e.target.value)} placeholder="Series key" className={inputClass} />
                <select value={comparator} onChange={(e) => setComparator(e.target.value)} className={inputClass}>
                  {[">=", "<=", ">", "<"].map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <input type="number" step="any" value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder="Threshold" className={inputClass} />
              </div>
              <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Threshold unit (optional)" className={inputClass} />
              <button
                onClick={() =>
                  void run(async () => {
                    await recordCaseAssumption({
                      caseId: workspace.id,
                      statement,
                      triggerForReview: trigger,
                      ownerId,
                      businessCaseId: model.businessCase?.id ?? null,
                      thresholdParameter: parameter || null,
                      thresholdComparator: parameter ? comparator : null,
                      thresholdValue:
                        parameter && threshold !== ""
                          ? Number(threshold)
                          : null,
                      thresholdUnit: unit || null,
                    });
                    setAdding(false);
                    setStatement("");
                    setTrigger("");
                    setParameter("");
                    setThreshold("");
                  })
                }
                disabled={busy}
                className="rounded-lg bg-signal-cyan/10 border border-signal-cyan/30 px-3 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-50"
              >
                {busy ? "Declaring…" : "Declare assumption"}
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 gap-2 rounded-lg border border-white/8 p-3 sm:grid-cols-3">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 sm:col-span-3">
              Record a financial-assumption version (the numeric leg — every
              write is a new dated version; recording runs the threshold
              sweep)
            </p>
            <input value={faKey} onChange={(e) => setFaKey(e.target.value)} placeholder="Series key (production_gain_pct…)" className={inputClass} />
            <input value={faLabel} onChange={(e) => setFaLabel(e.target.value)} placeholder="Label" className={inputClass} />
            <input type="number" step="any" value={faValue} onChange={(e) => setFaValue(e.target.value)} placeholder="Value" className={inputClass} />
            <input value={faUnit} onChange={(e) => setFaUnit(e.target.value)} placeholder="Unit (optional)" className={inputClass} />
            <select value={faKind} onChange={(e) => setFaKind(e.target.value)} className={inputClass}>
              {["general", "escalation", "fx", "commodity_price", "discount_rate", "funding"].map((k) => (
                <option key={k} value={k}>{k.replaceAll("_", " ")}</option>
              ))}
            </select>
            <input value={faSource} onChange={(e) => setFaSource(e.target.value)} placeholder="SOURCE (required — no unsourced numbers)" className={inputClass} />
            <button
              onClick={() =>
                void run(async () => {
                  await upsertFinancialAssumption({
                    key: faKey,
                    label: faLabel,
                    value: Number(faValue),
                    unit: faUnit || null,
                    source: faSource,
                    kind: faKind,
                  });
                  setFaKey("");
                  setFaValue("");
                })
              }
              disabled={busy}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5 disabled:opacity-50 sm:col-span-3"
            >
              {busy ? "Recording…" : "Record version (runs threshold sweep)"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EvaluationBlock({
  workspace,
  model,
  kernelRows,
  run,
  busy,
  canPlan,
  onCollapse,
}: {
  workspace: CaseWorkspace;
  model: CaseFinanceModel;
  kernelRows: {
    option: NonNullable<CaseFinanceModel["options"]>[number];
    defect: string | null;
    npv: number | null;
    irr: ReturnType<typeof irr>;
    payback: ReturnType<typeof paybackPeriod>;
  }[];
  run: (fn: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
  canPlan: boolean;
  onCollapse: (verdict: CollapseVerdict | null) => void;
}) {
  const [optionId, setOptionId] = useState("");
  const [basis, setBasis] = useState("");
  const [uncertainty, setUncertainty] = useState<"low" | "moderate" | "high">(
    "moderate",
  );
  if (!canPlan) return null;
  const computableRows = kernelRows.filter(
    (row): row is (typeof kernelRows)[number] & { npv: number } =>
      row.npv != null,
  );
  const selected = computableRows.find(
    (row) => String(row.option.id) === optionId,
  );
  return (
    <div className="space-y-2 rounded-lg border border-white/8 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">
        Record a value evaluation (the trajectory takes RECORDED points only;
        inputs are frozen server-side)
      </p>
      {!model.npvInputsComplete ? (
        <p className="text-xs text-amber-300">
          Not recordable yet — the server refuses until the named inputs
          exist. See the refusals above.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <select value={optionId} onChange={(e) => setOptionId(e.target.value)} className={inputClass}>
            <option value="">Evaluated option</option>
            {computableRows.map((row) => (
              <option key={row.option.id} value={row.option.id}>
                {row.option.label} — kernel NPV {Math.round(row.npv)}
              </option>
            ))}
          </select>
          <select value={uncertainty} onChange={(e) => setUncertainty(e.target.value as "low" | "moderate" | "high")} className={inputClass}>
            {["low", "moderate", "high"].map((u) => (
              <option key={u} value={u}>uncertainty: {u}</option>
            ))}
          </select>
          <input value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="Basis — what this figure rests on (20 characters minimum)" className={`${inputClass} sm:col-span-2`} />
          <button
            onClick={() =>
              void run(async () => {
                if (!selected) throw new Error("Select the evaluated option");
                const result = await recordCaseValueEvaluation({
                  caseId: workspace.id,
                  optionId: selected.option.id,
                  expectedValue: Math.round(selected.npv * 100) / 100,
                  valueBasis: basis,
                  uncertaintyLevel: uncertainty,
                  computed: {
                    npv: selected.npv,
                    irr: selected.irr.rate,
                    irrReason: selected.irr.reason,
                    paybackPeriods: selected.payback.periods,
                    paybackReason: selected.payback.reason,
                  },
                });
                onCollapse(result.collapse ?? null);
                setBasis("");
              })
            }
            disabled={busy}
            className="rounded-lg bg-signal-cyan/10 border border-signal-cyan/30 px-3 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-50 sm:col-span-2"
          >
            {busy
              ? "Recording…"
              : selected
                ? `Record EV ${Math.round(selected.npv)} (kernel NPV, frozen inputs)`
                : "Record evaluation"}
          </button>
        </div>
      )}
    </div>
  );
}

function TrajectoryBlock({
  trajectory,
}: {
  trajectory: CaseValueTrajectory | null;
}) {
  if (trajectory == null) return null;
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-500">
        <LineChart className="h-3.5 w-3.5" aria-hidden /> Expected-value
        trajectory per gate (recorded values only — D2.02)
      </p>
      {trajectory.gates.length === 0 ? (
        <p className="text-xs text-slate-500">
          No framework governs this case, so there are no gates to plot
          against.
        </p>
      ) : (
        <div className="space-y-1">
          {trajectory.gates.map((gate) => (
            <div
              key={gate.gateId}
              className="flex items-center justify-between gap-3 rounded bg-white/[0.02] px-3 py-1.5 text-xs"
            >
              <span className="text-slate-300">
                {gate.gateName}
                <span className="text-slate-500"> · {gate.stageKey}</span>
              </span>
              {gate.point ? (
                <span className="text-slate-200" title={gate.point.basis}>
                  {money(gate.point.expectedValue)}{" "}
                  <span className="text-slate-500">
                    ({new Date(gate.point.evaluatedAt).toLocaleDateString()},{" "}
                    {gate.point.uncertainty})
                  </span>
                </span>
              ) : (
                <span className="text-slate-500">{gate.note}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {trajectory.evaluations.length > 0 && (
        <p className="text-[11px] text-slate-500">
          {trajectory.evaluations.length} evaluation(s) recorded;{" "}
          {trajectory.evaluations.filter((e) => e.linkedToReview).length}{" "}
          linked to gate reviews.
          {trajectory.sanctionBaselineEvaluation
            ? ` Sanction baseline: ${money(trajectory.sanctionBaselineEvaluation.expectedValue)}.`
            : ""}
        </p>
      )}
    </div>
  );
}

function DeltaBlock({ delta }: { delta: SinceSanctionDelta | null }) {
  if (delta == null) return null;
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-slate-500">
        <TrendingDown className="h-3.5 w-3.5" aria-hidden /> Since-sanction
        delta (D2.05 — both ends or no delta)
      </p>
      {!delta.available ? (
        <p className="text-xs text-slate-500">{delta.reason}</p>
      ) : (
        <div className="space-y-1 text-xs">
          {(delta.dimensions ?? []).map((dim) => (
            <div
              key={dim.dimension}
              className="flex items-center justify-between rounded bg-white/[0.02] px-3 py-1.5"
            >
              <span className="text-slate-400">
                {dim.dimension.replaceAll("_", " ")}
              </span>
              <span
                className={
                  dim.delta < 0 ? "text-red-300" : "text-emerald-300"
                }
              >
                {money(dim.atSanction)} → {money(dim.current)} (
                {dim.delta >= 0 ? "+" : ""}
                {new Intl.NumberFormat("en-US", {
                  maximumFractionDigits: 2,
                }).format(dim.delta)}
                )
              </span>
            </div>
          ))}
          {(delta.notComparable ?? []).map((nc) => (
            <p key={nc.dimension} className="text-[11px] text-slate-500">
              {nc.dimension.replaceAll("_", " ")}: not comparable — {nc.reason}
            </p>
          ))}
          {(delta.anchorBaselines ?? []).length > 0 && (
            <p className="text-[11px] text-slate-500">
              Anchors:{" "}
              {(delta.anchorBaselines ?? [])
                .map((b) => `${b.baselineType} v${b.version}`)
                .join(", ")}{" "}
              (approved baselines, D5.26)
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Benefits (D9.10) — the ONE value store, owner mandatory.
// ---------------------------------------------------------------------------
export function BenefitsSection({
  workspace,
  members,
  canPlan,
  onChanged,
}: {
  workspace: CaseWorkspace;
  members: OrgMember[];
  canPlan: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState("usd");
  const [expectedDate, setExpectedDate] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [basis, setBasis] = useState("");
  return (
    <Section
      icon={<Coins className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Benefits"
      subtitle="Every benefit names its owner, its expected date and its basis (spec §32) — value_metrics is the one value store; verification is the one loop."
    >
      <ErrorLine error={error} />
      {workspace.benefits.length === 0 ? (
        <p className="text-xs text-slate-500">
          No benefits recorded on this case yet.
        </p>
      ) : (
        <div className="space-y-1.5">
          {workspace.benefits.map((benefit) => (
            <div
              key={benefit.id}
              className="rounded-lg bg-white/[0.03] px-3 py-2 text-xs"
            >
              <span className="font-semibold text-slate-200">
                {benefit.label}
              </span>{" "}
              <span className="text-slate-300">
                {benefit.value != null
                  ? `${new Intl.NumberFormat("en-US").format(benefit.value)} ${benefit.unit ?? ""}`
                  : "no value stated"}
              </span>{" "}
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${benefit.status === "verified" ? "bg-emerald-400/10 text-emerald-300" : benefit.status === "rejected" ? "bg-red-400/10 text-red-300" : "bg-amber-400/10 text-amber-300"}`}
              >
                {benefit.status}
              </span>
              <div className="mt-0.5 text-[11px] text-slate-500">
                Owner: {benefit.owner ?? "not stated"} · expected{" "}
                {benefit.expectedDate ?? "no date"} · Basis:{" "}
                {benefit.basis ?? "not stated"}
                {benefit.objective ? ` · measures: ${benefit.objective}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}
      {canPlan &&
        (adding ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Benefit label" className={inputClass} />
            <div className="grid grid-cols-2 gap-2">
              <input type="number" step="any" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Expected value" className={inputClass} />
              <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unit" className={inputClass} />
            </div>
            <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} className={inputClass} />
            <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={inputClass}>
              <option value="">Benefit owner (mandatory)</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.full_name ?? m.email ?? m.id}</option>
              ))}
            </select>
            <input value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="Basis — where the expected value comes from (10 characters minimum)" className={`${inputClass} sm:col-span-2`} />
            <button
              onClick={() => {
                setBusy(true);
                setError(null);
                recordCaseBenefit({
                  caseId: workspace.id,
                  label,
                  expectedValue: Number(value),
                  unit,
                  expectedDate,
                  ownerId,
                  basis,
                })
                  .then(() => {
                    setAdding(false);
                    setLabel("");
                    setValue("");
                    setBasis("");
                    onChanged();
                  })
                  .catch((e) =>
                    setError(e instanceof Error ? e.message : "Refused"),
                  )
                  .finally(() => setBusy(false));
              }}
              disabled={busy}
              className="rounded-lg bg-signal-cyan/10 border border-signal-cyan/30 px-3 py-1.5 text-xs font-semibold text-signal-cyan disabled:opacity-50 sm:col-span-2"
            >
              {busy ? "Recording…" : "Record benefit (projected until verified)"}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAdding(true)}
            className="text-xs font-semibold text-signal-cyan hover:underline"
          >
            + Record a benefit
          </button>
        ))}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// §44 Cost — the cost view over recorded rows: case figures, the approved
// COST baseline, option capital, funding constraints. Nothing computed here
// that is not a sum of recorded rows.
// ---------------------------------------------------------------------------
export function CostSection({ workspace }: { workspace: CaseWorkspace }) {
  const [model, setModel] = useState<CaseFinanceModel | null>(null);
  useEffect(() => {
    getCaseFinanceModel(workspace.id)
      .then(setModel)
      .catch(() => setModel(null));
  }, [workspace.id]);
  const costBaseline = workspace.baselines.find(
    (b) => b.baselineType === "COST" && b.status === "approved",
  );
  const currency = model?.businessCase?.currency ?? "USD";
  return (
    <Section
      icon={<ListChecks className="h-4 w-4 text-slate-500" aria-hidden />}
      title="Cost"
      subtitle="Recorded cost anchors: the case's figures, the approved COST baseline, option capital and funding constraints. Earned value, forecasts and confidence are Slice 4 and are absent, not zero."
    >
      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div>
          <span className="block text-[11px] uppercase text-slate-500">
            Estimated capex
          </span>
          <span className="text-slate-200">
            {money(workspace.estimatedCapex, currency)}
          </span>
        </div>
        <div>
          <span className="block text-[11px] uppercase text-slate-500">
            Sanctioned value
          </span>
          <span className="text-slate-200">
            {workspace.sanction
              ? money(workspace.sanction.sanctionedValue, currency)
              : "not sanctioned"}
          </span>
        </div>
        <div>
          <span className="block text-[11px] uppercase text-slate-500">
            Approved COST baseline
          </span>
          <span className="text-slate-200">
            {costBaseline
              ? `v${costBaseline.version} — ${costBaseline.description}`
              : "none approved"}
          </span>
        </div>
        <div>
          <span className="block text-[11px] uppercase text-slate-500">
            Option capital (period 0)
          </span>
          <span className="text-slate-200">
            {model?.available && (model.options ?? []).length > 0
              ? (model.options ?? [])
                  .map(
                    (o) =>
                      `${o.label}: ${money(
                        (o.cashFlows as CashFlow[])
                          .filter((f) => f.period === 0 && f.amount < 0)
                          .reduce((s, f) => s + f.amount, 0),
                        currency,
                      )}`,
                  )
                  .join(" · ")
              : "no options recorded"}
          </span>
        </div>
      </div>
    </Section>
  );
}
