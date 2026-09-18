import { ClipboardCheck, Home, Layers, LogIn, Plus } from "lucide-react";

type PublicAskRailProps = {
  homeActive: boolean;
  onNewAsk: () => void;
  assessHref?: string;
  signInHref?: string;
  onSignIn?: () => void;
  /**
   * Bolt Spaces = existing cowork threads of any intent on /workspace.
   * Omit on public anonymous. Not the Develop case list. Not DraftBanner.
   */
  spaces?: {
    active?: boolean;
    onOpen: () => void;
  };
};

/**
 * Bolt icon rail. `+` starts a new Mode A ask; Home returns to the public
 * product entry. Assess (/setup) and Sign in are live destinations.
 * Discover stays hidden (Bolt clicks changed no view). Install omitted
 * on web. Spaces appears only when `spaces` is passed — cowork threads
 * on /workspace, not /develop and not a new /spaces page.
 * One nav: column on desktop, bottom tabs on small screens.
 */
export function PublicAskRail({
  homeActive,
  onNewAsk,
  assessHref = "/setup",
  signInHref = "/signin?returnTo=%2F",
  onSignIn,
  spaces,
}: PublicAskRailProps) {
  return (
    <nav className="bolt-rail" aria-label="Workspace">
      <div className="bolt-rail-top">
        <button
          type="button"
          className="bolt-rail-item"
          aria-label="New ask"
          onClick={onNewAsk}
        >
          <Plus size={20} />
        </button>
      </div>
      <div className="bolt-rail-main">
        <a
          href="/"
          className={`bolt-rail-item${homeActive ? " is-active" : ""}`}
          aria-label="Home"
          aria-current={homeActive ? "page" : undefined}
        >
          <Home size={20} />
          Home
        </a>
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
