import { supabase } from "./supabase";
import type { User } from "@supabase/supabase-js";

export interface SignUpData {
  email: string;
  password: string;
  fullName: string;
  company: string;
  role: string;
  industry: string;
}

export interface AuthError {
  message: string;
  code?: string;
}

export interface SignUpResult {
  success: boolean;
  requiresConfirmation?: boolean;
  error?: AuthError;
}

/** Authentication source for the current user session */
export type AuthSource = "email" | "azure_ad" | "google";

export function resolveAuthSource(user: User): AuthSource {
  const provider = user.app_metadata?.provider;
  const providers = Array.isArray(user.app_metadata?.providers)
    ? user.app_metadata.providers
    : [];
  const identities =
    user.identities?.map((identity) => identity.provider) ?? [];
  if (
    provider === "azure" ||
    providers.includes("azure") ||
    identities.includes("azure")
  ) {
    return "azure_ad";
  }
  if (
    provider === "google" ||
    providers.includes("google") ||
    identities.includes("google")
  ) {
    return "google";
  }
  return "email";
}

/** Resolve identity provenance only from the Auth server's verified user. */
export async function getAuthSource(): Promise<AuthSource | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return resolveAuthSource(data.user);
}

/** True only when the Auth server verifies a federated Microsoft identity. */
export async function isEnterpriseFederatedUser(): Promise<boolean> {
  const provider = await getAuthSource();
  return provider === "azure_ad";
}

/**
 * A valid identity session is not itself customer-workspace authorization.
 * Access requires the canonical profile to be bound to an organization.
 */
export async function hasWorkspaceMembership(userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("id, organization_id")
      .eq("id", userId)
      .maybeSingle();
    if (error || data?.id !== userId || !data.organization_id) return false;
    const { data: entitlement, error: entitlementError } = await supabase.rpc(
      "get_current_workspace_entitlement",
    );
    return (
      !entitlementError &&
      Boolean(
        entitlement &&
        typeof entitlement === "object" &&
        "authorized" in entitlement &&
        entitlement.authorized === true,
      )
    );
  } catch {
    return false;
  }
}

export async function signUp(data: SignUpData): Promise<SignUpResult> {
  try {
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          full_name: data.fullName,
          company: data.company,
          requested_role: data.role,
          industry: data.industry,
          self_signup: "true",
          workspace_kind: "evaluation",
        },
      },
    });

    if (authError) {
      return {
        success: false,
        error: {
          message: authError.message,
          code: authError.status?.toString(),
        },
      };
    }

    if (!authData.user) {
      return {
        success: false,
        error: { message: "Failed to create user account" },
      };
    }

    return { success: true, requiresConfirmation: !authData.session };
  } catch {
    return {
      success: false,
      error: { message: "An unexpected error occurred" },
    };
  }
}

export async function signIn(
  email: string,
  password: string,
): Promise<{ success: boolean; error?: AuthError }> {
  try {
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      if (signInError.message.includes("Invalid login credentials")) {
        return {
          success: false,
          error: {
            message:
              "We couldn't verify your credentials. Please confirm or contact your administrator.",
            code: signInError.status?.toString(),
          },
        };
      }
      return {
        success: false,
        error: {
          message:
            typeof signInError.message === "string" &&
            signInError.message.trim().length > 2
              ? signInError.message
              : "Sign-in is temporarily unavailable. Please try again in a moment.",
          code: signInError.status?.toString(),
        },
      };
    }
    return { success: true };
  } catch {
    return {
      success: false,
      error: { message: "An unexpected error occurred" },
    };
  }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export async function getUserProfile() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile, error } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !profile) return null;
  return profile;
}
