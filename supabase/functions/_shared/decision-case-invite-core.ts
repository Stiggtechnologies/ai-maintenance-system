export type InviteAction = "invite" | "status";

export interface InviteRequest {
  action: InviteAction;
  decisionCaseId: string;
  name: string;
  email: string;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeInviteRequest(value: unknown): InviteRequest {
  const body =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const action = String(body.action ?? "").trim() as InviteAction;
  const decisionCaseId = String(body.decisionCaseId ?? "").trim();
  const name = String(body.name ?? "")
    .trim()
    .slice(0, 160);
  const email = String(body.email ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 320);
  if (action !== "invite" && action !== "status") {
    throw new Error("action must be invite or status");
  }
  if (!UUID.test(decisionCaseId)) {
    throw new Error("a saved Decision Case id is required");
  }
  if (action === "invite" && !EMAIL.test(email)) {
    throw new Error("a valid work email is required");
  }
  return { action, decisionCaseId, name, email };
}

export function inviteAuthority(
  role: unknown,
  aal: unknown,
): {
  allowed: boolean;
  reason: string;
} {
  const normalizedRole = String(role ?? "")
    .trim()
    .toLowerCase();
  if (!["admin", "executive"].includes(normalizedRole)) {
    return {
      allowed: false,
      reason:
        "workspace invitation requires a same-tenant administrator or executive",
    };
  }
  if (
    String(aal ?? "")
      .trim()
      .toLowerCase() !== "aal2"
  ) {
    return {
      allowed: false,
      reason: "workspace invitation requires an AAL2 session",
    };
  }
  return { allowed: true, reason: "authorized named human" };
}

export function invitationLifecycle(
  user: {
    email_confirmed_at?: string | null;
    confirmed_at?: string | null;
    last_sign_in_at?: string | null;
  } | null,
): "submitted" | "accepted" | "active" {
  if (user?.last_sign_in_at) return "active";
  if (user?.email_confirmed_at || user?.confirmed_at) return "accepted";
  return "submitted";
}

export function boundedProviderDetail(value: unknown): string {
  const detail = String(value ?? "Invitation provider returned no detail.")
    .replaceAll(/[\r\n\t]+/g, " ")
    .trim();
  return detail.slice(0, 300) || "Invitation provider returned no detail.";
}

export function providerFailureReceipt(): string {
  return "The invitation provider refused the request. A tenant administrator must review the protected function log and Auth email configuration.";
}

export function mayRollbackFreshInvite(
  user: {
    created_at?: string | null;
    email_confirmed_at?: string | null;
    confirmed_at?: string | null;
    last_sign_in_at?: string | null;
  } | null,
  nowMs = Date.now(),
): boolean {
  if (
    !user?.created_at ||
    user.email_confirmed_at ||
    user.confirmed_at ||
    user.last_sign_in_at
  ) {
    return false;
  }
  const createdMs = Date.parse(user.created_at);
  return (
    Number.isFinite(createdMs) &&
    createdMs <= nowMs + 60_000 &&
    nowMs - createdMs <= 5 * 60_000
  );
}
