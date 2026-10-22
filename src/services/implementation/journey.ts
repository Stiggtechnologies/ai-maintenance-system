/** Commands are user-initiated. Never automatically replay after a transport failure. */
export type ImplementationAction =
  "start" | "configure" | "prepare" | "result" | "accept" | "pause" | "resume";
export interface ImplementationCommand {
  commandId: string;
  billingId: string;
  instanceId: string | null;
  revision: number;
  action: ImplementationAction;
  payload: Record<string, unknown>;
}
export function createImplementationCommand(
  intent: Omit<ImplementationCommand, "commandId">,
  commandId: string = crypto.randomUUID(),
): ImplementationCommand {
  return { ...intent, payload: structuredClone(intent.payload), commandId };
}
export function reconcileImplementation(
  command: ImplementationCommand,
  receipt: { commandId: string; instanceId: string; revision: number },
): boolean {
  return (
    receipt.commandId === command.commandId &&
    (command.instanceId === null ||
      receipt.instanceId === command.instanceId) &&
    receipt.revision >= command.revision
  );
}
export function implementationStep(phase: string, current: boolean): string {
  if (phase === "paused")
    return "Paused; evidence and imported records are retained.";
  if (phase === "failed")
    return "Preparation failed; review the error and resume the same scope.";
  if (phase === "accepted" && current)
    return "Customer accepted implementation; training and support handoff retained.";
  if ((phase === "accepted" || phase === "result_reviewed") && !current)
    return "Source standing changed; revalidate and obtain fresh customer acceptance.";
  if (phase === "result_reviewed")
    return "Record customer acceptance, training and support handoff evidence.";
  if (phase === "prepared")
    return "Complete asset approval and review an evidence-backed first result.";
  return "Select customer assets and review authorized data mapping.";
}
