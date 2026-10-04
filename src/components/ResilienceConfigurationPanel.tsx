import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, DatabaseZap, ShieldCheck } from "lucide-react";
import {
  ENTERPRISE_OPERATING_MODES,
  THREAT_KINDS,
  getResilienceConfigurationWorkspace,
  saveOperatingModeDefinition,
  saveThreatScenarioWithExposure,
  type EnterpriseOperatingMode,
  type OperatingModeDefinitionRecord,
  type ResilienceConfigurationWorkspace,
  type ResilienceScenarioRecord,
  type ThreatKind,
} from "../services/resilienceConfigurationService";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600";
const label = (value: string) => value.replaceAll("_", " ");

interface ScenarioDraft {
  scenarioKey: string;
  title: string;
  threatKind: ThreatKind;
  description: string;
  siteId: string;
  annualLikelihood: string;
  planReference: string;
  lastExercisedOn: string;
  exerciseOutcome: string;
  continuityId: string;
  supplierId: string;
  governanceBasis: string;
  evidenceIds: string[];
  exposureEvidenceId: string;
  missingEvidence: string;
  assetIds: string[];
}

const emptyScenario = (): ScenarioDraft => ({
  scenarioKey: "",
  title: "",
  threatKind: "wildfire",
  description: "",
  siteId: "",
  annualLikelihood: "",
  planReference: "",
  lastExercisedOn: "",
  exerciseOutcome: "",
  continuityId: "",
  supplierId: "",
  governanceBasis: "",
  evidenceIds: [],
  exposureEvidenceId: "",
  missingEvidence: "",
  assetIds: [],
});

interface ModeDraft {
  mode: EnterpriseOperatingMode;
  entryCriteria: string;
  exitCriteria: string;
  declaredByRole: string;
  authorityChanges: string;
  governanceBasis: string;
  evidenceIds: string[];
  missingEvidence: string;
}

const emptyMode = (mode: EnterpriseOperatingMode = "normal"): ModeDraft => ({
  mode,
  entryCriteria: "",
  exitCriteria: "",
  declaredByRole: "",
  authorityChanges: "",
  governanceBasis: "",
  evidenceIds: [],
  missingEvidence: "",
});

function scenarioDraft(row: ResilienceScenarioRecord): ScenarioDraft {
  return {
    scenarioKey: row.scenario_key,
    title: row.title,
    threatKind: row.threat_kind,
    description: row.description ?? "",
    siteId: row.site_id ?? "",
    annualLikelihood: row.annual_likelihood?.toString() ?? "",
    planReference: row.plan_reference ?? "",
    lastExercisedOn: row.last_exercised_on ?? "",
    exerciseOutcome: row.exercise_outcome ?? "",
    continuityId: row.linked_continuity_procedure?.toString() ?? "",
    supplierId: row.linked_supplier?.toString() ?? "",
    governanceBasis: row.governance_basis ?? "",
    evidenceIds: row.evidence_item_ids,
    exposureEvidenceId: row.exposure_evidence_item_id ?? "",
    missingEvidence: row.missing_evidence.join("; "),
    assetIds: row.asset_ids,
  };
}

function modeDraft(
  mode: EnterpriseOperatingMode,
  row?: OperatingModeDefinitionRecord,
): ModeDraft {
  if (!row) return emptyMode(mode);
  return {
    mode,
    entryCriteria: row.entry_criteria ?? "",
    exitCriteria: row.exit_criteria ?? "",
    declaredByRole: row.declared_by_role ?? "",
    authorityChanges: row.authority_changes ?? "",
    governanceBasis: row.governance_basis ?? "",
    evidenceIds: row.evidence_item_ids,
    missingEvidence: row.missing_evidence.join("; "),
  };
}

export function ResilienceConfigurationPanel({
  onChanged,
}: {
  onChanged?: () => void;
}) {
  const [workspace, setWorkspace] =
    useState<ResilienceConfigurationWorkspace | null>(null);
  const [scenario, setScenario] = useState<ScenarioDraft>(emptyScenario);
  const [mode, setMode] = useState<ModeDraft>(emptyMode);
  const [busy, setBusy] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const reload = useCallback(async () => {
    const next = await getResilienceConfigurationWorkspace();
    setWorkspace(next);
  }, []);

  useEffect(() => {
    void reload().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : String(reason)),
    );
  }, [reload]);

  useEffect(() => {
    if (!workspace || initialized) return;
    setMode(
      modeDraft(
        "normal",
        workspace.modes.find((item) => item.mode === "normal"),
      ),
    );
    setInitialized(true);
  }, [initialized, workspace]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await reload();
      onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  const missing = (value: string) =>
    value
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean);

  return (
    <details className="rounded-xl border border-cyan-500/20 bg-cyan-500/3">
      <summary className="cursor-pointer list-none p-4 text-sm font-semibold text-slate-100">
        <span className="flex items-center gap-2">
          <DatabaseZap className="h-4 w-4 text-signal-cyan" aria-hidden />
          Configure scenarios and operating-mode policy
        </span>
      </summary>
      <div className="space-y-5 border-t border-white/6 p-4">
        <div className="flex gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-100">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>
            {workspace?.authority_boundary ??
              "Configuration does not declare an emergency or change field authority."}
          </p>
        </div>
        {error && (
          <div role="alert" className="flex gap-2 text-sm text-rose-300">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
            {error}
          </div>
        )}
        {notice && (
          <p role="status" className="text-sm text-signal-cyan">
            {notice}
          </p>
        )}

        <div className="grid gap-5 xl:grid-cols-2">
          <form
            className="space-y-3 rounded-lg border border-white/6 bg-black/10 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const saved = await saveThreatScenarioWithExposure(
                  {
                    scenario_key: scenario.scenarioKey,
                    title: scenario.title,
                    threat_kind: scenario.threatKind,
                    description: scenario.description,
                    site_id: scenario.siteId || null,
                    annual_likelihood: scenario.annualLikelihood || null,
                    plan_reference: scenario.planReference || null,
                    last_exercised_on: scenario.lastExercisedOn || null,
                    exercise_outcome: scenario.exerciseOutcome || null,
                    linked_continuity_procedure: scenario.continuityId || null,
                    linked_supplier: scenario.supplierId || null,
                    governance_basis: scenario.governanceBasis,
                    evidence_item_ids: scenario.evidenceIds,
                    missing_evidence: missing(scenario.missingEvidence),
                  },
                  scenario.assetIds,
                  scenario.governanceBasis,
                  scenario.exposureEvidenceId || undefined,
                );
                setNotice(
                  saved.mapping_status === "not_mapped"
                    ? "Scenario saved; no directly exposed asset is mapped, so impact cannot yet be computed."
                    : saved.mapping_status === "evidence_verified"
                      ? `Scenario saved with ${saved.mapped_assets} evidence-verified exposed asset(s).`
                      : `Scenario saved with ${saved.mapped_assets} provisional exposed asset(s); close the recorded evidence gap before treating the mapping as verified.`,
                );
              });
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-medium text-white">Threat scenario</h3>
              <button
                type="button"
                className="text-xs text-signal-cyan"
                onClick={() => setScenario(emptyScenario())}
              >
                New scenario
              </button>
            </div>
            {(workspace?.scenarios.length ?? 0) > 0 && (
              <select
                aria-label="Edit existing scenario"
                className={inputClass}
                value={
                  workspace?.scenarios.some(
                    (item) => item.scenario_key === scenario.scenarioKey,
                  )
                    ? scenario.scenarioKey
                    : ""
                }
                onChange={(event) => {
                  const row = workspace?.scenarios.find(
                    (item) => item.scenario_key === event.target.value,
                  );
                  if (row) setScenario(scenarioDraft(row));
                }}
              >
                <option value="">Create new or select existing…</option>
                {workspace?.scenarios.map((item) => (
                  <option key={item.id} value={item.scenario_key}>
                    {item.scenario_key} · {item.title}
                  </option>
                ))}
              </select>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                required
                className={inputClass}
                placeholder="Scenario key"
                value={scenario.scenarioKey}
                onChange={(event) =>
                  setScenario({ ...scenario, scenarioKey: event.target.value })
                }
              />
              <select
                className={inputClass}
                value={scenario.threatKind}
                onChange={(event) =>
                  setScenario({
                    ...scenario,
                    threatKind: event.target.value as ThreatKind,
                  })
                }
              >
                {THREAT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {label(kind)}
                  </option>
                ))}
              </select>
            </div>
            <input
              required
              className={inputClass}
              placeholder="Scenario title"
              value={scenario.title}
              onChange={(event) =>
                setScenario({ ...scenario, title: event.target.value })
              }
            />
            <textarea
              required
              className={inputClass}
              placeholder="Observed threat mechanism and bounded scope"
              value={scenario.description}
              onChange={(event) =>
                setScenario({ ...scenario, description: event.target.value })
              }
            />
            <label className="block text-xs text-slate-400">
              Exposure-mapping evidence
              <select
                aria-label="Exposure-mapping evidence"
                className={`${inputClass} mt-1`}
                value={scenario.exposureEvidenceId}
                onChange={(event) =>
                  setScenario({
                    ...scenario,
                    exposureEvidenceId: event.target.value,
                  })
                }
              >
                <option value="">No verified source — keep provisional</option>
                {workspace?.evidence.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.description} · verified
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                className={inputClass}
                value={scenario.siteId}
                onChange={(event) =>
                  setScenario({ ...scenario, siteId: event.target.value })
                }
              >
                <option value="">Enterprise-wide / no site</option>
                {workspace?.sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
              <input
                className={inputClass}
                type="number"
                min="0.000001"
                max="1"
                step="any"
                placeholder="Annual likelihood (optional)"
                value={scenario.annualLikelihood}
                onChange={(event) =>
                  setScenario({
                    ...scenario,
                    annualLikelihood: event.target.value,
                  })
                }
              />
            </div>
            <label className="block text-xs text-slate-400">
              Directly exposed canonical assets
              <select
                multiple
                aria-label="Directly exposed canonical assets"
                className={`${inputClass} mt-1 min-h-28`}
                value={scenario.assetIds}
                onChange={(event) =>
                  setScenario({
                    ...scenario,
                    assetIds: Array.from(
                      event.currentTarget.selectedOptions,
                    ).map((option) => option.value),
                  })
                }
              >
                {workspace?.assets.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                className={inputClass}
                placeholder="Plan reference (optional)"
                value={scenario.planReference}
                onChange={(event) =>
                  setScenario({
                    ...scenario,
                    planReference: event.target.value,
                  })
                }
              />
              <input
                className={inputClass}
                type="date"
                aria-label="Last exercised on"
                required={Boolean(scenario.exerciseOutcome)}
                value={scenario.lastExercisedOn}
                onChange={(event) =>
                  setScenario({
                    ...scenario,
                    lastExercisedOn: event.target.value,
                  })
                }
              />
            </div>
            <select
              className={inputClass}
              required={Boolean(scenario.lastExercisedOn)}
              value={scenario.exerciseOutcome}
              onChange={(event) =>
                setScenario({
                  ...scenario,
                  exerciseOutcome: event.target.value,
                })
              }
            >
              <option value="">Exercise not recorded</option>
              {["successful", "partial", "failed", "cancelled"].map(
                (outcome) => (
                  <option key={outcome} value={outcome}>
                    {outcome}
                  </option>
                ),
              )}
            </select>
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                className={inputClass}
                value={scenario.continuityId}
                onChange={(event) =>
                  setScenario({
                    ...scenario,
                    continuityId: event.target.value,
                  })
                }
              >
                <option value="">No linked continuity procedure</option>
                {workspace?.continuity_procedures.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
              <select
                className={inputClass}
                value={scenario.supplierId}
                onChange={(event) =>
                  setScenario({ ...scenario, supplierId: event.target.value })
                }
              >
                <option value="">No linked supplier</option>
                {workspace?.suppliers.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              required
              className={inputClass}
              placeholder="Governance and exposure-mapping basis"
              value={scenario.governanceBasis}
              onChange={(event) =>
                setScenario({
                  ...scenario,
                  governanceBasis: event.target.value,
                })
              }
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                multiple
                aria-label="Canonical scenario evidence"
                className={inputClass}
                value={scenario.evidenceIds}
                onChange={(event) =>
                  setScenario({
                    ...scenario,
                    evidenceIds: Array.from(
                      event.currentTarget.selectedOptions,
                    ).map((option) => option.value),
                  })
                }
              >
                {workspace?.evidence.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.description} · verified
                  </option>
                ))}
              </select>
              <input
                className={inputClass}
                placeholder="Missing evidence; separate with semicolons"
                value={scenario.missingEvidence}
                onChange={(event) =>
                  setScenario({
                    ...scenario,
                    missingEvidence: event.target.value,
                  })
                }
              />
            </div>
            <p className="text-xs text-slate-500">
              Only named-human-verified evidence is selectable. Without it,
              exposure remains explicitly provisional and requires a recorded
              evidence gap. Quantitative likelihood cannot be saved without
              verified evidence.
            </p>
            <button
              disabled={busy}
              className="rounded-lg bg-signal-cyan px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
            >
              Save scenario and exposure
            </button>
          </form>

          <form
            className="space-y-3 rounded-lg border border-white/6 bg-black/10 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await saveOperatingModeDefinition({
                  mode: mode.mode,
                  entry_criteria: mode.entryCriteria,
                  exit_criteria: mode.exitCriteria,
                  declared_by_role: mode.declaredByRole,
                  authority_changes: mode.authorityChanges,
                  governance_basis: mode.governanceBasis,
                  evidence_item_ids: mode.evidenceIds,
                  missing_evidence: missing(mode.missingEvidence),
                });
                setNotice(`${label(mode.mode)} policy definition saved.`);
              });
            }}
          >
            <h3 className="font-medium text-white">Operating-mode policy</h3>
            <select
              className={inputClass}
              value={mode.mode}
              onChange={(event) => {
                const key = event.target.value as EnterpriseOperatingMode;
                setMode(
                  modeDraft(
                    key,
                    workspace?.modes.find((item) => item.mode === key),
                  ),
                );
              }}
            >
              {ENTERPRISE_OPERATING_MODES.map((key) => (
                <option key={key} value={key}>
                  {label(key)}
                </option>
              ))}
            </select>
            <textarea
              required
              className={inputClass}
              placeholder="Observable entry criteria"
              value={mode.entryCriteria}
              onChange={(event) =>
                setMode({ ...mode, entryCriteria: event.target.value })
              }
            />
            <textarea
              required
              className={inputClass}
              placeholder="Observable exit criteria"
              value={mode.exitCriteria}
              onChange={(event) =>
                setMode({ ...mode, exitCriteria: event.target.value })
              }
            />
            <input
              required
              className={inputClass}
              placeholder="Role authorized to declare this mode"
              value={mode.declaredByRole}
              onChange={(event) =>
                setMode({ ...mode, declaredByRole: event.target.value })
              }
            />
            <textarea
              required
              className={inputClass}
              placeholder="Which decision authorities change"
              value={mode.authorityChanges}
              onChange={(event) =>
                setMode({ ...mode, authorityChanges: event.target.value })
              }
            />
            <textarea
              required
              className={inputClass}
              placeholder="Policy source and governance basis"
              value={mode.governanceBasis}
              onChange={(event) =>
                setMode({ ...mode, governanceBasis: event.target.value })
              }
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <select
                multiple
                aria-label="Canonical mode-policy evidence"
                className={inputClass}
                value={mode.evidenceIds}
                onChange={(event) =>
                  setMode({
                    ...mode,
                    evidenceIds: Array.from(
                      event.currentTarget.selectedOptions,
                    ).map((option) => option.value),
                  })
                }
              >
                {workspace?.evidence.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.description} · verified
                  </option>
                ))}
              </select>
              <input
                className={inputClass}
                placeholder="Missing evidence; separate with semicolons"
                value={mode.missingEvidence}
                onChange={(event) =>
                  setMode({ ...mode, missingEvidence: event.target.value })
                }
              />
            </div>
            <button
              disabled={busy}
              className="rounded-lg bg-signal-cyan px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
            >
              Save policy definition
            </button>
            <p className="text-xs text-slate-500">
              This does not change operating state. Use the Recovery command
              workspace for an independently authorized transition.
            </p>
          </form>
        </div>
      </div>
    </details>
  );
}
