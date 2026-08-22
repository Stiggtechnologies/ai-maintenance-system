export type SyncNotificationType =
  "safety" | "fault" | "observation" | "request";

const EXPLICIT_TYPE_AFTER_ACTION =
  /\b(?:report|raise|log|record|create)\b\s+(?:(?:a|an|the|this)\s+)?(?:(?:maintenance\s+notification)(?:\s*[-–—:]\s*|\s+)|maintenance\s+)?(safety|fault|observation|request)\b/i;

/**
 * Classify the record type the user explicitly asked the governed action to
 * create. Descriptive prose later in the prompt must not override that choice:
 * for example, "create an observation; no fault exists" is still an
 * observation. A generic maintenance notification is conservatively treated
 * as an observation instead of inferring a stronger type from incidental text.
 */
export function notificationTypeFor(question: string): SyncNotificationType {
  const explicitType = question.match(EXPLICIT_TYPE_AFTER_ACTION)?.[1];
  if (!explicitType) return "observation";
  return explicitType.toLowerCase() as SyncNotificationType;
}
