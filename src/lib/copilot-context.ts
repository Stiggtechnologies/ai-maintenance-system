/**
 * Ephemeral copilot grounding.
 *
 * The copilot normally grounds answers in the live organisation's KPIs. A
 * prospect who has uploaded a file and onboarded nothing has no live
 * organisation worth grounding in — without this the agent would answer
 * questions about their spreadsheet using someone else's fleet.
 *
 * Module state rather than React context because the dock is mounted once at
 * the app shell, far from whatever page produced the dataset. Kept out of the
 * component file so the module exports functions, not a mix.
 */
let ephemeral: string | null = null;

/** Pass null to hand grounding back to the live organisation. */
export function setCopilotEphemeralContext(ctx: string | null) {
  ephemeral = ctx;
}

export function getCopilotEphemeralContext(): string | null {
  return ephemeral;
}
