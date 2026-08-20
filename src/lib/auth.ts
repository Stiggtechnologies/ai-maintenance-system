import { supabase } from "./supabase";

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
export type AuthSource = "email" | "azure_ad" | "google" | "marketplace";

export function getAuthSource(): AuthSource {
  void supabase.auth.getSession();
  if (sessionStorage.getItem("marketplace_subscription_id")) return "marketplace";
  const provider = sessionStorage.getItem("auth_provider");
  if (provider === "azure") return "azure_ad";
  if (provider === "google") return "google";
  return "email";
}

export function isMarketplaceUser(): boolean {
  return getAuthSource() === "marketplace" || getAuthSource() === "azure_ad";
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
        error: { message: authError.message, code: authError.status?.toString() },
      };
    }

    if (!authData.user) {
      return { success: false, error: { message: "Failed to create user account" } };
    }

    return { success: true, requiresConfirmation: !authData.session };
  } catch {
    return { success: false, error: { message: "An unexpected error occurred" } };
  }
}

export async function signIn(
  email: string,
  password: string,
): Promise<{ success: boolean; error?: AuthError }> {
  try {
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      if (signInError.message.includes("Invalid login credentials")) {
        return {
          success: false,
          error: {
            message: "We couldn't verify your credentials. Please confirm or contact your administrator.",
            code: signInError.status?.toString(),
          },
        };
      }
      return {
        success: false,
        error: {
          message:
            typeof signInError.message === "string" && signInError.message.trim().length > 2
              ? signInError.message
              : "Sign-in is temporarily unavailable. Please try again in a moment.",
          code: signInError.status?.toString(),
        },
      };
    }
    return { success: true };
  } catch {
    return { success: false, error: { message: "An unexpected error occurred" } };
  }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

export async function getUserProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile, error } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  if (error || !profile) return null;
  return profile;
}
