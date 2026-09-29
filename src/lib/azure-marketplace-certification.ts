export interface CertificationCheck {
  id: string;
  passed: boolean;
  evidence: string;
}

export interface MarketplaceCertificationInput {
  expected: {
    publisherId: string;
    offerId: string;
    planId: string;
    dimension: string;
    unitSize: number;
    includedQuantity: number;
    quantityScale: number;
  };
  primarySubscriptionId: string;
  unsubscribeSubscriptionId: string;
  primaryBilling: Record<string, unknown> | null;
  primaryResolution: Record<string, unknown> | null;
  primaryOperations: Array<Record<string, unknown>>;
  terminalBilling: Record<string, unknown> | null;
  terminalResolution: Record<string, unknown> | null;
  terminalOperations: Array<Record<string, unknown>>;
  acceptedMeteringEvent: Record<string, unknown> | null;
  marketplacePrimary: Record<string, unknown> | null;
  duplicateResult: Record<string, unknown> | null;
  rejectedResult: Record<string, unknown> | null;
  auditEvents: Array<Record<string, unknown>>;
  partnerCenterEvidence: {
    reference: string;
    sha256: string;
    capturedAt: string;
  };
  witnessedBy: string;
  reviewedBy: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function completedActions(
  operations: Array<Record<string, unknown>>,
): Set<string> {
  return new Set(
    operations
      .filter(
        (operation) =>
          operation.processing_state === "completed" &&
          operation.microsoft_status === "Succeeded",
      )
      .map((operation) => text(operation.action)),
  );
}

function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) <= 10 ** -10;
}

function meteringArithmetic(
  event: Record<string, unknown> | null,
  unitSize: number,
  quantityScale: number,
): { passed: boolean; evidence: string } {
  if (!event) return { passed: false, evidence: "no accepted event" };
  const sourceUnits = number(event.source_units);
  const included = number(event.included_quantity);
  const unreportable = number(event.prior_unreportable_quantity);
  const allocated = number(event.prior_allocated_quantity);
  const quantity = number(event.quantity);
  if (
    sourceUnits === null ||
    included === null ||
    unreportable === null ||
    allocated === null ||
    quantity === null ||
    unitSize <= 0 ||
    !Number.isInteger(quantityScale) ||
    quantityScale < 0 ||
    quantityScale > 6
  ) {
    return { passed: false, evidence: "meter arithmetic inputs are invalid" };
  }
  const precision = 10 ** quantityScale;
  const cumulative =
    Math.trunc((sourceUnits / unitSize) * precision) / precision;
  const expected = Math.max(
    cumulative - included - unreportable - allocated,
    0,
  );
  return {
    passed: expected > 0 && closeEnough(expected, quantity),
    evidence: `expected=${expected}; recorded=${quantity}; cumulative=${cumulative}`,
  };
}

function hasAudit(
  events: Array<Record<string, unknown>>,
  entityType: string,
  eventName: string,
  expected: Record<string, string>,
): boolean {
  return events.some((event) => {
    const data =
      event.event_data && typeof event.event_data === "object"
        ? (event.event_data as Record<string, unknown>)
        : null;
    return (
      event.entity_type === entityType &&
      data?.event === eventName &&
      Object.entries(expected).every(([key, value]) => data?.[key] === value)
    );
  });
}

function validExternalEvidence(input: MarketplaceCertificationInput): boolean {
  const { reference, sha256, capturedAt } = input.partnerCenterEvidence;
  const captured = new Date(capturedAt);
  const meterAcceptedAt = [
    input.acceptedMeteringEvent?.submitted_at,
    input.acceptedMeteringEvent?.microsoft_message_time,
    input.acceptedMeteringEvent?.updated_at,
  ]
    .map((value) => (typeof value === "string" ? new Date(value) : null))
    .find((value) => value && Number.isFinite(value.getTime()));
  return Boolean(
    /^[A-Za-z0-9][A-Za-z0-9._:/ -]{5,500}$/.test(reference) &&
    !/[?#]/.test(reference) &&
    /^[0-9a-f]{64}$/.test(sha256) &&
    Number.isFinite(captured.getTime()) &&
    meterAcceptedAt &&
    captured.getTime() >= meterAcceptedAt.getTime() &&
    captured.getTime() >= Date.now() - 24 * 60 * 60_000 &&
    captured.getTime() <= Date.now() + 5 * 60_000 &&
    input.witnessedBy.trim().length >= 3 &&
    input.reviewedBy.trim().length >= 3 &&
    input.witnessedBy.trim().toLowerCase() !==
      input.reviewedBy.trim().toLowerCase(),
  );
}

export function evaluateMarketplacePreviewCertification(
  input: MarketplaceCertificationInput,
): CertificationCheck[] {
  const checks: CertificationCheck[] = [];
  const add = (id: string, passed: boolean, evidence: string) =>
    checks.push({ id, passed, evidence });
  const primary = input.primaryBilling;
  const primaryResolution = input.primaryResolution;
  const terminal = input.terminalBilling;
  const terminalResolution = input.terminalResolution;
  const primaryActions = completedActions(input.primaryOperations);
  const terminalActions = completedActions(input.terminalOperations);
  const meter = input.acceptedMeteringEvent;
  const marketplace = input.marketplacePrimary;

  add(
    "distinct-preview-subscriptions",
    Boolean(
      input.primarySubscriptionId &&
      input.unsubscribeSubscriptionId &&
      input.primarySubscriptionId !== input.unsubscribeSubscriptionId,
    ),
    "active lifecycle and terminal unsubscribe use separate preview purchases",
  );
  add(
    "primary-canonical-entitlement",
    Boolean(
      primary &&
      primary.billing_source === "azure_marketplace" &&
      primary.marketplace_subscription_id === input.primarySubscriptionId &&
      primary.marketplace_publisher_id === input.expected.publisherId &&
      primary.marketplace_offer_id === input.expected.offerId &&
      primary.marketplace_plan_id === input.expected.planId &&
      primary.marketplace_status === "Subscribed" &&
      primary.status === "active",
    ),
    primary
      ? `status=${text(primary.status)}; marketplace=${text(primary.marketplace_status)}`
      : "primary canonical billing row absent",
  );
  add(
    "primary-governed-activation",
    Boolean(
      primaryResolution &&
      primaryResolution.billing_subscription_id === primary?.id &&
      primaryResolution.organization_id === primary?.organization_id &&
      primaryResolution.publisher_id === input.expected.publisherId &&
      primaryResolution.offer_id === input.expected.offerId &&
      primaryResolution.plan_id === input.expected.planId &&
      primaryResolution.internal_status === "active" &&
      primaryResolution.marketplace_status === "Subscribed" &&
      primaryResolution.activated_at,
    ),
    primaryResolution
      ? `internal=${text(primaryResolution.internal_status)}; marketplace=${text(primaryResolution.marketplace_status)}`
      : "primary fulfillment resolution absent",
  );
  const requiredPrimaryActions = [
    "ChangePlan",
    "ChangeQuantity",
    "Renew",
    "Suspend",
    "Reinstate",
  ];
  const missingActions = requiredPrimaryActions.filter(
    (action) => !primaryActions.has(action),
  );
  add(
    "primary-live-lifecycle",
    missingActions.length === 0,
    missingActions.length === 0
      ? requiredPrimaryActions.join(",")
      : `missing completed Microsoft operations: ${missingActions.join(",")}`,
  );
  add(
    "terminal-unsubscribe",
    Boolean(
      terminal &&
      terminalResolution &&
      terminal.marketplace_subscription_id ===
        input.unsubscribeSubscriptionId &&
      terminal.billing_source === "azure_marketplace" &&
      terminal.marketplace_publisher_id === input.expected.publisherId &&
      terminal.marketplace_offer_id === input.expected.offerId &&
      terminal.marketplace_status === "Unsubscribed" &&
      terminal.status === "cancelled" &&
      terminalResolution.internal_status === "unsubscribed" &&
      terminalResolution.marketplace_status === "Unsubscribed" &&
      terminalActions.has("Unsubscribe"),
    ),
    terminal
      ? `status=${text(terminal.status)}; marketplace=${text(terminal.marketplace_status)}`
      : "terminal canonical billing row absent",
  );
  add(
    "microsoft-authoritative-primary",
    Boolean(
      marketplace &&
      text(marketplace.id).toLowerCase() ===
        input.primarySubscriptionId.toLowerCase() &&
      marketplace.publisherId === input.expected.publisherId &&
      marketplace.offerId === input.expected.offerId &&
      marketplace.planId === input.expected.planId &&
      marketplace.status === "Subscribed",
    ),
    marketplace
      ? `status=${text(marketplace.status)}; plan=${text(marketplace.planId)}`
      : "Microsoft Get Subscription evidence absent",
  );
  add(
    "accepted-canonical-meter",
    Boolean(
      meter &&
      meter.marketplace_subscription_id === input.primarySubscriptionId &&
      meter.plan_id === input.expected.planId &&
      meter.dimension === input.expected.dimension &&
      meter.status === "accepted" &&
      meter.microsoft_status === "Accepted" &&
      meter.microsoft_usage_event_id &&
      meter.request_id &&
      meter.correlation_id,
    ),
    meter
      ? `canonical record present; status=${text(meter.status)}`
      : "accepted metering evidence absent",
  );
  const arithmetic = meteringArithmetic(
    meter,
    input.expected.unitSize,
    input.expected.quantityScale,
  );
  add(
    "included-quantity-reconciliation",
    arithmetic.passed &&
      number(meter?.included_quantity) === input.expected.includedQuantity,
    arithmetic.evidence,
  );
  add(
    "exact-duplicate-witness",
    Boolean(
      input.duplicateResult?.status === "Duplicate" &&
      input.duplicateResult.exactDuplicate === true &&
      number(input.duplicateResult.acceptedQuantity) ===
        number(meter?.quantity),
    ),
    input.duplicateResult
      ? `status=${text(input.duplicateResult.status)}; exact=${String(input.duplicateResult.exactDuplicate)}`
      : "live duplicate replay evidence absent",
  );
  add(
    "deliberate-rejection-witness",
    Boolean(
      input.rejectedResult &&
      [
        "ResourceNotFound",
        "ResourceNotAuthorized",
        "ResourceNotActive",
        "InvalidDimension",
        "BadArgument",
        "Error",
      ].includes(text(input.rejectedResult.status)),
    ),
    input.rejectedResult
      ? `status=${text(input.rejectedResult.status)}`
      : "live non-billable rejection evidence absent",
  );
  add(
    "canonical-audit-lineage",
    hasAudit(
      input.auditEvents,
      "azure_marketplace_subscription",
      "activation_requested",
      { marketplaceSubscriptionId: input.primarySubscriptionId },
    ) &&
      typeof meter?.id === "string" &&
      hasAudit(
        input.auditEvents,
        "azure_marketplace_metering",
        "usage_emission_completed",
        {
          marketplaceSubscriptionId: input.primarySubscriptionId,
          meteringRecordId: meter.id,
          status: "accepted",
          microsoftStatus: "Accepted",
        },
      ),
    "exact-subscription activation and exact-record accepted metering completion must both be retained in audit_events",
  );
  add(
    "partner-center-usage-view",
    validExternalEvidence(input),
    validExternalEvidence(input)
      ? `stable reference supplied; sha256=${input.partnerCenterEvidence.sha256}`
      : "hashed Partner Center evidence and two distinct human witnesses are required",
  );
  return checks;
}
