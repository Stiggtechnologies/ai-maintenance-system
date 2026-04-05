// SyncAI Phase 3: Real Data Wiring
// Wires the app to the new Supabase schema (organizations, assets, KPIs, work orders)
// Priority pages: Overview, Assets, Work Orders, Performance

import { supabase } from '../lib/supabase';

// ============================================
// Data Services - Connect to New Schema
// ============================================

// Organization & Site Context
export const organizationService = {
  async getCurrentOrganization() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('organization_id, default_site_id')
      .eq('id', user.id)
      .single();
    
    if (!profile?.organization_id) return null;
    
    const { data: org } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', profile.organization_id)
      .single();
    
    return org;
  },
  
  async getSites(orgId: string) {
    const { data } = await supabase
      .from('sites')
      .select('*')
      .eq('organization_id', orgId)
      .order('name');
    return data || [];
  }
};

// Assets
export const assetService = {
  async getAssets(orgId: string, siteId?: string) {
    let query = supabase
      .from('assets')
      .select(`
        *,
        asset_classes (name),
        sites (name),
        asset_locations (name)
      `)
      .eq('organization_id', orgId);
    
    if (siteId) {
      query = query.eq('site_id', siteId);
    }
    
    const { data } = await query.order('name');
    return data || [];
  },
  
  async getAssetById(assetId: string) {
    const { data } = await supabase
      .from('assets')
      .select(`
        *,
        asset_classes (name),
        asset_locations (name),
        asset_criticality_profiles (*)
      `)
      .eq('id', assetId)
      .single();
    return data;
  },
  
  async getAssetCriticalitySummary(orgId: string) {
    const { data } = await supabase
      .from('asset_criticality_profiles')
      .select(`
        *,
        assets (name, asset_tag)
      `)
      .eq('organization_id', orgId)
      .order('total_criticality_score', { ascending: false });
    return data || [];
  }
};

// KPIs & Performance
export const kpiService = {
  async getKPIDefinitions() {
    const { data } = await supabase
      .from('kpi_definitions')
      .select('*')
      .eq('active', true)
      .order('category');
    return data || [];
  },
  
  async getKPIMeasurements(orgId: string, kpiId: string, days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const { data } = await supabase
      .from('kpi_measurements')
      .select('*')
      .eq('organization_id', orgId)
      .eq('kpi_definition_id', kpiId)
      .gte('measurement_time', startDate.toISOString())
      .order('measurement_time', { ascending: false });
    return data || [];
  },
  
  async getLatestKPIValues(orgId: string, siteId?: string) {
    let query = supabase
      .from('kpi_measurements')
      .select(`
        *,
        kpi_definitions (code, name, unit, category)
      `)
      .eq('organization_id', orgId)
      .order('measurement_time', { ascending: false });
    
    if (siteId) {
      query = query.eq('site_id', siteId);
    }
    
    const { data } = await query.limit(50);
    
    // Deduplicate to get latest per KPI
    const latestByKPI = new Map();
    data?.forEach(m => {
      if (!latestByKPI.has(m.kpi_definition_id)) {
        latestByKPI.set(m.kpi_definition_id, m);
      }
    });
    
    return Array.from(latestByKPI.values());
  }
};

// OEE
export const oeeService = {
  async getOEEDashboard(orgId: string, siteId?: string) {
    let query = supabase
      .from('oee_measurements')
      .select(`
        *,
        production_lines (code, name),
        sites (name)
      `)
      .eq('organization_id', orgId)
      .order('measurement_date', { ascending: false })
      .limit(100);
    
    if (siteId) {
      query = query.eq('site_id', siteId);
    }
    
    const { data } = await query;
    return data || [];
  },
  
  async getOEEByLine(orgId: string) {
    const { data } = await supabase
      .from('oee_measurements')
      .select(`
        production_line_id,
        production_lines (name),
        availability,
        performance,
        quality,
        oee,
        measurement_date
      `)
      .eq('organization_id', orgId)
      .order('measurement_date', { ascending: false });
    return data || [];
  },
  
  async getLossBreakdown(orgId: string, startDate: Date, endDate: Date) {
    const { data } = await supabase
      .from('oee_loss_events')
      .select(`
        *,
        oee_loss_categories (code, name),
        assets (name, asset_tag)
      `)
      .eq('organization_id', orgId)
      .gte('start_time', startDate.toISOString())
      .lte('start_time', endDate.toISOString())
      .order('duration_minutes', { ascending: false });
    return data || [];
  }
};

// Work Orders
export const workOrderService = {
  async getWorkOrders(orgId: string, filters?: {
    siteId?: string;
    assetId?: string;
    status?: string;
    priority?: string;
  }) {
    let query = supabase
      .from('work_orders')
      .select(`
        *,
        assets (name, asset_tag),
        sites (name),
        user_profiles!work_orders_assigned_to_fkey (full_name)
      `)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });
    
    if (filters?.siteId) query = query.eq('site_id', filters.siteId);
    if (filters?.assetId) query = query.eq('asset_id', filters.assetId);
    if (filters?.status) query = query.eq('status', filters.status);
    if (filters?.priority) query = query.eq('priority', filters.priority);
    
    const { data } = await query.limit(100);
    return data || [];
  },
  
  async getBacklogSummary(orgId: string, siteId?: string) {
    let query = supabase
      .from('backlog_snapshots')
      .select('*')
      .eq('organization_id', orgId)
      .order('snapshot_time', { ascending: false })
      .limit(1);
    
    if (siteId) {
      query = query.eq('site_id', siteId);
    }
    
    const { data } = await query;
    return data?.[0] || null;
  },
  
  async createWorkOrder(workOrder: any) {
    const { data, error } = await supabase
      .from('work_orders')
      .insert(workOrder)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
};

// Recommendations (AI Intelligence)
export const recommendationService = {
  async getRecommendations(orgId: string, filters?: {
    siteId?: string;
    assetId?: string;
    status?: string;
  }) {
    let query = supabase
      .from('recommendations')
      .select(`
        *,
        assets (name, asset_tag)
      `)
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false });
    
    if (filters?.siteId) query = query.eq('site_id', filters.siteId);
    if (filters?.assetId) query = query.eq('asset_id', filters.assetId);
    if (filters?.status) query = query.eq('status', filters.status);
    
    const { data } = await query.limit(50);
    return data || [];
  },
  
  async acceptRecommendation(recId: string) {
    const { data, error } = await supabase
      .from('recommendations')
      .update({ status: 'accepted' })
      .eq('id', recId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },
  
  async dismissRecommendation(recId: string) {
    const { data, error } = await supabase
      .from('recommendations')
      .update({ status: 'dismissed' })
      .eq('id', recId)
      .select()
      .single();
    
    if (error) throw error;
    return data;
  }
};

// Governance & Audit
export const governanceService = {
  async getPendingApprovals(orgId: string) {
    const { data } = await supabase
      .from('approvals')
      .select(`
        *,
        user_profiles!approvals_requested_by_fkey (full_name)
      `)
      .eq('organization_id', orgId)
      .eq('current_status', 'pending')
      .order('created_at', { ascending: false });
    return data || [];
  },
  
  async getAuditTrail(orgId: string, entityType?: string, days: number = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    let query = supabase
      .from('audit_events')
      .select('*')
      .eq('organization_id', orgId)
      .gte('created_at', startDate.toISOString())
      .order('created_at', { ascending: false });
    
    if (entityType) {
      query = query.eq('entity_type', entityType);
    }
    
    const { data } = await query.limit(100);
    return data || [];
  }
};

// ============================================
// Hook for Current User Context (replaces /api/platform/me)
// ============================================

export async function getUserContext() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  
  const { data: profile } = await supabase
    .from('user_profiles')
    .select(`
      *,
      organizations (name, slug, industry),
      user_role_assignments (
        roles (code, name, level)
      )
    `)
    .eq('id', user.id)
    .single();
  
  return profile;
}