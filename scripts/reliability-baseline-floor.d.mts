// Hand-written types for `reliability-baseline-floor.mjs`.
//
// The floor is authored as plain `.mjs` on purpose: it has to be importable by
// `node scripts/check-reliability-baseline.mjs` with no build step, in the same
// CI job as `npm run test`. A guard that needs a compiler to start is a guard
// that eventually stops running. This declaration file is what lets the vitest
// half import the very same literals under `strict` typechecking, so the two
// enforcement layers can never drift onto different constants.

export interface ProtectedPathEntry {
  path: string;
  gitBlobSha: string;
  tier?: string;
  purpose?: string;
  reachability?: string;
}

export interface ProtectedDatabaseObjectEntry {
  object: string;
  definitionDigest: string;
  purpose?: string;
}

export interface ReliabilityManifest {
  baselineId?: string;
  promptVersion?: string;
  minimumCaseCount?: number;
  protectedPaths?: ProtectedPathEntry[];
  zeroTolerance?: Record<string, number>;
  releaseThresholds?: Record<string, number | boolean>;
  qualityDimensions?: string[];
  judgeIndependenceRequired?: boolean;
  qualificationReportsDirectory?: string;
  referenceOutputs?: string;
  approvalsDirectory?: string;
  evidenceProvenanceRequired?: boolean;
  protectedDatabaseObjects?: ProtectedDatabaseObjectEntry[];
  [key: string]: unknown;
}

export interface GoldenCase {
  id: string;
  domain: string;
  question: string;
  expectedSpecialists: string[];
  hardRequirements: string[];
  forbidden: string[];
}

export interface GoldenSuite {
  baselineId?: string;
  caseCount?: number;
  cases?: GoldenCase[];
}

export interface ImportEdge {
  from: string;
  to: string;
  typeOnly: boolean;
  dynamic: boolean;
}

export interface UnresolvedImport {
  unresolved: string;
  from: string;
}

export interface ProtectedClosure {
  modules: string[];
  edges: ImportEdge[];
  unresolved: UnresolvedImport[];
  dynamic: string[];
}

export interface TieredClosure {
  core: ProtectedClosure;
  all: ProtectedClosure;
  coreModules: Set<string>;
  tierOf(module: string): string;
}

export interface ExtractedImports {
  edges: Array<{ specifier: string; typeOnly: boolean; dynamic: boolean }>;
  nonLiteralDynamic: boolean;
}

export const repositoryRoot: string;
export const MANIFEST_PATH: string;
export const CASES_PATH: string;
export const PROTECTED_ENTRYPOINTS: readonly string[];
export const MINIMUM_RELEASE_THRESHOLDS: Readonly<{
  pairwiseWinOrTieRate: number;
  evidenceGapRecognition: number;
  deterministicCalculationPassRate: number;
}>;
export const MAXIMUM_ALLOWANCES: Readonly<Record<string, number>>;
export const ZERO_TOLERANCE_KEYS: readonly string[];
export const REQUIRED_QUALITY_DIMENSIONS: readonly string[];
export const REQUIRED_BASELINE_ID: string;
export const REQUIRED_PROMPT_VERSION: string;
export const MINIMUM_CASE_COUNT: number;
export const MINIMUM_PROTECTED_PATH_COUNT: number;
export const REQUIRED_CASE_IDS: readonly string[];
export const REQUIRED_CASE_FINGERPRINTS: Readonly<Record<string, string>>;
export const JUDGE_MUST_BE_INDEPENDENT: boolean;
export const REPOSITORY: string;
export const TIER_CORE: string;
export const TIER_PROMPT_SURFACE: string;
export const PROTECTED_TIERS: readonly string[];
export const PROMPT_SURFACE_ENTRYPOINTS: readonly string[];
export const PROTECTED_DATABASE_OBJECTS: readonly string[];
export const MIGRATIONS_DIRECTORY: string;
export const QUALIFICATION_WORKFLOWS: readonly string[];
export const PROVENANCE_REQUIRED_FIELDS: readonly string[];
export const EVIDENCE_PRODUCERS: readonly string[];
export const APPROVALS_DIRECTORY: string;
export const APPROVAL_KINDS: readonly string[];
export const APPROVAL_REQUIRED_FIELDS: readonly string[];
export const MACHINE_REPORT_VERDICT: string;
export const REQUIRED_GUARD_FILES: readonly string[];
export const REQUIRED_GUARD_WIRING: ReadonlyArray<{
  file: string;
  jsonPointer?: string[];
  contains: string;
  why: string;
}>;

export function loadJson(relativePath: string): unknown;
export function loadManifest(): ReliabilityManifest;
export function loadSuite(): GoldenSuite;
export function gitBlobSha(relativePath: string): string;
export function sha256(value: string | Uint8Array): string;
export function sha256File(relativePath: string): string;
export function caseFingerprint(item: Partial<GoldenCase>): string;
export function extractImportEdges(source: string): ExtractedImports;
export function computeTieredClosure(): TieredClosure;
export function listMigrations(): string[];
export function computeDatabaseObjectDigests(
  objects?: readonly string[],
): Record<string, string>;
export function collectGuardFailures(): string[];
export function computeProtectedClosure(entrypoints?: readonly string[]): ProtectedClosure;
export function collectDynamicImportFailures(
  closureModules: readonly string[],
  closure?: ProtectedClosure,
): string[];
export function collectFloorFailures(
  manifest: ReliabilityManifest,
  suite: GoldenSuite,
): string[];
export function collectClosureFailures(
  manifest: ReliabilityManifest,
  closure?: ProtectedClosure,
): string[];
export function collectProvenanceFailures(label: string, artefact: unknown): string[];
export function collectMachineReportFailures(report: unknown): string[];
export function collectApprovalShapeFailures(
  record: unknown,
  baselineId?: string,
): string[];
