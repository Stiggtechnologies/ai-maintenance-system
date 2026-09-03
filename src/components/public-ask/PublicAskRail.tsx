import {
  ClipboardCheck,
  Compass,
  Home,
  Layers,
  LogIn,
  Plus,
} from "lucide-react";

type PublicAskRailProps = {
  homeActive: boolean;
  onHome: () => void;
  assessHref?: string;
  signInHref?: string;
  onSignIn?: () => void;
  /**
   * Bolt Spaces = existing cowork / Decision Workspace threads.
   * Omit on public anonymous — no real destination. Signed-in Mode A/B
   * passes this so the rail does not hide a live store.
   */
  spaces?: {
    active?: boolean;
    onOpen: () => void;
  };
};

/**
 * Bolt icon rail. Top compass is visual Bolt chrome only — not Discover.
 * `+` and Home start a new Mode A ask. Assess (/setup) is live.
 * Discover stays hidden (Bolt clicks changed no view). Install omitted
 * on web. Spaces appears only when `spaces` is passed — that is the
 * existing cowork list at /decision-cases, not a new /spaces page.
 * One nav: column on desktop, bottom tabs on small screens.
 */
export function PublicAskRail({
  homeActive,
  onHome,
  assessHref = "/setup",
  signInHref = "/signin?returnTo=%2F",
  onSignIn,
  spaces,
}: PublicAskRailProps) {
  return (
    <nav className="bolt-rail" aria-label="Workspace">
      <div className="bolt-rail-top">
        <span
          className="bolt-rail-mark"
          data-testid="bolt-rail-compass"
          aria-hidden="true"
        >
          <Compass size={20} />
        </span>
        <button
          type="button"
          className="bolt-rail-item"
          aria-label="New ask"
          onClick={onHome}
        >
          <Plus size={20} />
        </button>
      </div>
      <div className="bolt-rail-main">
        <button
          type="button"
          className={`bolt-rail-item${homeActive ? " is-active" : ""}`}
          aria-label="Home"
          aria-current={homeActive ? "page" : undefined}
          onClick={onHome}
        >
          <Home size={20} />
          Home
        </button>
        {spaces ? (
          <button
            type="button"
            className={`bolt-rail-item${spaces.active ? " is-active" : ""}`}
            aria-label="Spaces"
            aria-expanded={spaces.active}
            data-testid="bolt-rail-spaces"
            onClick={spaces.onOpen}
          >
            <Layers size={20} />
            Spaces
          </button>
        ) : null}
      </div>
      <div className="bolt-rail-foot">
        <a className="bolt-rail-item" href={assessHref} aria-label="Assess">
          <ClipboardCheck size={20} />
          Assess
        </a>
        {spaces ? null : (
          <a
            className="bolt-rail-item"
            href={signInHref}
            aria-label="Sign in"
            onClick={onSignIn}
          >
            <LogIn size={20} />
            Sign in
          </a>
        )}
      </div>
    </nav>
  );
}
