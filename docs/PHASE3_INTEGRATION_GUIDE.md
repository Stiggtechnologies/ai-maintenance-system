# SyncAI Phase 3: Component Integration Guide

This document maps the new `syncaiDataService.ts` to existing components that need updating.

## New Data Service Location
`src/services/syncaiDataService.ts`

## Component Updates Needed

### 1. ExecutiveDashboard.tsx
**Current:** Queries `user_kpi_dashboard` table
**Update to:** Use `kpiService.getLatestKPIValues(orgId)`

```typescript
import { kpiService, organizationService } from '../services/syncaiDataService';

// Replace loadExecutiveKPIs with:
const loadExecutiveKPIs = async () => {
  const org = await organizationService.getCurrentOrganization();
  if (!org) return;
  
  const kpis = await kpiService.getLatestKPIValues(org.id);
  setKpis(kpis);
};
```

### 2. MetricsDashboard.tsx
**Current:** Queries OpenClaw-specific tables
**Update to:** Use `kpiService` and `oeeService`

```typescript
import { kpiService, oeeService, organizationService } from '../services/syncaiDataService';
```

### 3. AssetManagement.tsx
**Current:** May have custom queries
**Update to:** Use `assetService`

```typescript
import { assetService, organizationService } from '../services/syncaiDataService';

// Get assets:
const assets = await assetService.getAssets(orgId, siteId);

// Get criticality:
const criticality = await assetService.getAssetCriticalitySummary(orgId);
```

### 4. Work Order Components
**Find components that query work_orders table**
**Update to:** Use `workOrderService`

```typescript
import { workOrderService, organizationService } from '../services/syncaiDataService';

// Get work orders:
const workOrders = await workOrderService.getWorkOrders(orgId, {
  status: 'pending',
  priority: 'high'
});

// Get backlog:
const backlog = await workOrderService.getBacklogSummary(orgId);
```

### 5. Approval Queue
**Current:** Likely queries approvals table
**Update to:** Use `governanceService`

```typescript
import { governanceService, organizationService } from '../services/syncaiDataService';

// Get pending approvals:
const approvals = await governanceService.getPendingApprovals(orgId);

// Get audit trail:
const audit = await governanceService.getAuditTrail(orgId, 'work_order', 7);
```

### 6. OEE Components
**Find components showing OEE data**
**Update to:** Use `oeeService`

```typescript
import { oeeService, organizationService } from '../services/syncaiDataService';

// Get OEE dashboard:
const oeeData = await oeeService.getOEEDashboard(orgId, siteId);

// Get loss breakdown:
const losses = await oeeService.getLossBreakdown(orgId, startDate, endDate);
```

### 7. Recommendations (AI Intelligence)
**Find components showing AI recommendations**
**Update to:** Use `recommendationService`

```typescript
import { recommendationService, organizationService } from '../services/syncaiDataService';

// Get recommendations:
const recs = await recommendationService.getRecommendations(orgId, {
  status: 'new'
});

// Accept/dismiss:
await recommendationService.acceptRecommendation(recId);
await recommendationService.dismissRecommendation(recId);
```

## User Context Integration

For components needing current user info, use:

```typescript
import { organizationService } from '../services/syncaiDataService';

// In component:
const org = await organizationService.getCurrentOrganization();
const sites = await organizationService.getSites(org.id);
```

## Priority Order for Integration

1. **ExecutiveDashboard** - KPIs drive executive decisions
2. **AssetManagement** - Core asset data
3. **Work Order views** - Operational work
4. **OEE displays** - Production performance
5. **Approval Queue** - Governance workflow
6. **Recommendations panel** - AI insights

## Notes

- All queries now include `organization_id` for tenant isolation
- Role-based filtering happens automatically via RLS policies
- Error handling: wrap calls in try/catch and show user-friendly errors
- Loading states: set loading true before fetch, false in finally