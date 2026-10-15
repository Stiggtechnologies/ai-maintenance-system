import { createContext, useContext } from "react";

/** One AppShell selection, not a second Context preference or authorization. */
export interface OperatingSiteScope {
  actorId: string;
  organizationId: string;
  siteId: string | null;
  siteName: string;
}
export const OperatingSiteScopeContext =
  createContext<OperatingSiteScope | null>(null);
export function useOperatingSiteScope() {
  return useContext(OperatingSiteScopeContext);
}
