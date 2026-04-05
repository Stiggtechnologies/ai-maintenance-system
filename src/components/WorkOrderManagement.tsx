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
    pending: "bg-blue-100 text-blue-800",
    in_progress: "bg-yellow-100 text-yellow-800",
    completed: "bg-green-100 text-green-800",
    cancelled: "bg-slate-100 text-slate-600",
  };

  const priorityColors: Record<string, string> = {
    critical: "text-red-600 font-bold",
    high: "text-orange-600 font-semibold",
    medium: "text-blue-600",
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
          <h2 className="text-xl font-bold text-slate-900">
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
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
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
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-slate-500 bg-slate-50 border-b border-slate-200">
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
                  className="border-b border-slate-100 hover:bg-slate-50"
                >
                  <td className="px-4 py-3 text-sm font-medium text-slate-900">
                    {wo.title}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">
                    {wo.assets?.name || "-"}
                  </td>
                  <td
                    className={`px-4 py-3 text-sm ${priorityColors[wo.priority] || ""}`}
                  >
                    {wo.priority}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${statusColors[wo.status] || "bg-slate-100 text-slate-600"}`}
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
