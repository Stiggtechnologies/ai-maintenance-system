import { Plus } from "lucide-react";
import { BOLT_SPACES_LIVE_PATH } from "../../lib/public-ask-tie-in";

export type BoltSpaceRow = {
  id: string;
  title: string;
  asset?: string;
};

type BoltSpacesPanelProps = {
  cases: BoltSpaceRow[];
  activeId?: string;
  onNewAsk: () => void;
  onChoose: (id: string) => void;
};

/**
 * Bolt Spaces list = existing cowork / Decision Workspace threads.
 * Not a /spaces page. The live signed-in destination remains /decision-cases.
 */
export function BoltSpacesPanel({
  cases,
  activeId,
  onNewAsk,
  onChoose,
}: BoltSpacesPanelProps) {
  return (
    <aside className="dw-rail bolt-spaces-panel" aria-label="Space list">
      <button type="button" className="dw-new" onClick={onNewAsk}>
        <Plus size={16} /> New ask
      </button>
      <div className="dw-section-label">Spaces</div>
      <div className="dw-case-list">
        {cases.map((item) => (
          <button
            type="button"
            key={item.id}
            className={`dw-case-row ${item.id === activeId ? "active" : ""}`}
            onClick={() => onChoose(item.id)}
          >
            <span>
              <strong>{item.title}</strong>
              {item.asset ? <small>{item.asset}</small> : null}
            </span>
          </button>
        ))}
      </div>
      <a className="bolt-spaces-live" href={BOLT_SPACES_LIVE_PATH}>
        Decision Workspace
      </a>
    </aside>
  );
}
