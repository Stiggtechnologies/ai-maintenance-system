export interface MobileAuditRow {
  route: string;
  verdict: string;
  note?: string;
  finalPath?: string;
  httpStatus?: number | null;
  overflow?: number;
  wide?: string[];
  clipped?: string[];
}
export function createAuditOutput(): string;
export function writeAuditArtifact(
  directory: string,
  name: string,
  content: string | Uint8Array,
): void;
export function runMobileAudit(options?: {
  env?: Record<string, string | undefined>;
  log?: (message: string) => void;
}): Promise<{
  directory: string;
  reportPath: string;
  report: MobileAuditRow[];
}>;
