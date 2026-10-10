import { Moon, Sun } from "lucide-react";
import { BrandWordmark } from "./BrandWordmark";
import {
  publicAuthJourneySearch,
  publicJourneyPath,
} from "../lib/public-journey-context";
import "./public-journey.css";

export function PublicJourneyThemeToggle({
  theme,
  onToggle,
}: {
  theme: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="journey-theme-toggle"
      aria-label={theme === "dark" ? "Use light mode" : "Use dark mode"}
      onClick={onToggle}
    >
      {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

export function PublicJourneyHeader({
  theme,
  onToggle,
  search = window.location.search,
}: {
  theme: string;
  onToggle: () => void;
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
      <PublicJourneyThemeToggle theme={theme} onToggle={onToggle} />
    </header>
  );
}
