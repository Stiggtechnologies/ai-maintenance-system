/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from "react";
import { Wrench, AlertCircle, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { workService } from "../services/work";
import { platformService } from "../services/platform";
import { PageHeader, StatusBadge } from "../components/ui";

export function WorkDashboard() {
  const navigate = useNavigate();
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

  const priorityColors: Record<string, string> = {
    critical: "text-red-400",
    high: "text-orange-400",
    medium: "text-teal-400",
    low: "text-slate-400",
  };

  const priorityDot: Record<string, string> = {
    critical: "bg-red-400",
    high: "bg-orange-400",
    medium: "bg-teal-400",
    low: "bg-slate-500",
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-500 pulse-live">Loading work data...</div>
      </div>
    );
  }

  const openCount = workOrders.filter(
    (w) =>
      w.status === "pending" ||
      w.status === "in_progress" ||
      w.status === "new",
  ).length;
  const criticalCount = workOrders.filter(
    (w) => w.priority === "critical",
  ).length;

  return (
    <div className="space-y-6 relative z-10">
      <PageHeader
        icon={Wrench}
        title="Work Management"
        subtitle="Notifications, work requests, and work orders"
      />

      {/* Summary Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="glass border border-white/[0.06] rounded-xl p-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">
            Total Work Orders
          </div>
          <div className="text-2xl font-bold text-[#E6EDF3]">
            {workOrders.length}
          </div>
        </div>
        <div className="glass border border-white/[0.06] rounded-xl p-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">
            Open
          </div>
          <div className="text-2xl font-bold text-teal-400">{openCount}</div>
        </div>
        <div className="glass border border-white/[0.06] rounded-xl p-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">
            Critical
          </div>
          <div className="text-2xl font-bold text-red-400">{criticalCount}</div>
        </div>
        <div className="glass border border-white/[0.06] rounded-xl p-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">
            Notifications
          </div>
          <div className="text-2xl font-bold text-amber-400">
            {notifications.length}
          </div>
        </div>
      </div>

      {/* Notifications */}
      <div className="glass border border-white/[0.06] rounded-xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <AlertCircle size={18} className="text-amber-400" />
          <h2 className="text-base font-semibold text-[#E6EDF3]">
            Recent Notifications
          </h2>
          <span className="ml-auto px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 text-xs font-medium rounded-full">
            {notifications.length}
          </span>
        </div>

        <div className="space-y-2">
          {notifications.length > 0 ? (
            notifications.slice(0, 10).map((notif) => (
              <div
                key={notif.id}
                className="flex items-start gap-3 p-3 bg-white/[0.02] border border-white/[0.04] rounded-lg hover:border-white/[0.08] hover:bg-white/[0.04] transition-all cursor-pointer"
              >
                <div
                  className={`w-2 h-2 rounded-full mt-1.5 ${notif.status === "new" ? "bg-teal-400 shadow-[0_0_8px_rgba(20,184,166,0.5)]" : "bg-slate-600"}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[#E6EDF3] text-sm">
                    {notif.title}
                  </div>
                  {notif.description && (
                    <div className="text-sm text-slate-400 mt-0.5 truncate">
                      {notif.description}
                    </div>
                  )}
                  <div className="text-xs text-slate-500 mt-1">
                    {new Date(notif.reported_at).toLocaleString()} •{" "}
                    {notif.source_type}
                  </div>
                </div>
                <div
                  className={`flex items-center gap-1.5 text-xs font-medium capitalize ${priorityColors[notif.priority] || "text-slate-400"}`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${priorityDot[notif.priority] || "bg-slate-500"}`}
                  />
                  {notif.priority}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center text-slate-500 py-8 text-sm">
              No notifications
            </div>
          )}
        </div>
      </div>

      {/* Work Orders */}
      <div className="glass border border-white/[0.06] rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 p-6 pb-4">
          <Wrench size={18} className="text-teal-400" />
          <h2 className="text-base font-semibold text-[#E6EDF3]">
            Work Orders
          </h2>
          <span className="ml-auto px-2 py-0.5 bg-teal-500/10 text-teal-400 border border-teal-500/20 text-xs font-medium rounded-full">
            {workOrders.length}
          </span>
        </div>

        {workOrders.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-t border-white/[0.04] bg-white/[0.02]">
                  <th className="text-left py-2.5 px-4 text-[11px] font-semibold text-slate-500 uppercase tracking-widest">
                    WO #
                  </th>
                  <th className="text-left py-2.5 px-4 text-[11px] font-semibold text-slate-500 uppercase tracking-widest">
                    Title
                  </th>
                  <th className="text-left py-2.5 px-4 text-[11px] font-semibold text-slate-500 uppercase tracking-widest">
                    Priority
                  </th>
                  <th className="text-left py-2.5 px-4 text-[11px] font-semibold text-slate-500 uppercase tracking-widest">
                    Status
                  </th>
                  <th className="text-left py-2.5 px-4 text-[11px] font-semibold text-slate-500 uppercase tracking-widest">
                    Due Date
                  </th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {workOrders.slice(0, 20).map((wo) => (
                  <tr
                    key={wo.id}
                    onClick={() => navigate(`/work/${wo.id}`)}
                    className="border-t border-white/[0.04] hover:bg-white/[0.02] cursor-pointer transition-colors group"
                  >
                    <td className="py-3 px-4 text-xs font-mono text-slate-500">
                      {wo.wo_number ||
                        wo.work_order_number ||
                        wo.id.slice(0, 8)}
                    </td>
                    <td className="py-3 px-4 text-sm text-[#E6EDF3] group-hover:text-teal-300 transition-colors">
                      {wo.title || "Untitled Work Order"}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`flex items-center gap-1.5 text-sm font-medium capitalize ${priorityColors[wo.priority] || "text-slate-400"}`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${priorityDot[wo.priority] || "bg-slate-500"}`}
                        />
                        {wo.priority || "medium"}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={wo.status || "new"} size="sm" />
                    </td>
                    <td className="py-3 px-4 text-xs text-slate-500">
                      {wo.planned_finish || wo.due_date
                        ? new Date(
                            String(wo.planned_finish || wo.due_date),
                          ).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="py-3 px-4">
                      <ChevronRight
                        size={14}
                        className="text-slate-600 group-hover:text-teal-400 transition-colors"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center text-slate-500 py-12 text-sm border-t border-white/[0.04]">
            No work orders found
          </div>
        )}
      </div>
    </div>
  );
}
