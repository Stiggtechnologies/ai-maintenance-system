import { useState, useEffect } from "react";
import {
  Plug,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  Plus,
  ExternalLink,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { platformService } from "../services/platform";

interface Connector {
  id: string;
  connector_type: string;
  name: string;
  status: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_at: string;
}

interface ConnectorRun {
  id: string;
  connector_id: string;
  run_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  records_processed: number;
  error_message: string | null;
}

export function IntegrationsPage() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [runs, setRuns] = useState<ConnectorRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"connectors" | "history">(
    "connectors",
  );

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const userContext = await platformService.getCurrentUserContext();
      if (!userContext) {
        setLoading(false);
        return;
      }

      const [connectorsRes, runsRes] = await Promise.all([
        supabase
          .from("connectors")
          .select("*")
          .eq("organization_id", userContext.organization_id)
          .order("name"),
        supabase
          .from("connector_runs")
          .select("*")
          .order("started_at", { ascending: false })
          .limit(50),
      ]);

      if (connectorsRes.data) setConnectors(connectorsRes.data);
      if (runsRes.data) setRuns(runsRes.data);
    } catch (error) {
      console.error("Error loading integrations:", error);
    } finally {
      setLoading(false);
    }
  };

  const connectorTypes = [
    {
      type: "SAP",
      label: "SAP PM/EAM",
      description: "Enterprise asset management",
    },
    {
      type: "Maximo",
      label: "IBM Maximo",
      description: "Asset lifecycle management",
    },
    {
      type: "Ignition",
      label: "Ignition SCADA",
      description: "Real-time process data",
    },
    {
      type: "OPC-UA",
      label: "OPC-UA",
      description: "Industrial communication protocol",
    },
    { type: "REST", label: "REST API", description: "Custom REST endpoint" },
    { type: "MQTT", label: "MQTT", description: "IoT message broker" },
    { type: "CSV", label: "CSV Import", description: "Bulk data import" },
    {
      type: "Historian",
      label: "OSIsoft PI",
      description: "Process data historian",
    },
  ];

  const statusIcon = (status: string) => {
    if (status === "active")
      return <CheckCircle size={16} className="text-green-500" />;
    if (status === "inactive")
      return <XCircle size={16} className="text-slate-400" />;
    if (status === "error")
      return <XCircle size={16} className="text-red-500" />;
    return <Clock size={16} className="text-yellow-500" />;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading integrations...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Integrations</h1>
          <p className="text-slate-600 mt-1">
            Connect external systems and data sources
          </p>
        </div>
        <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
          <Plus size={16} /> Add Connector
        </button>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <nav className="flex gap-6">
          <button
            onClick={() => setActiveTab("connectors")}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === "connectors" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}
          >
            Active Connectors{" "}
            <span className="ml-1 text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">
              {connectors.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${activeTab === "history" ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"}`}
          >
            Sync History
          </button>
        </nav>
      </div>

      {activeTab === "connectors" && (
        <div className="space-y-6">
          {/* Active Connectors */}
          {connectors.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {connectors.map((conn) => (
                <div
                  key={conn.id}
                  className="bg-white border border-slate-200 rounded-xl p-5 hover:border-blue-300 transition-colors"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Plug size={18} className="text-slate-400" />
                      <h3 className="font-semibold text-slate-900">
                        {conn.name}
                      </h3>
                    </div>
                    {statusIcon(conn.status)}
                  </div>
                  <div className="text-xs text-slate-500 mb-3">
                    Type: {conn.connector_type}
                  </div>
                  {conn.last_success_at && (
                    <div className="text-xs text-green-600">
                      Last sync:{" "}
                      {new Date(conn.last_success_at).toLocaleString()}
                    </div>
                  )}
                  {conn.last_failure_at && !conn.last_success_at && (
                    <div className="text-xs text-red-600">
                      Last failure:{" "}
                      {new Date(conn.last_failure_at).toLocaleString()}
                    </div>
                  )}
                  <div className="flex gap-2 mt-3">
                    <button className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                      Configure
                    </button>
                    <button className="text-xs text-slate-500 hover:text-slate-600 font-medium flex items-center gap-1">
                      <RefreshCw size={12} /> Sync Now
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Available Connector Types */}
          <div>
            <h2 className="text-lg font-semibold text-slate-900 mb-4">
              Available Integrations
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {connectorTypes.map((ct) => {
                const isConnected = connectors.some(
                  (c) => c.connector_type === ct.type,
                );
                return (
                  <div
                    key={ct.type}
                    className={`border rounded-xl p-4 ${isConnected ? "border-green-200 bg-green-50" : "border-slate-200 bg-white"}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-medium text-slate-900 text-sm">
                        {ct.label}
                      </h3>
                      {isConnected && (
                        <CheckCircle size={14} className="text-green-500" />
                      )}
                    </div>
                    <p className="text-xs text-slate-500">{ct.description}</p>
                    <button className="mt-3 text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
                      {isConnected ? "Manage" : "Connect"}{" "}
                      <ExternalLink size={10} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {activeTab === "history" && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            Sync History
          </h2>
          {runs.length === 0 ? (
            <p className="text-slate-500 text-center py-8">
              No sync history available
            </p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                  <th className="pb-2">Connector</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Records</th>
                  <th className="pb-2">Started</th>
                  <th className="pb-2">Duration</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const connector = connectors.find(
                    (c) => c.id === run.connector_id,
                  );
                  const duration =
                    run.finished_at && run.started_at
                      ? Math.round(
                          (new Date(run.finished_at).getTime() -
                            new Date(run.started_at).getTime()) /
                            1000,
                        )
                      : null;
                  return (
                    <tr key={run.id} className="border-b border-slate-100">
                      <td className="py-3 text-sm font-medium text-slate-900">
                        {connector?.name || "Unknown"}
                      </td>
                      <td className="py-3 text-sm text-slate-600">
                        {run.run_type}
                      </td>
                      <td className="py-3">
                        <span
                          className={`text-xs px-2 py-1 rounded-full ${run.status === "success" ? "bg-green-100 text-green-800" : run.status === "failure" ? "bg-red-100 text-red-800" : "bg-yellow-100 text-yellow-800"}`}
                        >
                          {run.status}
                        </span>
                      </td>
                      <td className="py-3 text-sm text-slate-600">
                        {run.records_processed?.toLocaleString() || "-"}
                      </td>
                      <td className="py-3 text-sm text-slate-500">
                        {new Date(run.started_at).toLocaleString()}
                      </td>
                      <td className="py-3 text-sm text-slate-500">
                        {duration ? `${duration}s` : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
