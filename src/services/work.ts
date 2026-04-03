import { supabase } from '../lib/supabase';

export interface WorkBacklogSummary {
  open_work_order_count: number;
  overdue_count: number;
  critical_count: number;
  avg_age_days: number;
}

export const workService = {
  async getBacklogSummary(
    organizationId: string,
    siteId?: string
  ): Promise<WorkBacklogSummary | null> {
    try {
      const { data, error } = await supabase.rpc('get_work_backlog_summary', {
        p_organization_id: organizationId,
        p_site_id: siteId || null
      });

      if (error) {
        console.error('Error fetching work backlog:', error);
        return null;
      }

      return data?.[0] || null;
    } catch (error) {
      console.error('Exception fetching work backlog:', error);
      return null;
    }
  },

  async getWorkOrders(organizationId: string, siteId?: string, status?: string) {
    try {
      let query = supabase
        .from('work_orders')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });

      if (siteId) {
        query = query.eq('site_id', siteId);
      }

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching work orders:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Exception fetching work orders:', error);
      return [];
    }
  },

  async getNotifications(organizationId: string, siteId?: string) {
    try {
      let query = supabase
        .from('notifications')
        .select('*')
        .eq('organization_id', organizationId)
        .order('reported_at', { ascending: false })
        .limit(50);

      if (siteId) {
        query = query.eq('site_id', siteId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching notifications:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Exception fetching notifications:', error);
      return [];
    }
  }
};
