/**
 * Release & Return to Service — /handover.
 *
 * OpsCoordination renders the three-party equipment loop: operations releases
 * (release_equipment), maintenance returns (return_equipment, deliberately
 * ungated), operations accepts (accept_equipment). It was one of eight panels
 * under the Operational Briefing; every party in the loop now reaches it at
 * its own address (navigation-lifecycle-ia.md §2 Group 6, I-1/P-3). The label
 * names the transaction its RPCs perform — the word "handover" is left to the
 * shift ritual, which the briefing already claims (P-4). Panel remounted, not
 * modified.
 */
import { OpsCoordination } from "../components/OpsCoordination";

export function HandoverPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Release &amp; Return to Service
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Equipment released to maintenance, returned by maintenance, and
          accepted back by operations
        </p>
      </div>
      <OpsCoordination />
    </div>
  );
}
