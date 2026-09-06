import { Plus } from "lucide-react";

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
 * Bolt Spaces = cowork threads of any intent on /workspace.
 * Not a /spaces page, not the Develop case list, not DraftBanner.
 * New ask stays on /workspace (Home / +).
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
        {cases.length === 0 ? (
          <p className="bolt-spaces-empty">No cowork threads yet.</p>
        ) : (
          cases.map((item) => (
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
          ))
        )}
      </div>
    </aside>
  );
}
