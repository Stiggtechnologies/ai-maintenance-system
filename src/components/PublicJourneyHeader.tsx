import { useEffect, useState } from "react";
import { BrandWordmark } from "./BrandWordmark";
import { useOptionalAuth } from "./AuthProvider";
import { hasWorkspaceMembership } from "../lib/auth";
import { publicDecisionJourneyPaths } from "../lib/public-journey-context";
import {
  TALK_TO_US_HREF,
  selfServeNavLink,
  type SelfServeNavInput,
} from "../lib/onboarding/self-serve-nav";
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
  unsavedQuestionWarning,
  selfServeGate,
}: {
  search?: string;
  /** Pass false to hide the signup offer. Omit to hide it for an existing account. */
  offerWorkspace?: boolean;
  /** Set when Assistant would leave a typed question that is not yet a draft. */
  unsavedQuestionWarning?: string;
  /**
   * Set on the first-decision path. Talk to us stays hidden until a Decision
   * Case is saved. Omit on surfaces that are not that path.
   */
  selfServeGate?: SelfServeNavInput;
}) {
  const detected = useCanOfferWorkspace();
  const showCreate = offerWorkspace === false ? false : detected;
  const destinations = publicDecisionJourneyPaths(
    search,
    window.location.origin,
    window.location.pathname,
  );
  const leaveAssistant = (event: { preventDefault: () => void }) => {
    if (!unsavedQuestionWarning) return;
    if (!window.confirm(unsavedQuestionWarning)) event.preventDefault();
  };
  const selfServe = selfServeGate ? selfServeNavLink(selfServeGate) : null;
  return (
    <header className="journey-header">
      <a
        className="journey-brand"
        href={destinations.assistant}
        aria-label="SyncAI workspace"
        onClick={leaveAssistant}
      >
        <BrandWordmark className="h-7" />
      </a>
      <nav aria-label="Public navigation">
        <a href={destinations.assistant} onClick={leaveAssistant}>
          Assistant
        </a>
        <a href={destinations.firstDecision}>First decision</a>
        {showCreate ? (
          <a
            href={`/?view=signup&returnTo=${encodeURIComponent(destinations.firstDecision)}`}
          >
            Create a workspace
          </a>
        ) : null}
        {selfServe ? (
          <a
            className="journey-header-quiet"
            href={selfServe.href}
            data-testid="self-serve-nav-step"
            data-leaves-product={selfServe.leavesProduct ? "true" : "false"}
            onClick={(event) => {
              if (selfServe.href !== "#spine-save-workspace") return;
              const save = document.getElementById("spine-save-workspace");
              if (!(save instanceof HTMLButtonElement) || save.disabled) return;
              event.preventDefault();
              save.click();
            }}
          >
            {selfServe.label}
          </a>
        ) : (
          <a className="journey-header-quiet" href={TALK_TO_US_HREF}>
            Talk to us
          </a>
        )}
      </nav>
    </header>
  );
}
