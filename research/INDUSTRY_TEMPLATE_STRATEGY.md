# SyncAI Industry Template Strategy

## Template Hierarchy

```
Master Templates (Phase 1):
├── Heavy Industrial (Oil Sands / Mining)
├── Process Industrial (Chemicals / Utilities)
├── Discrete Manufacturing
└── Infrastructure / Fleet

Derived Templates (Phase 2+):
├── Pharma (from Manufacturing)
├── Renewables (from Utilities)
├── Data Centers (from Utilities)
├── Transportation (from Infrastructure)
├── Construction (from Heavy Industrial)
├── Pulp & Paper (from Process Industrial)
└── Cement/Aggregates (from Heavy Industrial)
```

## Phase 1 — Core (NOW)

| #   | Industry      | Status   | Base Pattern          |
| --- | ------------- | -------- | --------------------- |
| 1   | Oil Sands     | Building | Anchor template       |
| 2   | Mining        | Building | Cloned from Oil Sands |
| 3   | Manufacturing | Building | New master            |
| 4   | Utilities     | Building | New master            |

## Phase 2 — Fast Follow

| #   | Industry       | Derives From          |
| --- | -------------- | --------------------- |
| 5   | Transportation | Infrastructure master |
| 6   | Construction   | Heavy Industrial      |
| 7   | Chemicals      | Process Industrial    |

## Phase 3 — Scale

| #   | Industry     | Derives From     |
| --- | ------------ | ---------------- |
| 8   | Renewables   | Utilities        |
| 9   | Data Centers | Utilities        |
| 10  | Maritime     | Heavy Industrial |
| 11  | Facilities   | Infrastructure   |

## Template Composition

Every template = KPI Pack + OEE Model + Asset Library + Criticality Model + Governance Defaults + Work Taxonomy + Failure Mode Library + Deployment Defaults

## Key Insight

4-5 master templates + industry overlays covers 80% of the asset-intensive world. You don't need 15 separate systems — you need configurable depth within shared patterns.

## Why This Matters

This is the #1 value lever in SyncAI:

- Deployable in 1 day instead of 6 months
- Defensible vs competitors (industry intelligence, not just software)
- Scalable to $100M+ (each template unlocks an entire vertical)
