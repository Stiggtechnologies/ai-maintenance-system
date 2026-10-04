import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  boundedProviderDetail,
  inviteAuthority,
  mayRollbackFreshInvite,
  normalizeInviteRequest,
  providerFailureReceipt,
} from "../_shared/decision-case-invite-core.ts";

const origin = Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";
const cors = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function bearerAal(header: string): string {
  const token = header.replace(/^Bearer\s+/i, "");
  const part = token.split(".")[1];
  if (!part) return "";
  try {
    const padded = part.replaceAll("-", "+").replaceAll("_", "/");
    const decoded = JSON.parse(
      atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "=")),
    ) as { aal?: unknown };
    return String(decoded.aal ?? "");
  } catch {
    return "";
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: cors });
  if (request.method !== "POST")
    return response({ error: "method not allowed" }, 405);

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization) return response({ error: "not authenticated" }, 401);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !anonKey || !serviceKey) {
    return response({ error: "invitation service is not configured" }, 503);
  }

  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user) {
    return response({ error: "not authenticated" }, 401);
  }

  let input;
  try {
    input = normalizeInviteRequest(await request.json());
  } catch (error) {
    return response(
      { error: error instanceof Error ? error.message : "invalid request" },
      400,
    );
  }

  if (input.action === "status") {
    const { data, error } = await caller.rpc(
      "get_decision_case_invitation_status",
      { p_case_id: input.decisionCaseId },
    );
    const receipt = (data ?? {}) as Record<string, unknown>;
    if (error || receipt.error) {
      return response(
        {
          error: String(
            receipt.error ?? error?.message ?? "status unavailable",
          ),
        },
        error ? 500 : 404,
      );
    }
    const invitedUserId =
      typeof receipt.invitedUserId === "string" ? receipt.invitedUserId : "";
    const status = String(receipt.status ?? "submitted");
    if (invitedUserId && (status === "submitted" || status === "accepted")) {
      const { data: observed, error: observationError } = await admin.rpc(
        "observe_decision_case_invitation",
        { p_actor_id: authData.user.id, p_case_id: input.decisionCaseId },
      );
      const observation = (observed ?? {}) as Record<string, unknown>;
      if (observationError || observation.error) {
        return response(
          {
            error: String(
              observation.error ??
                observationError?.message ??
                "invitation acceptance could not be verified",
            ),
          },
          500,
        );
      }
      return response(observation);
    }
    return response({ ...receipt, lastCheckedAt: new Date().toISOString() });
  }

  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("organization_id, role")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError || !profile?.organization_id) {
    return response({ error: "tenant profile not found" }, 403);
  }
  const authority = inviteAuthority(profile.role, bearerAal(authorization));
  if (!authority.allowed) return response({ error: authority.reason }, 403);

  const { data: decisionCase, error: caseError } = await admin
    .from("cowork_workspaces")
    .select("id")
    .eq("id", input.decisionCaseId)
    .eq("organization_id", profile.organization_id)
    .not("case_number", "is", null)
    .maybeSingle();
  if (caseError || !decisionCase) {
    return response(
      { error: "saved Decision Case not found in the active tenant" },
      404,
    );
  }

  const { data: matchingProfiles, error: existingError } = await admin
    .from("user_profiles")
    .select("id, organization_id")
    .ilike("email", input.email);
  if (existingError)
    return response({ error: "member directory lookup failed" }, 500);
  if (
    matchingProfiles?.some(
      (candidate) => candidate.organization_id !== profile.organization_id,
    )
  ) {
    return response(
      { error: "that identity already belongs to another tenant" },
      409,
    );
  }
  const existing = matchingProfiles?.find(
    (candidate) => candidate.organization_id === profile.organization_id,
  );

  const register = async (
    invitedUserId: string | null,
    status: "submitted" | "already_member" | "failed",
    detail: string,
  ) => {
    const { data, error } = await admin.rpc(
      "register_decision_case_invitation",
      {
        p_actor_id: authData.user.id,
        p_organization_id: profile.organization_id,
        p_case_id: input.decisionCaseId,
        p_invited_user_id: invitedUserId,
        p_email: input.email,
        p_name: input.name,
        p_delivery_status: status,
        p_detail: detail,
      },
    );
    const payload = (data ?? {}) as Record<string, unknown>;
    if (error || payload.error) {
      throw new Error(
        String(payload.error ?? error?.message ?? "receipt write failed"),
      );
    }
    return payload;
  };

  if (existing) {
    return response(
      await register(
        existing.id,
        "already_member",
        "The named identity is already a member of this tenant; no new email was sent.",
      ),
    );
  }

  const redirectTo = `${origin.replace(/\/$/, "")}/signin?returnTo=/start`;
  const { data: invited, error: inviteError } =
    await admin.auth.admin.inviteUserByEmail(input.email, {
      data: { full_name: input.name, syncai_invitation: "decision_case" },
      redirectTo,
    });
  if (inviteError || !invited.user) {
    console.error(
      "decision-case-invite provider refusal:",
      boundedProviderDetail(inviteError?.message),
    );
    const detail = providerFailureReceipt();
    const { data: recovered } = await admin
      .from("user_profiles")
      .select("id")
      .eq("organization_id", profile.organization_id)
      .ilike("email", input.email)
      .maybeSingle();
    if (recovered?.id) {
      return response(
        await register(
          recovered.id,
          "already_member",
          "The named identity became a member of this tenant while the invitation was being processed; no additional email was recorded.",
        ),
      );
    }
    try {
      return response(await register(null, "failed", detail));
    } catch {
      return response({ error: detail }, 400);
    }
  }

  try {
    return response(
      await register(
        invited.user.id,
        "submitted",
        "Secure invitation submitted to the configured Auth email provider; delivery and acceptance are not yet confirmed.",
      ),
    );
  } catch (error) {
    console.error(
      "decision-case-invite tenant registration failure:",
      boundedProviderDetail(error instanceof Error ? error.message : error),
    );
    let rolledBack = false;
    if (mayRollbackFreshInvite(invited.user)) {
      const { error: rollbackError } = await admin.auth.admin.deleteUser(
        invited.user.id,
      );
      if (rollbackError) {
        console.error(
          "decision-case-invite rollback failure:",
          boundedProviderDetail(rollbackError.message),
        );
      } else {
        rolledBack = true;
      }
    } else {
      console.error(
        "decision-case-invite refused destructive rollback for a non-fresh or accepted identity",
      );
    }
    return response(
      {
        error: rolledBack
          ? "Invitation could not be attached to the tenant and the fresh invite identity was rolled back. Review the protected function log before retrying."
          : "Invitation could not be attached to the tenant. No acceptance state was recorded; an administrator must review the protected function log.",
      },
      500,
    );
  }
});
