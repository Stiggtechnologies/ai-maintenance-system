import { supabase } from '../lib/supabase';

export interface OEEData {
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  measurement_count: number;
}

export interface KPIValue {
  kpi_code: string;
  kpi_name: string;
  value: number;
  unit: string;
  measurement_time: string;
}

export const performanceService = {
  async calculateSiteOEE(
    siteId: string,
    startTime?: string,
    endTime?: string
  ): Promise<OEEData | null> {
    try {
      const { data, error } = await supabase.rpc('calculate_site_oee', {
        p_site_id: siteId,
        p_start_time: startTime || null,
        p_end_time: endTime || null
      });

      if (error) {
        console.error('Error calculating OEE:', error);
        return null;
      }

      return data?.[0] || null;
    } catch (error) {
      console.error('Exception calculating OEE:', error);
      return null;
    }
  },

  async getLatestKPIValues(
    organizationId: string,
    siteId?: string
  ): Promise<KPIValue[]> {
    try {
      const { data, error } = await supabase.rpc('get_latest_kpi_values', {
        p_organization_id: organizationId,
        p_site_id: siteId || null
      });

      if (error) {
        console.error('Error fetching KPI values:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Exception fetching KPI values:', error);
      return [];
    }
  }
};
