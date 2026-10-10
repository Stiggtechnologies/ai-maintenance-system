import { useEffect, useState } from "react";
import { useAuth } from "../AuthProvider";
import { useOperatingSiteScope } from "./OperatingSiteScope";
import { canOpenSyncContext } from "../../lib/sync-context/access";
import type { SyncContextOperatingPicture } from "../../lib/sync-context/operating-picture";
import { getSyncContextOperatingPicture } from "../../services/syncContextService";

export function useOperatingPicture() {
  const { user, profile, session, loading } = useAuth();
  const scope = useOperatingSiteScope();
  const [generation, setGeneration] = useState(0);
  // Token is used ONLY in ephemeral request identity; never persisted/logged.
  const key = JSON.stringify([
    user?.id,
    profile?.id,
    profile?.role,
    session?.access_token,
    scope?.actorId,
    scope?.organizationId,
    scope?.siteId,
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
    status: "ready" | "loading" | "error";
    picture: SyncContextOperatingPicture | null;
  }>({ key: "", status: "loading", picture: null });
  useEffect(() => {
    let current = true;
    if (!allowed || !scope) return;
    getSyncContextOperatingPicture({ siteId: scope.siteId })
      .then((picture) => {
        if (!current) return;
        if (
          picture.organizationId !== scope.organizationId ||
          picture.scope.siteId !== scope.siteId
        )
          throw new Error("Scope changed");
        setState({ key, status: "ready", picture });
      })
      .catch(() => {
        if (current) setState({ key, status: "error", picture: null });
      });
    return () => {
      current = false;
    };
    // key binds the complete actor/org/site/session generation, not object identity.
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
  // Occlude old geometry synchronously on scope/session change, before effects.
  const status = !allowed
    ? "unauthorized"
    : state.key === key
      ? state.status
      : "loading";
  return {
    scope,
    status,
    picture: status === "ready" ? state.picture : null,
    refresh: () => setGeneration((n) => n + 1),
  };
}
