import { useEffect, useState } from "react";
import { BrandWordmark } from "./BrandWordmark";
import { useOptionalAuth } from "./AuthProvider";
import { hasWorkspaceMembership } from "../lib/auth";
import { publicDecisionJourneyPaths } from "../lib/public-journey-context";
import "./public-journey.css";

function useCanOfferWorkspace(): boolean {
  const auth = useOptionalAuth();
  const userId = auth?.user?.id ?? "";
  const [member, setMember] = useState(false);

  useEffect(() => {
    if (!userId) {
      setMember(false);
      return;
    }
    let cancelled = false;
    void hasWorkspaceMembership(userId).then((value) => {
      if (!cancelled) setMember(value);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (auth?.loading) return false;
  if (auth?.user || member) return false;
  return true;
}

export function PublicJourneyHeader({
  search = window.location.search,
  offerWorkspace,
}: {
  search?: string;
  /** Pass false to hide the signup offer. Omit to hide it for an existing account. */
  offerWorkspace?: boolean;
}) {
  const detected = useCanOfferWorkspace();
  const showCreate = offerWorkspace === false ? false : detected;
  const destinations = publicDecisionJourneyPaths(
    search,
    window.location.origin,
    window.location.pathname,
  );
  return (
    <header className="journey-header">
      <a
        className="journey-brand"
        href={destinations.assistant}
        aria-label="SyncAI workspace"
      >
        <BrandWordmark className="h-7" />
      </a>
      <nav aria-label="Public navigation">
        <a href={destinations.assistant}>Assistant</a>
        <a href={destinations.firstDecision}>First decision</a>
        {showCreate ? (
          <a
            href={`/?view=signup&returnTo=${encodeURIComponent(destinations.firstDecision)}`}
          >
            Create a workspace
          </a>
        ) : null}
        <a className="journey-header-quiet" href="https://syncai.ca/contact">
          Talk to us
        </a>
      </nav>
    </header>
  );
}
