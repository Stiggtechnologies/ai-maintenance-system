/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export function IntelligenceRuntimeEnterprisePanel() {
  const [endpoints, setEndpoints] = useState<any[]>([]);
  const [audit, setAudit] = useState<any[]>([]);
  const [health, setHealth] = useState<any[]>([]);

  useEffect(() => {
    load();
  }, []);

  const load = async () => {
    const [e, a, h] = await Promise.all([
      supabase
        .from("sir_notification_endpoints")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("sir_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("sir_health_history")
        .select("*")
        .order("checked_at", { ascending: false })
        .limit(50),
    ]);

    setEndpoints(e.data || []);
    setAudit(a.data || []);
    setHealth(h.data || []);
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          Intelligence Runtime Enterprise
        </h1>
        <p className="text-gray-600 mt-1">
          Endpoints, audit trail, health checks
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border rounded-xl p-4">
          <h2 className="font-semibold">Notification Endpoints</h2>
          <div className="mt-3 space-y-2 text-sm">
            {endpoints.map((e) => (
              <div key={e.id} className="border rounded-lg p-2">
                <div className="font-medium">
                  {e.channel} → {e.target}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {e.endpoint_url}
                </div>
              </div>
            ))}
            {endpoints.length === 0 && (
              <div className="text-gray-500">None configured</div>
            )}
          </div>
        </div>

        <div className="bg-white border rounded-xl p-4">
          <h2 className="font-semibold">Audit Log</h2>
          <div className="mt-3 space-y-2 text-sm">
            {audit.map((a) => (
              <div key={a.id} className="border rounded-lg p-2">
                <div className="font-medium">{a.action}</div>
                <div className="text-xs text-gray-500">
                  {a.actor} • {new Date(a.created_at).toLocaleString()}
                </div>
              </div>
            ))}
            {audit.length === 0 && (
              <div className="text-gray-500">No audit events</div>
            )}
          </div>
        </div>

        <div className="bg-white border rounded-xl p-4">
          <h2 className="font-semibold">Health Checks</h2>
          <div className="mt-3 space-y-2 text-sm">
            {health.map((h) => (
              <div key={h.id} className="border rounded-lg p-2">
                <div className="font-medium">
                  {h.name} — {h.status}
                </div>
                <div className="text-xs text-gray-500">
                  {new Date(h.checked_at).toLocaleString()}
                </div>
              </div>
            ))}
            {health.length === 0 && (
              <div className="text-gray-500">No checks yet</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
