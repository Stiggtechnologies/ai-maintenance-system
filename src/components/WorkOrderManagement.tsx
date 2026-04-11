import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import { supabase } from "../lib/supabase";
import { platformService } from "../services/platform";

interface WorkOrder {
  id: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  asset_id: string;
  created_at: string;
  assets?: { name: string; asset_tag: string };
}

export function WorkOrderManagement() {
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    loadWorkOrders();
  }, []);

  const loadWorkOrders = async () => {
    try {
      const userContext = await platformService.getCurrentUserContext();
      if (!userContext) return;

      const { data } = await supabase
        .from("work_orders")
        .select("*, assets(name, asset_tag)")
        .eq("organization_id", userContext.organization_id)
        .order("created_at", { ascending: false })
        .limit(100);

      if (data) setWorkOrders(data);
    } catch (error) {
      console.error("Error loading work orders:", error);
    } finally {
      setLoading(false);
    }
  };

  const filtered = workOrders.filter((wo) => {
    if (filterStatus !== "all" && wo.status !== filterStatus) return false;
    if (
      searchTerm &&
      !wo.title.toLowerCase().includes(searchTerm.toLowerCase())
    )
      return false;
    return true;
  });

  const statusColors: Record<string, string> = {
    pending: "bg-teal-500/10 text-teal-400 border border-teal-500/20",
    in_progress: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
    completed:
      "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
    cancelled: "bg-[#1A2030] text-slate-400",
  };

  const priorityColors: Record<string, string> = {
    critical: "text-red-600 font-bold",
    high: "text-orange-600 font-semibold",
    medium: "text-teal-400",
    low: "text-slate-500",
  };

  const stats = {
    total: workOrders.length,
    pending: workOrders.filter((w) => w.status === "pending").length,
    in_progress: workOrders.filter((w) => w.status === "in_progress").length,
    completed: workOrders.filter((w) => w.status === "completed").length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-slate-400">Loading work orders...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-[#E6EDF3]">
            Work Order Management
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            {stats.total} total, {stats.pending} pending, {stats.in_progress} in
            progress
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            placeholder="Search work orders..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 border border-[#232A33] rounded-lg text-sm focus:ring-2 focus:ring-teal-500/40 focus:border-transparent"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 border border-[#232A33] rounded-lg text-sm"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          No work orders found
        </div>
      ) : (
        <div className="bg-[#11161D] border border-[#232A33] rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-slate-500 bg-[#0B0F14] border-b border-[#232A33]">
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((wo) => (
                <tr
                  key={wo.id}
                  className="border-b border-[#1A2030] hover:bg-[#0B0F14]"
                >
                  <td className="px-4 py-3 text-sm font-medium text-[#E6EDF3]">
                    {wo.title}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-400">
                    {wo.assets?.name || "-"}
                  </td>
                  <td
                    className={`px-4 py-3 text-sm ${priorityColors[wo.priority] || ""}`}
                  >
                    {wo.priority}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${statusColors[wo.status] || "bg-[#1A2030] text-slate-400"}`}
                    >
                      {wo.status?.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-500">
                    {new Date(wo.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
