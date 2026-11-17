/** Synthetic contract fixture only; never imported by runtime code. */
export function contextInventoryFixture() {
  const organizationId = "ee020000-0000-4000-8000-000000000001";
  return {
    organizationId,
    generatedAt: "2026-10-10T05:01:00.000Z",
    scope: "organization",
    complete: true,
    operationalAuthority: false,
    sources: [
      {
        id: "ee020000-0000-4000-8000-000000000002",
        organizationId,
        key: "synthetic-unused-source",
        name: "Synthetic disconnected source",
        class: "customer_operational",
        authority: "tenant_authorized",
        purpose: "Synthetic fixture, not a connected customer feed.",
        rightsState: "customer_authorized",
        reportedHealthState: "not_connected",
        state: "not_connected",
        enabled: true,
        registryStatus: "active",
        checkedAt: "2026-10-10T05:00:00.000Z",
        observedAt: null,
        checkAgeSeconds: 60,
        observationAgeSeconds: null,
        detail: null,
        clockValid: true,
        rightsPermit: true,
        healthPermit: false,
        canEmit: false,
        displayAsLive: false,
        lastSuccessfulCheckAt: null,
        lastSuccessfulCheckBasis: "unknown_no_transport_receipt",
        coverage: {
          state: "unknown",
          basis: "no_governed_coverage_measurement",
        },
        issues: ["health_not_permitted"],
        operationalAuthority: false,
      },
    ],
  };
}
