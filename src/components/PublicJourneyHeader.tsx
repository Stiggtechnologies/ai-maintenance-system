import { BrandWordmark } from "./BrandWordmark";
import { publicDecisionJourneyPaths } from "../lib/public-journey-context";
import "./public-journey.css";

export function PublicJourneyHeader({
  search = window.location.search,
}: {
  search?: string;
}) {
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
        <a href="https://syncai.ca/contact">Discuss purchasing</a>
      </nav>
    </header>
  );
}
