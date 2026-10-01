import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Loader2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useAuth } from "./AuthProvider";
import {
  decideOrganizationMfaPolicy,
  getCurrentSecurityPosture,
  getOrganizationMfaPolicy,
  proposeOrganizationMfaPolicy,
  type MfaEnforcementScope,
  type OrganizationMfaPolicyWorkspace,
  type SecurityPosture,
} from "../services/securityPolicyService";

const PRIVILEGED_ROLE_OPTIONS = [
  ["admin", "Administrator"],
  ["ai_admin", "AI administrator"],
  ["executive", "Executive"],
  ["maintenance_manager", "Maintenance manager"],
  ["reliability_engineer", "Reliability engineer"],
] as const;

function defaultEffectiveAt(): string {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setSeconds(0, 0);
  const localOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - localOffset).toISOString().slice(0, 16);
}

function formatDate(value?: string | null): string {
  if (!value) return "Not set";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function OrganizationMfaPolicyPanel() {
  const { profile } = useAuth();
  const role = String(profile?.role ?? "");
  const canManage = role === "admin" || role === "executive";
  const [workspace, setWorkspace] =
    useState<OrganizationMfaPolicyWorkspace | null>(null);
  const [posture, setPosture] = useState<SecurityPosture | null>(null);
  const [scope, setScope] = useState<MfaEnforcementScope>("privileged_roles");
  const [roles, setRoles] = useState<string[]>([
    "admin",
    "ai_admin",
    "executive",
    "maintenance_manager",
  ]);
  const [effectiveAt, setEffectiveAt] = useState(defaultEffectiveAt);
  const [reason, setReason] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    setError(null);
    try {
      const [policy, currentPosture] = await Promise.all([
        getOrganizationMfaPolicy(),
        getCurrentSecurityPosture(),
      ]);
      setWorkspace(policy);
      setPosture(currentPosture);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not load MFA governance.",
      );
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    void load();
  }, [load]);

  const differentReviewer = useMemo(
    () =>
      Boolean(
        workspace?.proposed && workspace.proposed.proposedBy !== profile?.id,
      ),
    [profile?.id, workspace?.proposed],
  );

  if (!canManage) return null;

  const toggleRole = (key: string) => {
    setRoles((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  };

  const propose = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await proposeOrganizationMfaPolicy({
        scope,
        privilegedRoles: scope === "privileged_roles" ? roles : [],
        effectiveAt: new Date(effectiveAt).toISOString(),
        reason,
      });
      setReason("");
      setNotice(
        "Policy proposed. A different AAL2 administrator or executive must decide it.",
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Policy proposal failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: "adopt" | "reject") => {
    if (!workspace?.proposed) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await decideOrganizationMfaPolicy({
        policyId: workspace.proposed.id,
        decision,
        reason: decisionReason,
      });
      setDecisionReason("");
      setNotice(
        decision === "adopt" ? "MFA policy adopted." : "MFA policy rejected.",
      );
      await load();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Policy decision failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="glass max-w-3xl rounded-xl border border-white/6 p-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 text-signal-cyan" aria-hidden />
        <div>
          <h3 className="text-sm font-semibold text-industrial-text">
            Organization MFA policy
          </h3>
          <p className="mt-1 text-sm text-slate-400">
            Enforce verified AAL2 assurance at the canonical tenant boundary.
            One named human proposes; a different assured human adopts.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="mt-5 flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading
          policy…
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-white/8 bg-white/2 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Adopted policy
              </p>
              {workspace?.adopted ? (
                <>
                  <p className="mt-2 font-medium text-green-300">
                    Version {workspace.adopted.version} ·{" "}
                    {workspace.adopted.scope === "all_members"
                      ? "All members"
                      : "Privileged roles"}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Effective {formatDate(workspace.adopted.effectiveAt)}
                  </p>
                  <p className="mt-2 text-xs text-slate-300">
                    Reviewed by{" "}
                    {workspace.adopted.decidedByLabel ?? "a named reviewer"}
                  </p>
                </>
              ) : (
                <p className="mt-2 text-sm text-amber-300">
                  No adopted tenant policy.
                </p>
              )}
            </div>
            <div className="rounded-lg border border-white/8 bg-white/2 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Your assurance
              </p>
              <p className="mt-2 font-medium text-slate-200">
                {posture?.currentAal?.toUpperCase() ?? "Unknown"} ·{" "}
                {posture?.verifiedFactorCount ?? 0} verified factor(s)
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {posture?.satisfied
                  ? "Current policy satisfied"
                  : "Step-up required before governed access"}
              </p>
            </div>
          </div>

          {workspace?.proposed ? (
            <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-4">
              <div className="flex items-center gap-2 text-amber-300">
                <Clock3 size={16} aria-hidden />
                <p className="text-sm font-semibold">
                  Version {workspace.proposed.version} awaiting independent
                  decision
                </p>
              </div>
              <p className="mt-2 text-sm text-slate-300">
                {workspace.proposed.scope === "all_members"
                  ? "All members"
                  : workspace.proposed.privilegedRoles.join(", ")}{" "}
                · effective {formatDate(workspace.proposed.effectiveAt)}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Proposed by{" "}
                {workspace.proposed.proposedByLabel ??
                  workspace.proposed.proposedBy}
                : {workspace.proposed.proposalReason}
              </p>
              <textarea
                value={decisionReason}
                onChange={(event) => setDecisionReason(event.target.value)}
                placeholder="Independent decision basis (minimum 20 characters)"
                className="mt-3 min-h-24 w-full rounded-lg border border-industrial-border bg-industrial-black px-3 py-2 text-sm text-slate-200 focus:border-signal-cyan focus:outline-hidden"
              />
              {!differentReviewer && (
                <p className="mt-2 text-xs text-amber-300">
                  The proposer cannot decide the same policy.
                </p>
              )}
              {differentReviewer && posture?.currentAal !== "aal2" && (
                <p className="mt-2 text-xs text-amber-300">
                  Complete MFA step-up before deciding this policy.
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void decide("adopt")}
                  disabled={
                    busy ||
                    !differentReviewer ||
                    posture?.currentAal !== "aal2" ||
                    decisionReason.trim().length < 20
                  }
                  className="inline-flex items-center gap-2 rounded-lg bg-teal-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"
                >
                  <CheckCircle2 size={15} aria-hidden /> Adopt policy
                </button>
                <button
                  type="button"
                  onClick={() => void decide("reject")}
                  disabled={
                    busy ||
                    !differentReviewer ||
                    posture?.currentAal !== "aal2" ||
                    decisionReason.trim().length < 20
                  }
                  className="rounded-lg border border-red-500/35 px-4 py-2 text-sm font-semibold text-red-300 disabled:opacity-40"
                >
                  Reject
                </button>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-white/8 p-4">
              <div className="flex items-center gap-2">
                <Users size={16} className="text-signal-cyan" aria-hidden />
                <p className="text-sm font-semibold text-industrial-text">
                  Propose a new policy version
                </p>
              </div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm text-slate-300">
                  Enforcement scope
                  <select
                    value={scope}
                    onChange={(event) =>
                      setScope(event.target.value as MfaEnforcementScope)
                    }
                    className="mt-1 w-full rounded-lg border border-industrial-border bg-industrial-black px-3 py-2"
                  >
                    <option value="privileged_roles">Privileged roles</option>
                    <option value="all_members">
                      All organization members
                    </option>
                  </select>
                </label>
                <label className="text-sm text-slate-300">
                  Effective date and time
                  <input
                    type="datetime-local"
                    value={effectiveAt}
                    onChange={(event) => setEffectiveAt(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-industrial-border bg-industrial-black px-3 py-2"
                  />
                </label>
              </div>
              {scope === "privileged_roles" && (
                <fieldset className="mt-4">
                  <legend className="text-sm text-slate-300">
                    Roles requiring MFA
                  </legend>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {PRIVILEGED_ROLE_OPTIONS.map(([key, label]) => (
                      <label
                        key={key}
                        className="inline-flex items-center gap-2 rounded-lg border border-white/8 px-3 py-2 text-xs text-slate-300"
                      >
                        <input
                          type="checkbox"
                          checked={roles.includes(key)}
                          onChange={() => toggleRole(key)}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Policy and rollout basis (minimum 20 characters)"
                className="mt-4 min-h-24 w-full rounded-lg border border-industrial-border bg-industrial-black px-3 py-2 text-sm text-slate-200 focus:border-signal-cyan focus:outline-hidden"
              />
              <button
                type="button"
                onClick={() => void propose()}
                disabled={
                  busy ||
                  reason.trim().length < 20 ||
                  (scope === "privileged_roles" && roles.length === 0)
                }
                className="mt-3 rounded-lg bg-teal-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"
              >
                Propose for independent review
              </button>
            </div>
          )}
        </div>
      )}

      {notice && (
        <p role="status" className="mt-4 text-sm text-green-300">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-red-300">
          {error}
        </p>
      )}
      <p className="mt-5 border-t border-white/8 pt-4 text-xs text-slate-500">
        This control gates tenant access only. Engineering approvals, delegated
        authority, and operational decisions remain separate named-human acts.
      </p>
    </section>
  );
}
