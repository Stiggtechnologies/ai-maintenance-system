import { useEffect, useState } from "react";
import { CircleAlert, CircleCheck, Save, Shield } from "lucide-react";
import {
  configureAgentControls,
  getAgentControlOptions,
  getAgentControlState,
  type AgentControlOptions,
  type AgentControlState,
} from "../services/agentGovernanceService";

const EMPTY_OPTIONS: AgentControlOptions = { decisionRights: [], tools: [] };

export function AgentControlPanel({ agentId }: { agentId: string }) {
  const [state, setState] = useState<AgentControlState | null>(null);
  const [options, setOptions] = useState(EMPTY_OPTIONS);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [approverRole, setApproverRole] = useState("reliability_engineer");
  const [riskCeiling, setRiskCeiling] = useState<
    "Low" | "Medium" | "High" | "Critical"
  >("Low");
  const [costCeiling, setCostCeiling] = useState("0");
  const [downtimeCeiling, setDowntimeCeiling] = useState("0");
  const [basis, setBasis] = useState("");
  const [rights, setRights] = useState<string[]>([]);
  const [tools, setTools] = useState<string[]>([]);

  async function load() {
    try {
      const [controlState, controlOptions] = await Promise.all([
        getAgentControlState(agentId),
        getAgentControlOptions(),
      ]);
      setState(controlState);
      setOptions(controlOptions);
      if (controlState.profile) {
        setApproverRole(controlState.profile.required_human_approver_role);
        setRiskCeiling(controlState.profile.proposal_risk_ceiling);
        setCostCeiling(String(controlState.profile.proposal_cost_ceiling_usd));
        setDowntimeCeiling(
          String(controlState.profile.proposal_downtime_ceiling_hours),
        );
        setBasis(controlState.profile.basis);
        setRights(controlState.decisionRights);
        setTools(controlState.tools);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load controls");
    }
  }

  useEffect(() => {
    void load();
    // The panel is remounted per expanded agent; load only for that identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  function toggle(value: string, values: string[], update: (next: string[]) => void) {
    update(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await configureAgentControls({
        agentId,
        approverRole,
        riskCeiling,
        costCeilingUsd: Number(costCeiling),
        downtimeCeilingHours: Number(downtimeCeiling),
        decisionRightKeys: rights,
        toolKeys: tools,
        basis,
      });
      await load();
      setEditing(false);
      setMessage("Agent controls adopted and recorded in the security audit trail.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save controls");
    } finally {
      setBusy(false);
    }
  }

  if (!state) return <p className="text-xs text-slate-500">Loading agent controls…</p>;

  return (
    <div className="rounded-lg border border-teal-500/20 bg-teal-500/5 p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-semibold text-teal-300">
            <Shield className="h-3.5 w-3.5" /> Individual control envelope
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Human approval remains mandatory. This envelope limits what this agent may
            propose and which software tools it may use; it grants no approval authority.
          </p>
        </div>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setEditing((value) => !value);
          }}
          className="shrink-0 rounded-md border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/5"
        >
          {editing ? "Cancel" : "Configure"}
        </button>
      </div>

      {state.profile && !editing && (
        <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
          <span>Human route: <b className="text-slate-200">{state.profile.required_human_approver_role}</b></span>
          <span>Risk ceiling: <b className="text-slate-200">{state.profile.proposal_risk_ceiling}</b></span>
          <span>Tools: <b className="text-slate-200">{state.tools.length}</b></span>
          <span>Decision rights: <b className="text-slate-200">{state.decisionRights.length}</b></span>
          <span>Proposal cost ceiling: <b className="text-slate-200">${state.profile.proposal_cost_ceiling_usd.toLocaleString()}</b></span>
          <span>Downtime ceiling: <b className="text-slate-200">{state.profile.proposal_downtime_ceiling_hours} h</b></span>
        </div>
      )}

      {!state.profile && !editing && (
        <div className="flex items-center gap-1.5 text-xs text-amber-300">
          <CircleAlert className="h-3.5 w-3.5" /> No adopted profile: agent outputs fail closed.
        </div>
      )}

      {editing && (
        <div className="space-y-3" onClick={(event) => event.stopPropagation()}>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-400">Human approver role
              <input value={approverRole} onChange={(e) => setApproverRole(e.target.value)} className="mt-1 w-full rounded border border-white/10 bg-black/20 px-2 py-1.5 text-slate-200" />
            </label>
            <label className="text-xs text-slate-400">Proposal risk ceiling
              <select value={riskCeiling} onChange={(e) => setRiskCeiling(e.target.value as typeof riskCeiling)} className="mt-1 w-full rounded border border-white/10 bg-[#0D1520] px-2 py-1.5 text-slate-200">
                {(["Low", "Medium", "High", "Critical"] as const).map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-400">Proposal cost ceiling (USD)
              <input type="number" min="0" value={costCeiling} onChange={(e) => setCostCeiling(e.target.value)} className="mt-1 w-full rounded border border-white/10 bg-black/20 px-2 py-1.5 text-slate-200" />
            </label>
            <label className="text-xs text-slate-400">Downtime ceiling (hours)
              <input type="number" min="0" value={downtimeCeiling} onChange={(e) => setDowntimeCeiling(e.target.value)} className="mt-1 w-full rounded border border-white/10 bg-black/20 px-2 py-1.5 text-slate-200" />
            </label>
          </div>
          <fieldset>
            <legend className="text-xs font-medium text-slate-300">Allowed decision rights</legend>
            <div className="mt-1 grid max-h-32 grid-cols-2 gap-1 overflow-y-auto">
              {options.decisionRights.map((right) => (
                <label key={right.right_key} className="flex gap-1.5 text-xs text-slate-400">
                  <input type="checkbox" checked={rights.includes(right.right_key)} onChange={() => toggle(right.right_key, rights, setRights)} />
                  {right.title} ({right.tier})
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="text-xs font-medium text-slate-300">Allowed software tools</legend>
            <div className="mt-1 grid grid-cols-2 gap-1">
              {options.tools.map((tool) => (
                <label key={tool.tool_key} className="flex gap-1.5 text-xs text-slate-400">
                  <input type="checkbox" checked={tools.includes(tool.tool_key)} onChange={() => toggle(tool.tool_key, tools, setTools)} />
                  {tool.title} ({tool.access_kind})
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block text-xs text-slate-400">Control basis
            <textarea value={basis} onChange={(e) => setBasis(e.target.value)} rows={2} placeholder="Why these boundaries are appropriate for this agent" className="mt-1 w-full rounded border border-white/10 bg-black/20 px-2 py-1.5 text-slate-200" />
          </label>
          <button type="button" disabled={busy || rights.length===0 || tools.length===0 || basis.trim().length<20} onClick={() => void save()} className="flex items-center gap-1.5 rounded bg-teal-500/15 px-3 py-1.5 text-xs font-medium text-teal-300 disabled:opacity-40">
            <Save className="h-3.5 w-3.5" /> {busy ? "Adopting…" : "Adopt controls"}
          </button>
        </div>
      )}

      {message && (
        <div className="flex items-start gap-1.5 text-xs text-slate-300">
          {message.startsWith("Agent controls adopted") ? <CircleCheck className="mt-0.5 h-3.5 w-3.5 text-teal-400" /> : <CircleAlert className="mt-0.5 h-3.5 w-3.5 text-amber-300" />}
          {message}
        </div>
      )}
    </div>
  );
}
