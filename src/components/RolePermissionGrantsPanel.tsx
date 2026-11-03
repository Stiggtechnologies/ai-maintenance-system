import { FormEvent, useEffect, useMemo, useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthProvider";
import {
  decideRolePermissionGrant,
  getRolePermissionGrants,
  proposeRolePermissionGrant,
  type PermissionEffect,
  type RolePermissionCell,
  type RolePermissionWorkspace,
} from "../services/rolePermissionService";

function permissionLabel(key: string): string {
  switch (key) {
    case "security.audit.read":
      return "Read security audit";
    case "security.permissions.read":
      return "Read permission matrix";
    case "security.permissions.propose":
      return "Propose permission change";
    case "security.permissions.adopt":
      return "Adopt permission change";
    default:
      return key;
  }
}

function roleLabel(key: string): string {
  return key.replaceAll("_", " ");
}

export function RolePermissionGrantsPanel() {
  const { profile } = useAuth();
  const [workspace, setWorkspace] = useState<RolePermissionWorkspace | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [basis, setBasis] = useState("");
  const [decisionBasis, setDecisionBasis] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getRolePermissionGrants()
      .then((next) => {
        if (!cancelled) {
          setWorkspace(next);
          setError(null);
        }
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setWorkspace(null);
          setError(
            caught instanceof Error
              ? caught.message
              : "Role permissions could not be loaded.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = () => {
    setLoading(true);
    getRolePermissionGrants()
      .then((next) => {
        setWorkspace(next);
        setError(null);
      })
      .catch((caught: unknown) => {
        setError(
          caught instanceof Error
            ? caught.message
            : "Role permissions could not be loaded.",
        );
      })
      .finally(() => setLoading(false));
  };

  const actionable = useMemo(
    () =>
      (workspace?.matrix ?? []).filter(
        (cell) =>
          !cell.proposalId &&
          ((cell.effective && cell.ceiling) ||
            cell.adoptedEffect === "revoked"),
      ),
    [workspace?.matrix],
  );

  const selectedCell = actionable.find(
    (cell) => `${cell.roleKey}:${cell.permissionKey}` === selected,
  );
  const effect: PermissionEffect | null = selectedCell
    ? selectedCell.adoptedEffect === "revoked"
      ? "restored"
      : "revoked"
    : null;

  const proposals = (workspace?.matrix ?? []).filter(
    (cell): cell is RolePermissionCell & { proposalId: string } =>
      Boolean(cell.proposalId),
  );

  const propose = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedCell || !effect) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await proposeRolePermissionGrant({
        roleKey: selectedCell.roleKey,
        permissionKey: selectedCell.permissionKey,
        effect,
        basis,
      });
      setBasis("");
      setSelected("");
      setNotice(
        "Proposal recorded. A different administrator must adopt it before it takes effect.",
      );
      reload();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Proposal was refused.",
      );
    } finally {
      setBusy(false);
    }
  };

  const decide = async (grantId: string, decision: "adopt" | "reject") => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await decideRolePermissionGrant({
        grantId,
        decision,
        basis: decisionBasis,
      });
      setDecisionBasis("");
      setNotice(
        decision === "adopt"
          ? "Permission change adopted."
          : "Permission change rejected.",
      );
      reload();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Decision was refused.",
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
            Least-privilege permissions
          </h3>
          <p className="mt-1 text-sm text-slate-400">
            {workspace?.boundary ||
              "Role permissions are decided on the server. This screen cannot widen a role or authorize plant action."}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="mt-5 flex items-center gap-2 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading role permissions…
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-4 text-sm text-teal-200" role="status">
          {notice}
        </p>
      ) : null}

      {workspace ? (
        <div className="mt-5 space-y-5">
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Your role: {roleLabel(workspace.role || "unknown")}
            </h4>
            <ul className="mt-2 space-y-1 text-sm text-slate-300">
              {workspace.ownPermissions.map((permission) => (
                <li key={permission.permissionKey}>
                  {permissionLabel(permission.permissionKey)}:{" "}
                  {permission.effective ? "allowed" : "denied"}
                </li>
              ))}
            </ul>
          </div>

          {workspace.canReadMatrix && workspace.matrix ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <caption className="mb-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Effective permissions
                </caption>
                <thead>
                  <tr className="text-xs text-slate-400">
                    <th className="py-1 pr-3 font-medium" scope="col">
                      Role
                    </th>
                    <th className="py-1 pr-3 font-medium" scope="col">
                      Permission
                    </th>
                    <th className="py-1 font-medium" scope="col">
                      Effective
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.matrix
                    .filter((cell) => cell.ceiling || cell.adoptedEffect)
                    .map((cell) => (
                      <tr
                        key={`${cell.roleKey}:${cell.permissionKey}`}
                        className="border-t border-white/5"
                      >
                        <th className="py-1.5 pr-3 font-normal" scope="row">
                          {roleLabel(cell.roleKey)}
                        </th>
                        <td className="py-1.5 pr-3">
                          {permissionLabel(cell.permissionKey)}
                        </td>
                        <td className="py-1.5">
                          {cell.effective ? "allowed" : "denied"}
                          {cell.proposalId ? " · proposal open" : ""}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-400">
              The permission matrix is withheld from this role. Changing a grant
              is also denied.
            </p>
          )}

          {workspace.canPropose ? (
            <form className="space-y-3" onSubmit={propose}>
              <div>
                <label
                  className="block text-xs font-medium text-slate-400"
                  htmlFor="role-permission-target"
                >
                  Permission to narrow or restore
                </label>
                <select
                  id="role-permission-target"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  value={selected}
                  onChange={(event) => setSelected(event.target.value)}
                >
                  <option value="">Select a ceiling permission</option>
                  {actionable.map((cell) => (
                    <option
                      key={`${cell.roleKey}:${cell.permissionKey}`}
                      value={`${cell.roleKey}:${cell.permissionKey}`}
                    >
                      {cell.adoptedEffect === "revoked" ? "Restore" : "Revoke"}{" "}
                      {permissionLabel(cell.permissionKey)} for{" "}
                      {roleLabel(cell.roleKey)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  className="block text-xs font-medium text-slate-400"
                  htmlFor="role-permission-basis"
                >
                  Basis
                </label>
                <textarea
                  id="role-permission-basis"
                  className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                  minLength={20}
                  required
                  rows={3}
                  value={basis}
                  onChange={(event) => setBasis(event.target.value)}
                />
              </div>
              <button
                className="rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={busy || !selectedCell || basis.trim().length < 20}
                type="submit"
              >
                Propose permission change
              </button>
            </form>
          ) : (
            <p className="text-sm text-slate-400">
              This role cannot propose permission changes.
            </p>
          )}

          {workspace.canAdopt && proposals.length > 0 ? (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Open proposals
              </h4>
              <label
                className="block text-xs font-medium text-slate-400"
                htmlFor="role-permission-decision-basis"
              >
                Decision basis
              </label>
              <textarea
                id="role-permission-decision-basis"
                className="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                minLength={20}
                rows={2}
                value={decisionBasis}
                onChange={(event) => setDecisionBasis(event.target.value)}
              />
              <ul className="space-y-2">
                {proposals.map((cell) => {
                  const ownProposal = cell.proposedBy === profile?.id;
                  return (
                    <li
                      key={cell.proposalId}
                      className="rounded-lg border border-white/10 p-3 text-sm text-slate-300"
                    >
                      <p>
                        {cell.proposalEffect === "restored"
                          ? "Restore"
                          : "Revoke"}{" "}
                        {permissionLabel(cell.permissionKey)} for{" "}
                        {roleLabel(cell.roleKey)}
                      </p>
                      {ownProposal ? (
                        <p className="mt-2 text-slate-400">
                          Waiting for a different administrator.
                        </p>
                      ) : (
                        <div className="mt-2 flex gap-2">
                          <button
                            className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                            disabled={busy || decisionBasis.trim().length < 20}
                            type="button"
                            onClick={() => decide(cell.proposalId, "adopt")}
                          >
                            Adopt
                          </button>
                          <button
                            className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-slate-200 disabled:opacity-50"
                            disabled={busy || decisionBasis.trim().length < 20}
                            type="button"
                            onClick={() => decide(cell.proposalId, "reject")}
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
