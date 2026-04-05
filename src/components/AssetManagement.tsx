import { useState, useEffect } from "react";
import { Upload, Search, Package, MapPin } from "lucide-react";
import { CSVImportWizard } from "./CSVImportWizard";
import { supabase } from "../lib/supabase";
import { platformService } from "../services/platform";

interface Asset {
  id: string;
  name: string;
  asset_tag: string;
  status: string;
  criticality: string;
  manufacturer: string;
  model: string;
  asset_classes?: { name: string };
  asset_locations?: { name: string };
  sites?: { name: string };
}

export function AssetManagement() {
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  useEffect(() => {
    loadAssets();
  }, []);

  const loadAssets = async () => {
    try {
      const userContext = await platformService.getCurrentUserContext();
      if (!userContext) return;

      const { data } = await supabase
        .from("assets")
        .select("*, asset_classes(name), asset_locations(name), sites(name)")
        .eq("organization_id", userContext.organization_id)
        .order("name");

      if (data) setAssets(data);
    } catch (error) {
      console.error("Error loading assets:", error);
    } finally {
      setLoading(false);
    }
  };

  const filtered = assets.filter((a) => {
    if (filterStatus !== "all" && a.status !== filterStatus) return false;
    if (
      searchTerm &&
      !a.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
      !a.asset_tag?.toLowerCase().includes(searchTerm.toLowerCase())
    )
      return false;
    return true;
  });

  const statusColors: Record<string, string> = {
    operational: "bg-green-100 text-green-800",
    degraded: "bg-yellow-100 text-yellow-800",
    failed: "bg-red-100 text-red-800",
    maintenance: "bg-blue-100 text-blue-800",
    decommissioned: "bg-slate-100 text-slate-600",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400">Loading assets...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Asset Management</h2>
          <p className="text-sm text-slate-500 mt-1">
            {assets.length} assets registered
          </p>
        </div>
        <button
          onClick={() => setShowImportWizard(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          <Upload size={16} /> Import CSV
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            placeholder="Search assets by name or tag..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
        >
          <option value="all">All Statuses</option>
          <option value="operational">Operational</option>
          <option value="degraded">Degraded</option>
          <option value="failed">Failed</option>
          <option value="maintenance">Maintenance</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <Package size={48} className="mx-auto mb-3 text-slate-300" />
          <p>No assets found. Import assets using CSV to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((asset) => (
            <div
              key={asset.id}
              className="bg-white border border-slate-200 rounded-xl p-5 hover:border-blue-300 transition-colors"
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-semibold text-slate-900">{asset.name}</h3>
                  {asset.asset_tag && (
                    <div className="text-xs text-slate-500">
                      {asset.asset_tag}
                    </div>
                  )}
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full ${statusColors[asset.status] || "bg-slate-100 text-slate-600"}`}
                >
                  {asset.status}
                </span>
              </div>
              <div className="space-y-1 text-xs text-slate-500 mt-3">
                {asset.asset_classes?.name && (
                  <div>Class: {asset.asset_classes.name}</div>
                )}
                {asset.manufacturer && (
                  <div>
                    {asset.manufacturer} {asset.model}
                  </div>
                )}
                {asset.asset_locations?.name && (
                  <div className="flex items-center gap-1">
                    <MapPin size={10} /> {asset.asset_locations.name}
                  </div>
                )}
                {asset.criticality && (
                  <div>
                    Criticality:{" "}
                    <span className="font-medium capitalize">
                      {asset.criticality}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showImportWizard && (
        <CSVImportWizard
          onClose={() => setShowImportWizard(false)}
          onComplete={() => {
            setShowImportWizard(false);
            loadAssets();
          }}
        />
      )}
    </div>
  );
}
