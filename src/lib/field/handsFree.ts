/**
 * Hands-free field mode: pure helpers behind /field?mode=hands-free.
 *
 * Built for head-worn devices (RealWear Navigator, Vuzix M400) and gloved
 * phone use. Two jobs, both pure so they can be tested without a browser:
 *
 * 1. parseFieldVoice: decide whether a spoken phrase is a short command
 *    ("send report", "fault", "clear") or dictated observation text. Commands
 *    must match the whole phrase, so an observation that merely contains the
 *    word "fault" is never swallowed as a command.
 *
 * 2. fieldFilingOutcome: say plainly whether a turn can be filed as a
 *    governed maintenance notification, and why not when it cannot. The page
 *    used to show a sent turn even when nothing was filed; a technician on a
 *    headset cannot see the database, so the page must say what happened.
 *
 * Photo capture is deliberately not a voice command. Browsers only open the
 * camera from a real tap; RealWear's voice control performs a real tap on a
 * button whose visible label is spoken, so the page shows "Take photo" as a
 * labelled button instead of pretending speech can open the camera.
 */

export type FieldNotificationType = "fault" | "observation" | "safety";

export type FieldVoiceAction =
  | { kind: "send" }
  | { kind: "clear" }
  | { kind: "set-type"; value: FieldNotificationType }
  | { kind: "dictation"; text: string };

const COMMANDS: Record<string, Exclude<FieldVoiceAction, { kind: "dictation" }>> = {
  "send": { kind: "send" },
  "send report": { kind: "send" },
  "file report": { kind: "send" },
  "submit report": { kind: "send" },
  "clear": { kind: "clear" },
  "clear report": { kind: "clear" },
  "fault": { kind: "set-type", value: "fault" },
  "type fault": { kind: "set-type", value: "fault" },
  "observation": { kind: "set-type", value: "observation" },
  "type observation": { kind: "set-type", value: "observation" },
  "safety": { kind: "set-type", value: "safety" },
  "type safety": { kind: "set-type", value: "safety" },
};

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseFieldVoice(text: string): FieldVoiceAction {
  const command = COMMANDS[normalise(text)];
  if (command) return command;
  return { kind: "dictation", text: text.trim() };
}

/** Asset ids are UUIDs; a QR label carries /assets/<id>. Tags like T301 are not ids. */
export function isAssetId(value: string | null | undefined): value is string {
  return Boolean(value && /^[0-9a-f-]{16,}$/i.test(value));
}

export type FieldFilingOutcome =
  | { fileable: true }
  | { fileable: false; reason: string };

export function fieldFilingOutcome(input: {
  asset: string | null;
  text: string;
}): FieldFilingOutcome {
  const text = input.text.trim();
  if (!input.asset) {
    return {
      fileable: false,
      reason:
        "Not filed. Add the asset first: enter the ID or link from its QR label, so this is raised against the right equipment.",
    };
  }
  if (!isAssetId(input.asset)) {
    return {
      fileable: false,
      reason: `Not filed. "${input.asset}" is a tag, not an asset ID. Enter the ID or link from its QR label instead.`,
    };
  }
  // raise_maintenance_notification refuses descriptions under 5 characters.
  if (text.length < 5) {
    return {
      fileable: false,
      reason: "Not filed. Say or type what you observed, then send.",
    };
  }
  return { fileable: true };
}

export function filedMessage(input: {
  notificationId: string;
  type: FieldNotificationType;
  withPhoto: boolean;
}): string {
  const photo = input.withPhoto ? " with photo" : "";
  return `Filed as a ${input.type} notification${photo} (${input.notificationId}). It stays open until a person screens it; nothing becomes a work order automatically.`;
}
