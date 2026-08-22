import type { ReactNode } from "react";
import { useParams } from "react-router-dom";
import { RecoveryContextPanel } from "./RecoveryContextPanel";
import type { RecoveryContextSurface } from "../services/recoveryPlatformContextService";

export function RecoveryAwarePage({
  surface,
  children,
}: {
  surface: RecoveryContextSurface;
  children: ReactNode;
}) {
  const { workOrderId } = useParams<{ workOrderId: string }>();

  return (
    <>
      <RecoveryContextPanel
        surface={surface}
        workOrderId={surface === "work_order" ? workOrderId : null}
      />
      {children}
    </>
  );
}
