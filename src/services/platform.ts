import { supabase } from "../lib/supabase";

export interface UserContext {
  user_id: string;
  email: string;
  full_name: string | null;
  organization_id: string;
  organization_name: string;
  default_site_id: string | null;
  roles: Array<{
    code: string;
    name: string;
    level: string;
  }>;
  permissions: Record<string, unknown>[];
}

export const platformService = {
  async getCurrentUserContext(): Promise<UserContext | null> {
    try {
      // Try RPC first
      const { data, error } = await supabase.rpc("get_current_user_context");

      if (!error && data?.[0]) {
        return data[0];
      }

      // Fallback: build context from auth + user_profiles
      console.warn("get_current_user_context RPC unavailable, using fallback");
      return await this.getFallbackUserContext();
    } catch (error) {
      console.error("Exception fetching user context:", error);
      // Try fallback
      try {
        return await this.getFallbackUserContext();
      } catch {
        return null;
      }
    }
  },

  async getFallbackUserContext(): Promise<UserContext | null> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    // Get profile
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    // Get organization name
    let orgName = "My Organization";
    if (profile?.organization_id) {
      const { data: org } = await supabase
        .from("organizations")
        .select("name")
        .eq("id", profile.organization_id)
        .maybeSingle();
      if (org?.name) orgName = org.name;
    }

    // Try to get roles
    let roles: { code: string; name: string; level: string }[] = [];
    try {
      const { data: roleAssignments } = await supabase
        .from("user_role_assignments")
        .select("roles(code, name, level)")
        .eq("user_id", user.id);
      if (roleAssignments?.length) {
        roles = roleAssignments.map((ra: Record<string, unknown>) => {
          const r = ra.roles as Record<string, unknown>;
          return {
            code: String(r?.code || "user"),
            name: String(r?.name || "User"),
            level: String(r?.level || "executive"),
          };
        });
      }
    } catch {
      // roles table may not exist
    }

    // Default to executive if no roles found (show all features)
    if (!roles.length) {
      roles = [{ code: "admin", name: "Administrator", level: "executive" }];
    }

    return {
      user_id: user.id,
      email: user.email || "",
      full_name: profile?.full_name || user.user_metadata?.full_name || null,
      organization_id: profile?.organization_id || "",
      organization_name: orgName,
      default_site_id: profile?.default_site_id || null,
      roles,
      permissions: [],
    };
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },
};
