import { useState, useEffect } from "react";
import { Upload, Search, Package, MapPin, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { CSVImportWizard } from "./CSVImportWizard";
import { supabase } from "../lib/supabase";
import { platformService } from "../services/platform";
import { PageHeader } from "./ui";

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

const statusStyles: Record<string, string> = {
  operational:
    "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  degraded: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
  failed: "bg-red-500/10 text-red-400 border border-red-500/20",
  maintenance: "bg-teal-500/10 text-teal-400 border border-teal-500/20",
  decommissioned: "bg-slate-500/10 text-slate-500 border border-slate-500/20",
};

const criticalityDot: Record<string, string> = {
  critical: "bg-red-400",
  high: "bg-orange-400",
  medium: "bg-teal-400",
  low: "bg-slate-500",
};

export function AssetManagement() {
  const navigate = useNavigate();
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
      if (!userContext) {
        setLoading(false);
        return;
      }

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-500 pulse-live">Loading assets...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 relative z-10">
      <PageHeader
        icon={Package}
        title="Asset Management"
        subtitle={`${assets.length} assets registered`}
        actions={
          <button
            onClick={() => setShowImportWizard(true)}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-500 text-sm font-medium transition-colors"
          >
            <Upload size={16} /> Import CSV
          </button>
        }
      />

      {/* Search + Filter */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
          />
          <input
            type="text"
            placeholder="Search assets by name or tag..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white/[0.04] border border-white/[0.06] rounded-lg text-sm text-[#E6EDF3] placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500/30 transition-colors"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2.5 bg-white/[0.04] border border-white/[0.06] rounded-lg text-sm text-[#E6EDF3] focus:outline-none focus:ring-2 focus:ring-teal-500/40"
        >
          <option value="all">All Statuses</option>
          <option value="operational">Operational</option>
          <option value="degraded">Degraded</option>
          <option value="failed">Failed</option>
          <option value="maintenance">Maintenance</option>
        </select>
      </div>

      {/* Asset Grid */}
      {filtered.length === 0 ? (
        <div className="glass border border-white/[0.06] rounded-xl text-center py-16">
          <Package size={48} className="mx-auto mb-3 text-slate-600" />
          <p className="text-slate-400">
            No assets found. Import assets using CSV to get started.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((asset) => (
            <div
              key={asset.id}
              onClick={() => navigate(`/assets/${asset.id}`)}
              className="glass border border-white/[0.06] rounded-xl p-5 cursor-pointer transition-all duration-300 hover:border-teal-500/30 hover:shadow-[0_0_20px_rgba(20,184,166,0.06)] group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-[#E6EDF3] group-hover:text-teal-300 transition-colors truncate">
                    {asset.name}
                  </h3>
                  {asset.asset_tag && (
                    <div className="text-xs text-slate-500 font-mono mt-0.5">
                      {asset.asset_tag}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusStyles[asset.status] || "bg-slate-500/10 text-slate-500 border border-slate-500/20"}`}
                  >
                    {asset.status}
                  </span>
                  <ChevronRight
                    size={14}
                    className="text-slate-600 group-hover:text-teal-400 transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-1.5 text-xs text-slate-500">
                {asset.asset_classes?.name && (
                  <div className="flex items-center justify-between">
                    <span>Class</span>
                    <span className="text-slate-300">
                      {asset.asset_classes.name}
                    </span>
                  </div>
                )}
                {asset.manufacturer && (
                  <div className="flex items-center justify-between">
                    <span>Manufacturer</span>
                    <span className="text-slate-300">
                      {asset.manufacturer} {asset.model}
                    </span>
                  </div>
                )}
                {asset.asset_locations?.name && (
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1">
                      <MapPin size={10} /> Location
                    </span>
                    <span className="text-slate-300">
                      {asset.asset_locations.name}
                    </span>
                  </div>
                )}
                {asset.criticality && (
                  <div className="flex items-center justify-between">
                    <span>Criticality</span>
                    <span className="flex items-center gap-1.5 text-slate-300 capitalize">
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${criticalityDot[asset.criticality] || "bg-slate-500"}`}
                      />
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
