/**
 * Security event recorder (client side) — best-effort, fail-soft.
 * Writes through the record_security_event RPC (the only write path;
 * clients cannot insert or edit the log directly). Role changes are also
 * captured server-side by a trigger, so this layer is supplementary.
 */
import { supabase } from "./supabase";

type SecurityEventType =
  | "sign_in"
  | "sign_out"
  | "mfa_enrolled"
  | "mfa_removed"
  | "admin_action"
  | "access_denied"
  | "other";

export async function recordSecurityEvent(
  eventType: SecurityEventType,
  detail?: string,
  severity: "info" | "notice" | "warning" | "critical" = "info",
): Promise<void> {
  try {
    await supabase.rpc("record_security_event", {
      p_event_type: eventType,
      p_detail: detail ?? null,
      p_severity: severity,
      p_user_agent:
        typeof navigator !== "undefined" ? navigator.userAgent : null,
    });
  } catch {
    /* never let audit logging break the user flow */
  }
}
