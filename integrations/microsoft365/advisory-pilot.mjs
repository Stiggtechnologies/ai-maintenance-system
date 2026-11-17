import { portfolio } from "./portfolio.mjs";
// Dependency-injected read-only integration seam. Identity verification must be
// supplied by an audited Entra adapter; no raw request tenant is trusted here.
export async function readAdvisory(
  input,
  { verifyIdentity, readTenantAgents, readEntitlement, now = Date.now },
) {
  if (!verifyIdentity || !readTenantAgents || !readEntitlement)
    throw new Error("integration dependencies missing");
  const identity = await verifyIdentity(input.token);
  if (
    !identity?.verified ||
    !identity.tenantId ||
    !identity.organizationId ||
    !identity.subject
  )
    throw new Error("verified tenant identity required");
  if (input.organizationId && input.organizationId !== identity.organizationId)
    throw new Error("cross-tenant request refused");
  const requested = portfolio.find((p) => p.id === input.agentId);
  if (!requested) throw new Error("unknown requested agent");
  const entitlement = await readEntitlement(identity);
  if (
    !entitlement ||
    !Number.isFinite(Date.parse(entitlement.expiresAt)) ||
    Date.parse(entitlement.expiresAt) <= now() ||
    entitlement.status !== "active" ||
    entitlement.tenantId !== identity.tenantId ||
    entitlement.organizationId !== identity.organizationId ||
    !entitlement.subscriptionId ||
    !entitlement.planId ||
    !Number.isInteger(entitlement.quantity) ||
    entitlement.quantity < 1 ||
    !Array.isArray(entitlement.userIds) ||
    entitlement.userIds.length > entitlement.quantity ||
    !entitlement.userIds.includes(identity.subject) ||
    !entitlement.agentIds?.includes(requested.id)
  )
    throw new Error("active matching entitlement required");
  if (requested.sourceStatus === "unverified")
    throw new Error("unimplemented capability refused");
  const agents = await readTenantAgents(identity);
  if (
    !Array.isArray(agents) ||
    agents.some((a) => a.organization_id !== identity.organizationId)
  )
    throw new Error("cross-tenant response refused");
  return {
    agent: requested.name,
    sourceStatus: requested.sourceStatus,
    microsoftStatus: "not-integrated",
    humanApprovalRequired: true,
    readOnly: true,
    candidates: agents
      .filter((a) => requested.candidateKeys.includes(a.key))
      .map((a) => ({ key: a.key, name: a.name, status: a.status })),
    limitations: [
      "Candidate mappings require owner review.",
      "No industrial recommendation or action is performed.",
      "Live Entra, entitlement and Microsoft installation remain unverified.",
    ],
  };
}
