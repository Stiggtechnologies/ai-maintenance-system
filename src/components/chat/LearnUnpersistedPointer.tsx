import { Link } from "react-router-dom";

/**
 * Visible fail when conversation LEARN cannot persist — anonymous session,
 * no open recommendation-scoped obligation, or a bound recommendation with
 * nothing to record against. Do not render a recorder that can look like it
 * persisted. Learning Loop remains available; ConversationLearn is the
 * in-thread write path when an obligation can be resolved.
 */
export function LearnUnpersistedPointer() {
  return (
    <aside className="dw-learn" data-testid="learn-unpersisted">
      <p>
        This conversation has no verification obligation, so nothing was
        written.
      </p>
      <p>
        Record achieved / not_achieved / inconclusive on{" "}
        <Link to="/learning-loop">Learning Loop</Link>.
      </p>
    </aside>
  );
}
