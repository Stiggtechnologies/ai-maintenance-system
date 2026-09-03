import { ClipboardCheck, Compass, Home, LogIn, Plus } from "lucide-react";

type PublicAskRailProps = {
  homeActive: boolean;
  onHome: () => void;
  assessHref?: string;
  signInHref?: string;
  onSignIn?: () => void;
};

/**
 * Bolt icon rail. Top compass is visual Bolt chrome only — not Discover.
 * `+` and Home start a new Mode A ask. Assess (/setup) and Sign in are
 * live. Discover / Spaces / Install stay hidden — no product behind them.
 * One nav: column on desktop, bottom tabs on small screens.
 */
export function PublicAskRail({
  homeActive,
  onHome,
  assessHref = "/setup",
  signInHref = "/signin?returnTo=%2F",
  onSignIn,
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
      </div>
      <div className="bolt-rail-foot">
        <a className="bolt-rail-item" href={assessHref} aria-label="Assess">
          <ClipboardCheck size={20} />
          Assess
        </a>
        <a
          className="bolt-rail-item"
          href={signInHref}
          aria-label="Sign in"
          onClick={onSignIn}
        >
          <LogIn size={20} />
          Sign in
        </a>
      </div>
    </nav>
  );
}
