import type { SpecificationFailureThread } from "../../services/developService";

export function SpecificationReverseHistory({
  thread,
}: {
  thread: SpecificationFailureThread;
}) {
  return (
    <section
      aria-label="Originating failure history"
      className="space-y-1 text-xs text-slate-300"
    >
      <h4 className="font-medium">Originating failure history</h4>
      {(thread.backward ?? []).map((mode) => (
        <p key={mode.failureMode}>
          {mode.failureMode}: {mode.occurrences} corrective work order(s) across{" "}
          {mode.assetsAffected} asset(s); {mode.requirementsReferencing}{" "}
          requirement reference(s).
        </p>
      ))}
      {thread.backwardNote && (
        <p className="text-slate-400">{thread.backwardNote}</p>
      )}
      {!!thread.backward?.length && (
        <p className="text-slate-400">
          A requirement reference establishes traceability, not proof that the
          failure has been prevented or the requirement verified.
        </p>
      )}
    </section>
  );
}
