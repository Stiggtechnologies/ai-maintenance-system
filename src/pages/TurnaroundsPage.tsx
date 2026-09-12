/**
 * Shutdowns & Turnarounds — /turnarounds. C9.05 makes the route discoverable:
 * an accountable human can record a planning window and generate a persisted,
 * recommendation-only loss/backlog/outage planning run.
 */
import { OutagePlanning } from "../components/OutagePlanning";
import { MaintenanceOptimization } from "../components/MaintenanceOptimization";

export function TurnaroundsPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Shutdowns &amp; Turnarounds
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Outage windows of every kind — planned, forced and opportunity — with
          their work scope
        </p>
      </div>
      <MaintenanceOptimization />
      <OutagePlanning />
    </div>
  );
}
