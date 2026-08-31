import { Link } from "react-router-dom";

/**
 * After Approve, Design wants LEARN in the thread. Honesty: this conversation
 * has no verification obligation and never calls record_verification_result.
 * Do not render a recorder that can look like it persisted. Point at Learning
 * Loop — that is the write path.
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
