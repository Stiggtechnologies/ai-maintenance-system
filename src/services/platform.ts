import { supabase } from '../lib/supabase';

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
  permissions: any[];
}

export const platformService = {
  async getCurrentUserContext(): Promise<UserContext | null> {
    try {
      const { data, error } = await supabase.rpc('get_current_user_context');

      if (error) {
        console.error('Error fetching user context:', error);
        return null;
      }

      return data?.[0] || null;
    } catch (error) {
      console.error('Exception fetching user context:', error);
      return null;
    }
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }
};
