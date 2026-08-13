export function resolveSupabasePublicKey(
  _url: string,
  publishableKey: string,
  legacyAnonKey: string,
): string {
  if (publishableKey.trim()) return publishableKey.trim();
  return legacyAnonKey.trim();
}

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "";
export const supabasePublicKey = resolveSupabasePublicKey(
  supabaseUrl,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
  import.meta.env.VITE_SUPABASE_ANON_KEY || "",
);
