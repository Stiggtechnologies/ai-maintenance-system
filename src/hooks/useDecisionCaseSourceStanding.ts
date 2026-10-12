import { useEffect, useState, type RefObject } from "react";
import { loadPersistedDecisionCase } from "../services/decisionCaseService";
export type SourceStanding = "current" | "checking" | "changed" | "unavailable";
/** Server command/version guards remain authoritative. This prevents stale
 * mapped-source approval from being presented after a focus/periodic recheck,
 * without silently overwriting local form edits with a remote case. */
export function useDecisionCaseSourceStanding(input: {
  enabled: boolean;
  caseId: string;
  revision: number | undefined;
  scope: string;
  busy: RefObject<boolean>;
}): SourceStanding {
  const { enabled, caseId, revision, scope, busy } = input;
  const key = `${scope}:${caseId}:${revision}`;
  const [result, setResult] = useState<{
    key: string;
    standing: SourceStanding;
  }>();
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let inFlight = false;
    async function check() {
      if (inFlight || busy.current) return;
      inFlight = true;
      setResult({ key, standing: "checking" });
      try {
        const canonical = await loadPersistedDecisionCase(caseId);
        if (!cancelled)
          setResult({
            key,
            standing: !canonical
              ? "unavailable"
              : canonical.revision === revision
                ? "current"
                : "changed",
          });
      } catch {
        if (!cancelled) setResult({ key, standing: "unavailable" });
      } finally {
        inFlight = false;
      }
    }
    void check();
    const onVisible = () => {
      if (document.visibilityState !== "hidden") void check();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(onVisible, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, caseId, revision, key, busy]);
  return !enabled
    ? "current"
    : result?.key === key
      ? result.standing
      : "checking";
}
