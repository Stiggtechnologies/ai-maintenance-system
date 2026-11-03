import { useState } from "react";
import { Network } from "lucide-react";
import { useAsyncData } from "../hooks/useAsyncData";
import { useAuth } from "./AuthProvider";
import {
  decideConnectorZoneAssignment,
  decideNetworkZone,
  getNetworkSeparation,
  proposeConnectorZoneAssignment,
  proposeNetworkZone,
  type NetworkSeparationWorkspace,
} from "../services/networkSeparationService";

const inputClass =
  "w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-signal-cyan/50 focus:outline-none";

const PURDUE = [
  { level: 0, label: "0 Process" },
  { level: 1, label: "1 Basic control" },
  { level: 2, label: "2 Supervisory control" },
  { level: 3, label: "3 Industrial DMZ" },
  { level: 4, label: "4 Site business" },
  { level: 5, label: "5 Enterprise" },
] as const;

function zoneCrossingLabel(reason: string, allowed: boolean): string {
  if (allowed && reason === "adopted_zone_read")
    return "Read allowed by the adopted zone";
  if (allowed && reason === "adopted_egress")
    return "Write allowed by the adopted egress route";
  if (reason === "control_zone_write_refused") {
    return "Writes into a declared Purdue 0-2 zone are refused";
  }
  if (reason === "no_adopted_zone_assignment")
    return "No adopted zone assignment";
  if (reason === "egress_not_permitted") return "Egress is not permitted";
  if (reason === "egress_route_required") return "Egress has no route";
  if (reason === "zone_level_not_declared")
    return "Purdue level is not declared";
  return allowed ? "Allowed" : "Refused";
}

export function NetworkSeparationPanel() {
  const { profile } = useAuth();
  const role = String(profile?.role ?? "");
  const canView = ["admin", "executive", "reliability_engineer"].includes(role);
  const canGovern = ["admin", "executive"].includes(role);
  const register = useAsyncData(
    () =>
      canView
        ? getNetworkSeparation()
        : Promise.resolve(null as NetworkSeparationWorkspace | null),
    [canView],
  );
  const [zoneForm, setZoneForm] = useState({
    zoneKey: "",
    label: "",
    purdueLevel: 4,
    egressPermitted: false,
    egressRoute: "",
    basis: "",
  });
  const [assignmentForm, setAssignmentForm] = useState({
    connectorKey: "",
    zoneId: "",
    basis: "",
  });
  const [reviews, setReviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!canView) return null;
  if (register.loading) {
    return (
      <div className="rounded-xl border border-white/6 p-4 text-xs text-slate-400">
        Loading OT/IT network separation…
      </div>
    );
  }
  if (register.error) {
    return (
      <div className="rounded-xl border border-rose-500/20 p-4 text-xs text-rose-200">
        OT/IT network separation is unavailable: {register.error}
      </div>
    );
  }

  const data = register.data;
  const zones = data?.zones ?? [];
  const assignments = data?.assignments ?? [];
  const connectors = data?.connectors ?? [];
  const adoptedZones = zones.filter(
    (zone) => zone.status === "adopted" && !zone.supersededByZoneId,
  );
  const pendingZones = zones.filter((zone) => zone.status === "proposed");
  const pendingAssignments = assignments.filter(
    (row) => row.status === "proposed",
  );
  const currentZone = adoptedZones.find(
    (zone) => zone.zoneKey === zoneForm.zoneKey.trim().toLowerCase(),
  );
  const currentAssignment = assignments.find(
    (row) =>
      row.status === "adopted" &&
      !row.supersededByAssignmentId &&
      row.connectorKey === assignmentForm.connectorKey,
  );

  const act = async (operation: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await operation();
      setNotice(message);
      await register.refetch();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="network-separation-heading"
      className="rounded-xl border border-signal-cyan/20 bg-signal-cyan/[0.025] p-4"
    >
      <div className="flex items-start gap-2">
        <Network className="mt-0.5 h-4 w-4 text-signal-cyan" aria-hidden />
        <div>
          <h2
            id="network-separation-heading"
            className="text-sm font-semibold text-white"
          >
            OT/IT network separation
          </h2>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-slate-400">
            {data?.boundary}
          </p>
          {data?.unzoned && (
            <p className="mt-2 text-xs text-amber-200">
              No zone is adopted. Connector reads are unzoned, which is not
              separation.
            </p>
          )}
        </div>
      </div>

      {notice && (
        <p className="mt-3 text-xs text-emerald-200" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="mt-3 text-xs text-rose-200" role="alert">
          {error}
        </p>
      )}

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {connectors.map((connector) => (
          <article
            key={connector.connectorKey}
            className="rounded-lg border border-white/10 p-3 text-xs"
          >
            <p className="font-mono text-slate-100">{connector.connectorKey}</p>
            <p className="mt-1 text-slate-400">
              {connector.name}
              {connector.connectorType ? ` · ${connector.connectorType}` : ""}
            </p>
            <p className="mt-2 text-slate-300">
              Read:{" "}
              {zoneCrossingLabel(connector.read.reason, connector.read.allowed)}
            </p>
            <p className="text-slate-300">
              Write:{" "}
              {zoneCrossingLabel(
                connector.write.reason,
                connector.write.allowed,
              )}
            </p>
          </article>
        ))}
      </div>

      {canGovern && (
        <form
          className="mt-4 grid gap-2 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void act(
              () =>
                proposeNetworkZone({
                  zoneKey: zoneForm.zoneKey,
                  label: zoneForm.label,
                  purdueLevel: zoneForm.purdueLevel,
                  egressPermitted: zoneForm.egressPermitted,
                  egressRoute: zoneForm.egressRoute,
                  basis: zoneForm.basis,
                  supersedesZoneId: currentZone?.id ?? null,
                }),
              "Zone proposal recorded. A different verified person must adopt it. This grants no plant-control authority.",
            );
          }}
        >
          <label className="text-xs text-slate-300">
            Zone key
            <input
              className={`${inputClass} mt-1`}
              value={zoneForm.zoneKey}
              onChange={(event) =>
                setZoneForm((current) => ({
                  ...current,
                  zoneKey: event.target.value,
                }))
              }
              required
            />
          </label>
          <label className="text-xs text-slate-300">
            Label
            <input
              className={`${inputClass} mt-1`}
              value={zoneForm.label}
              onChange={(event) =>
                setZoneForm((current) => ({
                  ...current,
                  label: event.target.value,
                }))
              }
              required
            />
          </label>
          <label className="text-xs text-slate-300">
            Purdue level
            <select
              className={`${inputClass} mt-1`}
              value={zoneForm.purdueLevel}
              onChange={(event) =>
                setZoneForm((current) => ({
                  ...current,
                  purdueLevel: Number(event.target.value),
                }))
              }
            >
              {PURDUE.map((option) => (
                <option key={option.level} value={option.level}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 self-end text-xs text-slate-300">
            <input
              type="checkbox"
              checked={zoneForm.egressPermitted}
              onChange={(event) =>
                setZoneForm((current) => ({
                  ...current,
                  egressPermitted: event.target.checked,
                }))
              }
            />
            Permit egress
          </label>
          <label className="text-xs text-slate-300 md:col-span-2">
            Egress route
            <input
              className={`${inputClass} mt-1`}
              value={zoneForm.egressRoute}
              onChange={(event) =>
                setZoneForm((current) => ({
                  ...current,
                  egressRoute: event.target.value,
                }))
              }
              disabled={!zoneForm.egressPermitted}
            />
          </label>
          <label className="text-xs text-slate-300 md:col-span-2">
            Basis
            <textarea
              className={`${inputClass} mt-1 min-h-20`}
              value={zoneForm.basis}
              onChange={(event) =>
                setZoneForm((current) => ({
                  ...current,
                  basis: event.target.value,
                }))
              }
              required
            />
          </label>
          <button
            type="submit"
            disabled={busy || zoneForm.basis.trim().length < 30}
            className="rounded-lg bg-signal-cyan/20 px-3 py-2 text-xs font-semibold text-signal-cyan disabled:opacity-40 md:col-span-2"
          >
            Propose zone
          </button>
        </form>
      )}

      <ul className="mt-4 space-y-2">
        {pendingZones.map((zone) => (
          <li
            key={zone.id}
            className="rounded-lg border border-amber-500/20 p-3 text-xs"
          >
            <p className="text-slate-100">
              {zone.zoneKey} · proposed v{zone.version} · Purdue{" "}
              {zone.purdueLevel}
            </p>
            <p className="mt-1 text-slate-400">
              Proposed by {zone.proposedByLabel ?? "a named person"}. A
              different verified AAL2 person adopts or rejects. No plant-control
              authority.
            </p>
            {canGovern && (
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  aria-label={`Decision basis for ${zone.zoneKey}`}
                  className={`${inputClass} min-w-64 flex-1`}
                  value={reviews[`zone-${zone.id}`] ?? ""}
                  onChange={(event) =>
                    setReviews((current) => ({
                      ...current,
                      [`zone-${zone.id}`]: event.target.value,
                    }))
                  }
                />
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-lg border border-emerald-500/30 px-3 py-2 text-emerald-200"
                  onClick={() =>
                    void act(
                      () =>
                        decideNetworkZone({
                          zoneId: zone.id,
                          decision: "adopt",
                          reason: reviews[`zone-${zone.id}`] ?? "",
                        }),
                      "Zone decision recorded.",
                    )
                  }
                >
                  Adopt zone
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-lg border border-rose-500/30 px-3 py-2 text-rose-200"
                  onClick={() =>
                    void act(
                      () =>
                        decideNetworkZone({
                          zoneId: zone.id,
                          decision: "reject",
                          reason: reviews[`zone-${zone.id}`] ?? "",
                        }),
                      "Zone decision recorded.",
                    )
                  }
                >
                  Reject zone
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {canGovern && (
        <form
          className="mt-4 grid gap-2 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            void act(
              () =>
                proposeConnectorZoneAssignment({
                  connectorKey: assignmentForm.connectorKey,
                  zoneId: Number(assignmentForm.zoneId),
                  basis: assignmentForm.basis,
                  supersedesAssignmentId: currentAssignment?.id ?? null,
                }),
              "Assignment proposal recorded. A different verified person must adopt it.",
            );
          }}
        >
          <label className="text-xs text-slate-300">
            Connector
            <select
              className={`${inputClass} mt-1`}
              value={assignmentForm.connectorKey}
              onChange={(event) =>
                setAssignmentForm((current) => ({
                  ...current,
                  connectorKey: event.target.value,
                }))
              }
              required
            >
              <option value="">Select a registered connector</option>
              {connectors.map((connector) => (
                <option
                  key={connector.connectorKey}
                  value={connector.connectorKey}
                >
                  {connector.connectorKey}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-300">
            Adopted zone
            <select
              className={`${inputClass} mt-1`}
              value={assignmentForm.zoneId}
              onChange={(event) =>
                setAssignmentForm((current) => ({
                  ...current,
                  zoneId: event.target.value,
                }))
              }
              required
            >
              <option value="">Select an adopted zone</option>
              {adoptedZones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.zoneKey} · Purdue {zone.purdueLevel}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-300 md:col-span-2">
            Assignment basis
            <textarea
              className={`${inputClass} mt-1 min-h-16`}
              value={assignmentForm.basis}
              onChange={(event) =>
                setAssignmentForm((current) => ({
                  ...current,
                  basis: event.target.value,
                }))
              }
              required
            />
          </label>
          <button
            type="submit"
            disabled={
              busy ||
              assignmentForm.basis.trim().length < 30 ||
              adoptedZones.length === 0
            }
            className="rounded-lg bg-signal-cyan/20 px-3 py-2 text-xs font-semibold text-signal-cyan disabled:opacity-40 md:col-span-2"
          >
            Propose connector assignment
          </button>
        </form>
      )}

      <ul className="mt-4 space-y-2">
        {pendingAssignments.map((row) => (
          <li
            key={row.id}
            className="rounded-lg border border-amber-500/20 p-3 text-xs"
          >
            <p className="text-slate-100">
              {row.connectorKey} → {row.zoneKey ?? "zone"} · proposed v
              {row.version}
            </p>
            {canGovern && (
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  aria-label={`Decision basis for ${row.connectorKey}`}
                  className={`${inputClass} min-w-64 flex-1`}
                  value={reviews[`assignment-${row.id}`] ?? ""}
                  onChange={(event) =>
                    setReviews((current) => ({
                      ...current,
                      [`assignment-${row.id}`]: event.target.value,
                    }))
                  }
                />
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-lg border border-emerald-500/30 px-3 py-2 text-emerald-200"
                  onClick={() =>
                    void act(
                      () =>
                        decideConnectorZoneAssignment({
                          assignmentId: row.id,
                          decision: "adopt",
                          reason: reviews[`assignment-${row.id}`] ?? "",
                        }),
                      "Assignment decision recorded.",
                    )
                  }
                >
                  Adopt assignment
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="rounded-lg border border-rose-500/30 px-3 py-2 text-rose-200"
                  onClick={() =>
                    void act(
                      () =>
                        decideConnectorZoneAssignment({
                          assignmentId: row.id,
                          decision: "reject",
                          reason: reviews[`assignment-${row.id}`] ?? "",
                        }),
                      "Assignment decision recorded.",
                    )
                  }
                >
                  Reject assignment
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
