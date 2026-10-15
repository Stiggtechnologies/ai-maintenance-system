import { useEffect, useState } from "react";
import { useAuth } from "../AuthProvider";
import { useOperatingSiteScope } from "./OperatingSiteScope";
import { canOpenSyncContext } from "../../lib/sync-context/access";
import type { SyncContextSourceInventory } from "../../lib/sync-context/source-inventory";
import { getSyncContextSourceInventory } from "../../services/syncContextService";

export type SourceInventoryStatus =
  "ready" | "loading" | "error" | "unauthorized";

/** Organization metadata only; the parameterless server RPC authorizes every read. */
export function useSourceInventory() {
  const { user, profile, session, loading } = useAuth();
  const scope = useOperatingSiteScope();
  const [generation, setGeneration] = useState(0);
  // Ephemeral request identity, never stored/logged. Site is deliberately absent:
  // an organization registry is not a measurement of the selected site's coverage.
  const key = JSON.stringify([
    user?.id,
    profile?.id,
    profile?.role,
    session?.access_token,
    scope?.actorId,
    scope?.organizationId,
    generation,
  ]);
  const allowed =
    !loading &&
    user?.id === profile?.id &&
    user?.id === scope?.actorId &&
    !!scope?.organizationId &&
    !!session?.access_token &&
    canOpenSyncContext(profile?.role);
  const [state, setState] = useState<{
    key: string;
    status: Exclude<SourceInventoryStatus, "unauthorized">;
    inventory: SyncContextSourceInventory | null;
  }>({ key: "", status: "loading", inventory: null });
  useEffect(() => {
    let current = true;
    if (!allowed || !scope) return;
    getSyncContextSourceInventory()
      .then((inventory) => {
        if (!current) return;
        if (
          inventory.organizationId.toLowerCase() !==
          scope.organizationId.toLowerCase()
        )
          throw new Error("Organization changed");
        setState({ key, status: "ready", inventory });
      })
      .catch(() => {
        if (current) setState({ key, status: "error", inventory: null });
      });
    return () => {
      current = false;
    };
    // key binds the actor/org/session generation, not provider object identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, allowed]);
  useEffect(() => {
    if (!allowed) return;
    const timer = window.setInterval(() => setGeneration((n) => n + 1), 60_000);
    const visibility = () => {
      if (document.visibilityState === "visible") setGeneration((n) => n + 1);
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [allowed]);
  // Hide old tenant/session metadata synchronously, before effect cleanup runs.
  const status: SourceInventoryStatus = !allowed
    ? "unauthorized"
    : state.key === key
      ? state.status
      : "loading";
  return {
    status,
    inventory: status === "ready" ? state.inventory : null,
    refresh: () => setGeneration((n) => n + 1),
  };
}
