/**
 * Release & Return to Service — /handover.
 *
 * OpsCoordination renders the governed equipment loop: operations releases,
 * maintenance returns, an independent human releases the canonical Quality
 * return-to-service acceptance test, and operations verifies and accepts the
 * exact release. Every party reaches it at its own address; no AI identity or
 * free-text-only compatibility RPC can authorize return to service.
 */
import { RecoveryContextPanel } from "../components/RecoveryContextPanel";
import { OpsCoordination } from "../components/OpsCoordination";
import { DailyCoordinationControl } from "../components/DailyCoordinationControl";
import { ProductionLossReconciliation } from "../components/ProductionLossReconciliation";

export function HandoverPage() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">
          Release &amp; Return to Service
        </h1>
        <p className="text-sm text-slate-400 mt-0.5">
          Equipment released to maintenance, returned with condition evidence,
          and accepted by operations only against an independently released
          return-to-service test
        </p>
      </div>
      <RecoveryContextPanel surface="handover" />
      <DailyCoordinationControl />
      <OpsCoordination />
      <ProductionLossReconciliation />
    </div>
  );
}
