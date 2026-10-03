import { useCallback, useEffect, useMemo, useState } from "react";
import { BookCheck, GraduationCap, Scale } from "lucide-react";
import {
  decideLabourRule,
  getWorkforceGovernanceWorkspace,
  recordLabourRule,
  transitionTrainingPlan,
  type LabourRuleLifecycleRow,
  type TrainingPlanLifecycleRow,
  type WorkforceGovernanceWorkspace,
} from "../services/workforceGovernanceService";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-signal-cyan/50";
const buttonClass =
  "rounded-lg border border-signal-cyan/30 bg-signal-cyan/10 px-3 py-2 text-sm font-semibold text-signal-cyan transition hover:bg-signal-cyan/15 disabled:cursor-not-allowed disabled:opacity-40";

const sources: LabourRuleLifecycleRow["source"][] = [
  "statutory",
  "labour_agreement",
  "company_standard",
  "fatigue_science",
];
const limitKinds: LabourRuleLifecycleRow["limitKind"][] = [
  "max_consecutive_days",
  "max_hours_per_shift",
  "min_rest_hours_between_shifts",
  "max_hours_per_7_days",
  "max_hours_per_14_days",
  "max_consecutive_nights",
];

function title(value: string) {
  return value.replaceAll("_", " ");
}

function statusTone(status: string) {
  if (status === "adopted" || status === "complete")
    return "border-emerald-400/25 bg-emerald-400/5 text-emerald-200";
  if (status === "draft" || status === "planned" || status === "in_progress")
    return "border-amber-400/25 bg-amber-400/5 text-amber-200";
  return "border-white/10 bg-white/[0.03] text-slate-400";
}

export function WorkforceGovernanceControls({
  onChanged,
}: {
  onChanged?: () => void;
}) {
  const [workspace, setWorkspace] =
    useState<WorkforceGovernanceWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [planSelection, setPlanSelection] = useState("");
  const [planAction, setPlanAction] = useState<
    "start" | "complete" | "cancel" | "supersede"
  >("start");
  const [planBasis, setPlanBasis] = useState("");
  const [planEvidence, setPlanEvidence] = useState("");
  const [replacementTarget, setReplacementTarget] = useState("");
  const [replacementDriver, setReplacementDriver] = useState("");
  const [rule, setRule] = useState({
    ruleKey: "",
    title: "",
    source: "company_standard" as LabourRuleLifecycleRow["source"],
    limitKind: "max_hours_per_shift" as LabourRuleLifecycleRow["limitKind"],
    limitValue: "",
    appliesToCraft: "",
    reference: "",
    basis: "",
    evidenceReference: "",
    effectiveFrom: "",
    effectiveUntil: "",
  });
  const [ruleSelection, setRuleSelection] = useState("");
  const [ruleDecision, setRuleDecision] = useState<"adopt" | "retire">("adopt");
  const [ruleDecisionBasis, setRuleDecisionBasis] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setWorkspace(await getWorkforceGovernanceWorkspace());
    } catch (error) {
      setNotice({
        ok: false,
        text:
          error instanceof Error
            ? error.message
            : "Workforce governance records are unavailable.",
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  const selectedPlan = useMemo(
    () =>
      workspace?.trainingPlans.find(
        (item) => item.planId === Number(planSelection),
      ) ?? null,
    [planSelection, workspace],
  );
  const selectedRule = useMemo(
    () =>
      workspace?.labourRules.find(
        (item) => item.ruleId === Number(ruleSelection),
      ) ?? null,
    [ruleSelection, workspace],
  );
  const openPlans =
    workspace?.trainingPlans.filter((item) =>
      ["planned", "in_progress"].includes(item.status),
    ) ?? [];
  const decidableRules =
    workspace?.labourRules.filter((item) =>
      ruleDecision === "adopt"
        ? item.status === "draft"
        : item.status === "adopted",
    ) ?? [];

  const run = async (
    action: () => Promise<{ note?: string }>,
    fallback: string,
  ) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await action();
      setNotice({ ok: true, text: result.note ?? fallback });
      await load();
      onChanged?.();
    } catch (error) {
      setNotice({
        ok: false,
        text: error instanceof Error ? error.message : `${fallback} failed.`,
      });
    } finally {
      setBusy(false);
    }
  };

  const savePlanTransition = () => {
    if (!selectedPlan) return;
    void run(
      () =>
        transitionTrainingPlan({
          planId: selectedPlan.planId,
          action: planAction,
          basis: planBasis,
          evidenceReference: planEvidence || undefined,
          replacementTargetDate: replacementTarget || undefined,
          replacementDriver: replacementDriver || undefined,
          expectedVersion: selectedPlan.version,
        }),
      "Training lifecycle act recorded.",
    );
  };

  const saveRule = () => {
    void run(
      () =>
        recordLabourRule({
          ...rule,
          appliesToCraft: rule.appliesToCraft || undefined,
          reference: rule.reference || undefined,
          effectiveUntil: rule.effectiveUntil || undefined,
        }),
      "Labour-rule draft recorded.",
    );
  };

  const saveRuleDecision = () => {
    if (!selectedRule) return;
    void run(
      () =>
        decideLabourRule({
          ruleId: selectedRule.ruleId,
          decision: ruleDecision,
          note: ruleDecisionBasis,
        }),
      "Labour-rule decision recorded.",
    );
  };

  return (
    <details className="rounded-xl border border-white/8 bg-[#0D1520]">
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-slate-100 marker:hidden">
        Govern training and labour rules
        <span className="ml-2 text-xs font-normal text-slate-500">
          closed-loop training evidence and independently adopted fatigue limits
        </span>
      </summary>
      <div className="space-y-5 border-t border-white/8 p-4">
        <p className="max-w-4xl text-xs leading-relaxed text-slate-400">
          Training completion records delivery only—it never declares a person
          competent. Fatigue analysis uses only independently adopted labour
          rules inside their effective dates; drafts, expired rules and fixture
          rows do not govern a roster.
        </p>
        {notice && (
          <div
            role="status"
            className={`rounded-lg border px-3 py-2 text-sm ${notice.ok ? "border-emerald-400/25 bg-emerald-400/5 text-emerald-200" : "border-rose-400/25 bg-rose-400/5 text-rose-200"}`}
          >
            {notice.text}
          </div>
        )}
        {loading && (
          <p className="text-xs text-slate-500">
            Loading governed workforce records…
          </p>
        )}

        <section className="rounded-xl border border-white/8 p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <GraduationCap className="h-4 w-4 text-signal-cyan" aria-hidden />
            Training-plan lifecycle
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            Start, complete, cancel or supersede a canonical plan with
            optimistic version control and an append-only audit receipt.
          </p>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            <select
              aria-label="Training plan"
              value={planSelection}
              onChange={(event) => setPlanSelection(event.target.value)}
              className={inputClass}
            >
              <option value="">Choose an open training plan</option>
              {openPlans.map((item) => (
                <option key={item.planId} value={item.planId}>
                  {item.memberName} · {item.competencyTitle} ·{" "}
                  {title(item.status)} · v{item.version}
                </option>
              ))}
            </select>
            <select
              aria-label="Training lifecycle action"
              value={planAction}
              onChange={(event) =>
                setPlanAction(event.target.value as typeof planAction)
              }
              className={inputClass}
            >
              {(["start", "complete", "cancel", "supersede"] as const).map(
                (value) => (
                  <option key={value} value={value}>
                    {title(value)}
                  </option>
                ),
              )}
            </select>
            <textarea
              aria-label="Training lifecycle basis"
              value={planBasis}
              onChange={(event) => setPlanBasis(event.target.value)}
              placeholder="Evidence and reasoning for this lifecycle change (20 characters minimum)"
              className={`${inputClass} min-h-20 lg:col-span-2`}
            />
            {planAction === "complete" && (
              <input
                aria-label="Training completion evidence"
                value={planEvidence}
                onChange={(event) => setPlanEvidence(event.target.value)}
                placeholder="Attendance, assessment or delivery record reference"
                className={`${inputClass} lg:col-span-2`}
              />
            )}
            {planAction === "supersede" && (
              <>
                <input
                  aria-label="Replacement training target"
                  type="date"
                  value={replacementTarget}
                  onChange={(event) => setReplacementTarget(event.target.value)}
                  className={inputClass}
                />
                <input
                  aria-label="Replacement training driver"
                  value={replacementDriver}
                  onChange={(event) => setReplacementDriver(event.target.value)}
                  placeholder="Why the replacement is required"
                  className={inputClass}
                />
              </>
            )}
            <button
              type="button"
              onClick={savePlanTransition}
              disabled={
                busy ||
                !selectedPlan ||
                planBasis.trim().length < 20 ||
                (planAction === "start" && selectedPlan.status !== "planned") ||
                (planAction === "complete" &&
                  (selectedPlan.status !== "in_progress" ||
                    planEvidence.trim().length < 3)) ||
                (planAction === "supersede" &&
                  (!replacementTarget || replacementDriver.trim().length < 10))
              }
              className={`${buttonClass} lg:col-span-2`}
            >
              Record training lifecycle act
            </button>
          </div>
          <ul className="mt-4 space-y-2">
            {(workspace?.trainingPlans ?? [])
              .slice(0, 12)
              .map((item: TrainingPlanLifecycleRow) => (
                <li
                  key={item.planId}
                  className="rounded-lg border border-white/6 px-3 py-2 text-xs text-slate-400"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-200">
                      {item.memberName} · {item.competencyTitle}
                    </span>
                    <span
                      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${statusTone(item.status)}`}
                    >
                      {title(item.status)}
                    </span>
                    <span>v{item.version}</span>
                    <span>target {item.targetDate ?? "not stated"}</span>
                  </div>
                  <p className="mt-1">
                    {item.lifecycleBasis ??
                      item.driver ??
                      "No lifecycle basis recorded."}
                  </p>
                </li>
              ))}
          </ul>
        </section>

        <section className="rounded-xl border border-white/8 p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Scale className="h-4 w-4 text-signal-cyan" aria-hidden />
            Labour and fatigue rules
          </h4>
          <p className="mt-1 text-xs text-slate-500">
            {workspace?.effectiveRuleCount ?? 0} adopted rule(s) are currently
            effective. A draft author cannot adopt their own rule.
          </p>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            <input
              aria-label="Labour rule key"
              value={rule.ruleKey}
              onChange={(event) =>
                setRule({ ...rule, ruleKey: event.target.value })
              }
              placeholder="Stable rule key"
              className={inputClass}
            />
            <input
              aria-label="Labour rule title"
              value={rule.title}
              onChange={(event) =>
                setRule({ ...rule, title: event.target.value })
              }
              placeholder="Rule title"
              className={inputClass}
            />
            <select
              aria-label="Labour rule source"
              value={rule.source}
              onChange={(event) =>
                setRule({
                  ...rule,
                  source: event.target
                    .value as LabourRuleLifecycleRow["source"],
                })
              }
              className={inputClass}
            >
              {sources.map((value) => (
                <option key={value} value={value}>
                  {title(value)}
                </option>
              ))}
            </select>
            <select
              aria-label="Labour rule limit kind"
              value={rule.limitKind}
              onChange={(event) =>
                setRule({
                  ...rule,
                  limitKind: event.target
                    .value as LabourRuleLifecycleRow["limitKind"],
                })
              }
              className={inputClass}
            >
              {limitKinds.map((value) => (
                <option key={value} value={value}>
                  {title(value)}
                </option>
              ))}
            </select>
            <input
              aria-label="Labour rule limit value"
              type="number"
              min="0.01"
              step="0.01"
              value={rule.limitValue}
              onChange={(event) =>
                setRule({ ...rule, limitValue: event.target.value })
              }
              placeholder="Limit value"
              className={inputClass}
            />
            <input
              aria-label="Labour rule craft"
              value={rule.appliesToCraft}
              onChange={(event) =>
                setRule({ ...rule, appliesToCraft: event.target.value })
              }
              placeholder="Craft, blank for all"
              className={inputClass}
            />
            <input
              aria-label="Labour rule reference"
              value={rule.reference}
              onChange={(event) =>
                setRule({ ...rule, reference: event.target.value })
              }
              placeholder="Human-readable reference"
              className={inputClass}
            />
            <input
              aria-label="Labour rule evidence reference"
              value={rule.evidenceReference}
              onChange={(event) =>
                setRule({ ...rule, evidenceReference: event.target.value })
              }
              placeholder="Agreement, statute or controlled standard"
              className={inputClass}
            />
            <input
              aria-label="Labour rule effective from"
              type="date"
              value={rule.effectiveFrom}
              onChange={(event) =>
                setRule({ ...rule, effectiveFrom: event.target.value })
              }
              className={inputClass}
            />
            <input
              aria-label="Labour rule effective until"
              type="date"
              min={rule.effectiveFrom || undefined}
              value={rule.effectiveUntil}
              onChange={(event) =>
                setRule({ ...rule, effectiveUntil: event.target.value })
              }
              className={inputClass}
            />
            <textarea
              aria-label="Labour rule basis"
              value={rule.basis}
              onChange={(event) =>
                setRule({ ...rule, basis: event.target.value })
              }
              placeholder="Why this exact limit applies (20 characters minimum)"
              className={`${inputClass} min-h-20 lg:col-span-2`}
            />
            <button
              type="button"
              onClick={saveRule}
              disabled={
                busy ||
                rule.ruleKey.trim().length < 2 ||
                rule.title.trim().length < 5 ||
                !rule.limitValue ||
                !rule.effectiveFrom ||
                rule.evidenceReference.trim().length < 3 ||
                rule.basis.trim().length < 20 ||
                Boolean(
                  rule.effectiveUntil &&
                  rule.effectiveUntil < rule.effectiveFrom,
                )
              }
              className={`${buttonClass} lg:col-span-2`}
            >
              Record labour-rule draft
            </button>
          </div>

          <div className="mt-4 grid gap-2 border-t border-white/8 pt-4 lg:grid-cols-2">
            <select
              aria-label="Labour rule decision"
              value={ruleDecision}
              onChange={(event) => {
                setRuleDecision(event.target.value as typeof ruleDecision);
                setRuleSelection("");
              }}
              className={inputClass}
            >
              <option value="adopt">Adopt draft</option>
              <option value="retire">Retire adopted rule</option>
            </select>
            <select
              aria-label="Labour rule version"
              value={ruleSelection}
              onChange={(event) => setRuleSelection(event.target.value)}
              className={inputClass}
            >
              <option value="">Choose rule version</option>
              {decidableRules.map((item) => (
                <option key={item.ruleId} value={item.ruleId}>
                  {item.ruleKey} v{item.version} · {item.title}
                </option>
              ))}
            </select>
            <textarea
              aria-label="Labour rule decision basis"
              value={ruleDecisionBasis}
              onChange={(event) => setRuleDecisionBasis(event.target.value)}
              placeholder="Independent decision basis (20 characters minimum)"
              className={`${inputClass} min-h-20 lg:col-span-2`}
            />
            <button
              type="button"
              onClick={saveRuleDecision}
              disabled={
                busy || !selectedRule || ruleDecisionBasis.trim().length < 20
              }
              className={`${buttonClass} lg:col-span-2`}
            >
              Record labour-rule decision
            </button>
          </div>

          <ul className="mt-4 space-y-2">
            {(workspace?.labourRules ?? []).slice(0, 16).map((item) => (
              <li
                key={item.ruleId}
                className="rounded-lg border border-white/6 px-3 py-2 text-xs text-slate-400"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <BookCheck
                    className="h-3.5 w-3.5 text-signal-cyan"
                    aria-hidden
                  />
                  <span className="font-medium text-slate-200">
                    {item.title}
                  </span>
                  <span
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${statusTone(item.status)}`}
                  >
                    {item.status}
                  </span>
                  <span>
                    {item.ruleKey} v{item.version}
                  </span>
                </div>
                <p className="mt-1">
                  {title(item.limitKind)} = {item.limitValue} ·{" "}
                  {title(item.source)} · effective{" "}
                  {item.effectiveFrom ?? "not set"}
                  {item.effectiveUntil ? ` to ${item.effectiveUntil}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </details>
  );
}
