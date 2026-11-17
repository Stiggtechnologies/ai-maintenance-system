import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { sapS4WriteActions } from "../services/sapS4Write";

const input =
  "w-full rounded-lg border border-industrial-border bg-industrial-slate px-3 py-2 text-sm text-industrial-text outline-none focus:border-signal-cyan";

interface WriteRequest {
  id: string;
  operation: string;
  serviceName: string;
  entityName: string;
  httpMethod: string;
  status: string;
  payload: Record<string, string>;
  payloadSha256: string;
  requestedBy: string;
  sapHttpStatus: number | null;
  sapError: string | null;
}

export function SapS4WriteConnectorSetup({
  onConfigured,
}: {
  onConfigured: () => Promise<void>;
}) {
  const { profile, user } = useAuth();
  const admin = String(profile?.role ?? "").toLowerCase() === "admin";
  const [tenantEnabled, setTenantEnabled] = useState(false);
  const [canApprove, setCanApprove] = useState(false);
  const [requests, setRequests] = useState<WriteRequest[]>([]);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [serviceRoot, setServiceRoot] = useState("");
  const [credential, setCredential] = useState("");
  const [connectorEnabled, setConnectorEnabled] = useState(false);
  const [operation, setOperation] = useState("maintenance_notification_create");
  const [notificationType, setNotificationType] = useState("");
  const [notificationText, setNotificationText] = useState("");
  const [orderNumber, setOrderNumber] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [basis, setBasis] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const workspace = await sapS4WriteActions.workspace();
    setTenantEnabled(workspace.tenantWriteEnabled === true);
    setCanApprove(workspace.canApprove === true);
    setRequests(
      Array.isArray(workspace.requests)
        ? (workspace.requests as WriteRequest[])
        : [],
    );
  };

  useEffect(() => {
    let active = true;
    void sapS4WriteActions
      .workspace()
      .then((workspace) => {
        if (!active) return;
        setTenantEnabled(workspace.tenantWriteEnabled === true);
        setCanApprove(workspace.canApprove === true);
        setRequests(
          Array.isArray(workspace.requests)
            ? (workspace.requests as WriteRequest[])
            : [],
        );
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message);
      });
    return () => {
      active = false;
    };
  }, []);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await work();
      const note =
        result && typeof result === "object" && "note" in result
          ? String((result as { note?: unknown }).note ?? "")
          : "Saved.";
      setMessage(note);
      await load();
      await onConfigured();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const payload = (): Record<string, string> => {
    if (operation === "maintenance_order_release") {
      return { MaintenanceOrder: orderNumber.trim() };
    }
    if (operation === "maintenance_notification_text_update") {
      return {
        MaintenanceNotification: orderNumber.trim(),
        NotificationText: notificationText.trim(),
      };
    }
    return {
      NotificationType: notificationType.trim(),
      NotificationText: notificationText.trim(),
    };
  };

  return (
    <section className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-5">
      <div className="flex items-start gap-3">
        <ShieldCheck className="mt-0.5 h-5 w-5 text-amber-300" />
        <div>
          <h2 className="font-semibold text-industrial-text">
            SAP S/4HANA write-back (human approval required)
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            OData V2 POST/PATCH for an allowlisted maintenance notification or
            maintenance-order release. Writes stay off until this tenant flag is
            explicit. A different person with approval authority must approve
            before anything is sent to SAP. Built and tested against mocked SAP
            responses only — not certified against a customer SAP tenant, and
            not on the production Edge deploy allowlist.
          </p>
        </div>
      </div>

      {admin && (
        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={tenantEnabled}
              onChange={(event) => setTenantEnabled(event.target.checked)}
            />
            Enable SAP writes for this tenant
          </label>
          <textarea
            className={input}
            placeholder="Basis for the tenant write flag or connector (20+ characters)"
            value={basis}
            onChange={(event) => setBasis(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-amber-300/40 px-3 py-2 text-sm text-amber-100"
              disabled={busy || basis.trim().length < 20}
              onClick={() =>
                void run(() =>
                  sapS4WriteActions.setEnabled(tenantEnabled, basis.trim()),
                )
              }
            >
              Save tenant write flag
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <input
              className={input}
              placeholder="SAP write connector key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            <input
              className={input}
              placeholder="SAP write display name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <input
              className={input}
              placeholder="https://sap.example.com/sap/opu/odata/sap/API_MAINTNOTIFICATION"
              value={serviceRoot}
              onChange={(event) => setServiceRoot(event.target.value)}
            />
            <input
              className={input}
              placeholder="vault://customer/sap-s4-write"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={connectorEnabled}
              onChange={(event) => setConnectorEnabled(event.target.checked)}
            />
            Enable this connector for approved writes
          </label>
          <button
            type="button"
            className="rounded-lg border border-amber-300/40 px-3 py-2 text-sm text-amber-100"
            disabled={busy || basis.trim().length < 20 || key.trim().length < 3}
            onClick={() =>
              void run(() =>
                sapS4WriteActions.configure({
                  key: key.trim(),
                  name: name.trim(),
                  serviceRoot: serviceRoot.trim(),
                  credentialRef: credential.trim(),
                  enabled: connectorEnabled,
                  basis: basis.trim(),
                }),
              )
            }
          >
            Save SAP write connector
          </button>
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-sm text-slate-300">
          Allowlisted operation
          <select
            className={`${input} mt-1`}
            value={operation}
            onChange={(event) => setOperation(event.target.value)}
          >
            <option value="maintenance_notification_create">
              Create maintenance notification (POST)
            </option>
            <option value="maintenance_notification_text_update">
              Update notification short text (PATCH)
            </option>
            <option value="maintenance_order_release">
              Release maintenance order (POST)
            </option>
          </select>
        </label>
        <input
          className={input}
          placeholder="Idempotency key"
          value={idempotencyKey}
          onChange={(event) => setIdempotencyKey(event.target.value)}
        />
        {operation !== "maintenance_order_release" && (
          <input
            className={input}
            placeholder="Notification text"
            aria-label="Notification text"
            value={notificationText}
            onChange={(event) => setNotificationText(event.target.value)}
          />
        )}
        {operation === "maintenance_notification_create" && (
          <input
            className={input}
            placeholder="Notification type"
            aria-label="Notification type"
            value={notificationType}
            onChange={(event) => setNotificationType(event.target.value)}
          />
        )}
        {operation !== "maintenance_notification_create" && (
          <input
            className={input}
            placeholder={
              operation === "maintenance_order_release"
                ? "Maintenance order"
                : "Notification number"
            }
            aria-label="SAP object key"
            value={orderNumber}
            onChange={(event) => setOrderNumber(event.target.value)}
          />
        )}
      </div>
      <button
        type="button"
        className="mt-3 rounded-lg border border-amber-300/40 px-3 py-2 text-sm text-amber-100"
        disabled={
          busy || basis.trim().length < 20 || idempotencyKey.trim().length < 8
        }
        onClick={() =>
          void run(() =>
            sapS4WriteActions.propose({
              connectorKey: key.trim(),
              operation,
              payload: payload(),
              idempotencyKey: idempotencyKey.trim(),
              basis: basis.trim(),
            }),
          )
        }
      >
        Propose SAP write
      </button>

      <ul className="mt-4 space-y-2">
        {requests.map((request) => {
          const own = request.requestedBy === user?.id;
          return (
            <li
              key={request.id}
              className="rounded-lg border border-white/10 p-3 text-sm text-slate-300"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {request.httpMethod} {request.serviceName}/
                  {request.entityName} · {request.status}
                </span>
                <span className="text-xs text-slate-500">
                  {request.payloadSha256.slice(0, 12)}
                </span>
              </div>
              <pre className="mt-2 overflow-x-auto text-xs text-slate-400">
                {JSON.stringify(request.payload)}
              </pre>
              {request.sapHttpStatus != null && (
                <p className="mt-1 text-xs text-slate-400">
                  SAP HTTP {request.sapHttpStatus}
                  {request.sapError ? ` — ${request.sapError}` : ""}
                </p>
              )}
              {canApprove && !own && request.status === "pending" && (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="rounded border border-signal-cyan/40 px-2 py-1 text-signal-cyan"
                    onClick={() =>
                      void run(() =>
                        sapS4WriteActions.decide(
                          request.id,
                          "approved",
                          decisionNote,
                        ),
                      )
                    }
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="rounded border border-white/20 px-2 py-1"
                    onClick={() =>
                      void run(() =>
                        sapS4WriteActions.decide(
                          request.id,
                          "rejected",
                          decisionNote,
                        ),
                      )
                    }
                  >
                    Reject
                  </button>
                </div>
              )}
              {canApprove && !own && request.status === "approved" && (
                <button
                  type="button"
                  className="mt-2 rounded border border-amber-300/40 px-2 py-1 text-amber-100"
                  onClick={() =>
                    void run(() => sapS4WriteActions.execute(request.id))
                  }
                >
                  Execute approved write
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {canApprove && (
        <textarea
          className={`${input} mt-3`}
          placeholder="Decision basis (20+ characters)"
          aria-label="Decision basis"
          value={decisionNote}
          onChange={(event) => setDecisionNote(event.target.value)}
        />
      )}
      {message && <p className="mt-3 text-sm text-slate-300">{message}</p>}
    </section>
  );
}
