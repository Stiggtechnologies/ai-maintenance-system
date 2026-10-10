import { BrandWordmark } from "./BrandWordmark";
import {
  publicAuthJourneySearch,
  publicJourneyPath,
} from "../lib/public-journey-context";
import "./public-journey.css";

export function PublicJourneyHeader({
  search = window.location.search,
}: {
  search?: string;
}) {
  const journeySearch = publicAuthJourneySearch(search, window.location.origin);
  return (
    <header className="journey-header">
      <a
        className="journey-brand"
        href={publicJourneyPath("/workspace", journeySearch)}
        aria-label="SyncAI workspace"
      >
        <BrandWordmark className="h-7" />
      </a>
      <nav aria-label="Public navigation">
        <a href={publicJourneyPath("/workspace", journeySearch)}>Assistant</a>
        <a href={publicJourneyPath("/get-started", journeySearch)}>
          First decision
        </a>
        <a href="https://syncai.ca/contact">Discuss purchasing</a>
      </nav>
    </header>
  );
}
