import type { ReactNode } from "react";
import {
  BarChart3,
  FileCheck,
  GraduationCap,
  Heart,
  Wrench,
} from "lucide-react";
import {
  PUBLIC_ASK_INTENTS,
  type PublicAskIntentId,
} from "../../lib/public-ask-intents";

const PILL_ICONS: Record<PublicAskIntentId, ReactNode> = {
  compare: <BarChart3 size={15} />,
  troubleshoot: <Wrench size={15} />,
  health: <Heart size={15} />,
  learn: <GraduationCap size={15} />,
  "fact-check": <FileCheck size={15} />,
};

type PublicAskEmptyProps = {
  askBar: ReactNode;
  onSelectIntent: (seedIndex: number) => void;
};

export function PublicAskEmpty({
  askBar,
  onSelectIntent,
}: PublicAskEmptyProps) {
  return (
    <main className="bolt-empty" data-testid="first-paint-empty">
      <div className="bolt-brand">
        <h1 className="bolt-wordmark">SyncAI</h1>
        <span className="bolt-pro">pro</span>
      </div>
      {askBar}
      <div className="bolt-pills" role="list">
        {PUBLIC_ASK_INTENTS.map((intent) => (
          <button
            key={intent.id}
            type="button"
            className="bolt-pill"
            role="listitem"
            data-testid="ask-intent-pill"
            data-intent={intent.id}
            data-seed-index={String(intent.seedIndex)}
            aria-label={intent.label}
            onClick={() => onSelectIntent(intent.seedIndex)}
          >
            {PILL_ICONS[intent.id]}
            {intent.label}
          </button>
        ))}
      </div>
    </main>
  );
}
