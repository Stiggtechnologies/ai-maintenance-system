/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import { Wrench, AlertCircle } from "lucide-react";
import { workService } from "../services/work";
import { platformService } from "../services/platform";

export function WorkDashboard() {
  const [workOrders, setWorkOrders] = useState<any[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadWorkData();
  }, []);

  const loadWorkData = async () => {
    try {
      const userContext = await platformService.getCurrentUserContext();
      if (!userContext) {
        setLoading(false);
        return;
      }

      const [orders, notifs] = await Promise.all([
        workService.getWorkOrders(
          userContext.organization_id,
          userContext.default_site_id || undefined,
        ),
        workService.getNotifications(
          userContext.organization_id,
          userContext.default_site_id || undefined,
        ),
      ]);

      setWorkOrders(orders);
      setNotifications(notifs);
    } catch (error) {
      console.error("Error loading work data:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400">Loading work data...</div>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    new: "bg-teal-500/10 text-teal-400 border border-teal-500/20",
    in_progress: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
    pending_approval:
      "bg-orange-500/10 text-orange-400 border border-orange-500/20",
    completed:
      "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
    cancelled: "bg-[#1A2030] text-slate-400",
  };

  const priorityColors: Record<string, string> = {
    critical: "text-red-600",
    high: "text-orange-600",
    medium: "text-teal-400",
    low: "text-slate-400",
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-[#E6EDF3]">Work Management</h1>
        <p className="text-slate-400 mt-1">
          Notifications, work requests, and work orders
        </p>
      </div>

      {/* Notifications */}
      <div className="bg-[#11161D] border border-[#232A33] rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertCircle size={20} className="text-slate-400" />
          <h2 className="text-lg font-semibold text-[#E6EDF3]">
            Recent Notifications
          </h2>
          <span className="ml-auto px-2 py-1 bg-teal-500/10 text-teal-400 border border-teal-500/20 text-sm font-medium rounded">
            {notifications.length}
          </span>
        </div>

        <div className="space-y-2">
          {notifications.length > 0 ? (
            notifications.slice(0, 10).map((notif) => (
              <div
                key={notif.id}
                className="flex items-start gap-3 p-3 bg-[#0B0F14] rounded-lg hover:bg-[#1A2030] transition-colors cursor-pointer"
              >
                <div
                  className={`w-2 h-2 rounded-full mt-2 ${notif.status === "new" ? "bg-blue-500" : "bg-slate-300"}`}
                />
                <div className="flex-1">
                  <div className="font-medium text-[#E6EDF3]">
                    {notif.title}
                  </div>
                  {notif.description && (
                    <div className="text-sm text-slate-400 mt-1">
                      {notif.description}
                    </div>
                  )}
                  <div className="text-xs text-slate-500 mt-1">
                    {new Date(notif.reported_at).toLocaleString()} •{" "}
                    {notif.source_type}
                  </div>
                </div>
                <div
                  className={`px-2 py-1 rounded text-xs font-medium ${priorityColors[notif.priority] || "text-slate-400"}`}
                >
                  {notif.priority}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center text-slate-500 py-8">
              No notifications found
            </div>
          )}
        </div>
      </div>

      {/* Work Orders */}
      <div className="bg-[#11161D] border border-[#232A33] rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Wrench size={20} className="text-slate-400" />
          <h2 className="text-lg font-semibold text-[#E6EDF3]">Work Orders</h2>
          <span className="ml-auto px-2 py-1 bg-teal-500/10 text-teal-400 border border-teal-500/20 text-sm font-medium rounded">
            {workOrders.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#232A33]">
                <th className="text-left py-3 px-4 text-sm font-semibold text-[#E6EDF3]">
                  WO #
                </th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-[#E6EDF3]">
                  Title
                </th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-[#E6EDF3]">
                  Priority
                </th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-[#E6EDF3]">
                  Status
                </th>
                <th className="text-left py-3 px-4 text-sm font-semibold text-[#E6EDF3]">
                  Due Date
                </th>
              </tr>
            </thead>
            <tbody>
              {workOrders.length > 0 ? (
                workOrders.slice(0, 20).map((wo) => (
                  <tr
                    key={wo.id}
                    className="border-b border-[#1A2030] hover:bg-[#0B0F14] cursor-pointer"
                  >
                    <td className="py-3 px-4 text-sm font-mono text-slate-400">
                      {wo.work_order_number || wo.id.slice(0, 8)}
                    </td>
                    <td className="py-3 px-4 text-sm text-[#E6EDF3]">
                      {wo.title || "Untitled Work Order"}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`text-sm font-medium ${priorityColors[wo.priority] || "text-slate-400"}`}
                      >
                        {wo.priority || "medium"}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${statusColors[wo.status] || statusColors.new}`}
                      >
                        {wo.status || "new"}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-slate-400">
                      {wo.planned_finish
                        ? new Date(
                            String(wo.planned_finish),
                          ).toLocaleDateString()
                        : "-"}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="text-center text-slate-500 py-8">
                    No work orders found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
