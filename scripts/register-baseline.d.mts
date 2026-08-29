/**
 * Types for the ratchet script, so a TEST can import its parser.
 *
 * `capability-register.test.ts` asserts that this script and
 * `src/test/support/capabilityEvidence.ts` see the same rows in the same
 * files. They state the register's shape twice — once in Node, once in
 * TypeScript — because one runs in CI's lint job and the other in its test
 * job, and "deleting either leaves the other running" is the point. Two copies
 * of a rule drift, so the drift is asserted rather than hoped for.
 */
export interface BaselineItem {
  status: string;
  evidence: boolean;
  citations: number;
  backticked: number;
}

export interface BaselineRegister {
  name: string;
  path: string;
  baseline: string;
  row: RegExp;
}

export function claimLines(source: string): { text: string; line: number }[];
export function countCitations(evidence: string): {
  total: number;
  backticked: number;
};
export function readRegister(
  register: BaselineRegister,
  source?: string,
): Record<string, BaselineItem>;
export function regressions(
  base: Record<string, Partial<BaselineItem>>,
  current: Record<string, Partial<BaselineItem>>,
): string[];
