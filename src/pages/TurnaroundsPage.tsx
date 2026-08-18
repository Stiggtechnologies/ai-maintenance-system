/**
 * Shutdowns & Turnarounds — /turnarounds. ROUTE ONLY, deliberately not in
 * the sidebar: nothing anywhere creates an outage_window, so a sidebar item
 * would front a permanently empty surface (navigation-lifecycle-ia.md §2
 * Group 6, the P-7 rule). The route exists so the panel keeps an address for
 * the day outage creation lands. Panel remounted, not modified.
 */
import { OutagePlanning } from "../components/OutagePlanning";

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
      <OutagePlanning />
    </div>
  );
}
