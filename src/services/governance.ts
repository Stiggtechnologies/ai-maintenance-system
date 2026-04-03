import { supabase } from '../lib/supabase';

export const governanceService = {
  async approveRecommendation(recommendationId: string, comments?: string) {
    try {
      const { data, error } = await supabase.rpc('approve_recommendation', {
        p_recommendation_id: recommendationId,
        p_comments: comments || null
      });

      if (error) {
        console.error('Error approving recommendation:', error);
        return { success: false, error: error.message };
      }

      return data;
    } catch (error: any) {
      console.error('Exception approving recommendation:', error);
      return { success: false, error: error.message };
    }
  },

  async rejectRecommendation(recommendationId: string, comments?: string) {
    try {
      const { data, error } = await supabase.rpc('reject_recommendation', {
        p_recommendation_id: recommendationId,
        p_comments: comments || null
      });

      if (error) {
        console.error('Error rejecting recommendation:', error);
        return { success: false, error: error.message };
      }

      return data;
    } catch (error: any) {
      console.error('Exception rejecting recommendation:', error);
      return { success: false, error: error.message };
    }
  },

  async getApprovals(organizationId: string, status?: string) {
    try {
      let query = supabase
        .from('approvals')
        .select('*, recommendations(*)')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching approvals:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Exception fetching approvals:', error);
      return [];
    }
  },

  async getAuditEvents(organizationId: string, limit = 100) {
    try {
      const { data, error } = await supabase
        .from('audit_events')
        .select('*')
        .eq('organization_id', organizationId)
        .order('event_time', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error fetching audit events:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Exception fetching audit events:', error);
      return [];
    }
  }
};
