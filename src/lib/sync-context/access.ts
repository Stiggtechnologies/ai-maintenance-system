/** Experience gate only. The authenticated operating RPC remains authoritative. */
const CONTEXT_READ_ROLES = new Set([
  "admin",
  "ai_admin",
  "executive",
  "maintenance_manager",
  "reliability_engineer",
  "planner",
]);
export function canOpenSyncContext(role: string | null | undefined): boolean {
  return role != null && CONTEXT_READ_ROLES.has(role);
}
