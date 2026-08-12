/**
 * Contribution screening and posture.
 *
 * The k-anonymity gate itself lives in SQL (`evaluate_benchmark_eligibility`),
 * for the same reason the document-class matrix does: the enforcement point has
 * to be server-side, and a rule written twice drifts. This module does not
 * restate it.
 *
 * What it adds is the pre-flight the database cannot do well — screening a
 * candidate payload for things that identify a customer. The table has a check
 * constraint catching the obvious keys, but a constraint cannot reason about a
 * free-text field containing "Dozer 5390" or a timestamp precise enough to line
 * up with a public incident. This runs before submission so a contributor sees
 * the problem while they can still fix it.
 *
 * WHAT COUNTS AS IDENTIFYING.
 *
 * Not just names. A benchmark is de-identified only if a reader who already
 * knows something about the market cannot work out whose data it is. Three
 * things break that, and all three look harmless in isolation:
 *
 *   - direct identifiers: tags, serials, site names, organization ids;
 *   - quasi-identifiers: an exact asset count, a precise timestamp, a
 *     coordinate — none of them a name, all of them a fingerprint;
 *   - singleton samples: a statistic over one asset IS that asset's data.
 *
 * Pure functions. No database, no network.
 */

export type ContributionLane = "structural" | "statistical";

export interface ScreeningFinding {
  severity: "blocking" | "advisory";
  path: string;
  kind:
    "direct_identifier" | "quasi_identifier" | "free_text" | "singleton_sample";
  detail: string;
}

export interface ScreeningResult {
  safe: boolean;
  findings: ScreeningFinding[];
  reason: string;
}

/** Keys that name a customer or one of their things, directly. */
const DIRECT_IDENTIFIER_KEYS = [
  "asset_name",
  "assetname",
  "asset_tag",
  "tag",
  "serial",
  "serial_number",
  "organization_id",
  "organizationid",
  "org_id",
  "site",
  "site_name",
  "location",
  "operator",
  "customer",
  "client",
  "work_order_id",
];

/** Keys precise enough to fingerprint even without a name attached. */
const QUASI_IDENTIFIER_KEYS = [
  "latitude",
  "longitude",
  "lat",
  "lon",
  "coordinates",
  "installed_at",
  "commissioned_at",
  "incident_date",
  "failed_at",
];

/**
 * Free text is where identifiers hide. A field described as a "note" or
 * "description" is not screenable by key name, so its CONTENT is checked for
 * the shape of an equipment identifier — a word followed by a 3-6 digit unit
 * number, which is exactly how this operator names machines ("Dozer 5390").
 */
const FREE_TEXT_KEYS = [
  "note",
  "notes",
  "description",
  "comment",
  "summary",
  "detail",
];
const UNIT_NUMBER_PATTERN = /\b[A-Za-z][A-Za-z\s-]{2,20}\s\d{3,6}\b/;

function walk(
  value: unknown,
  path: string,
  findings: ScreeningFinding[],
): void {
  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, findings));
    return;
  }

  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      const childPath = path ? `${path}.${k}` : k;

      if (DIRECT_IDENTIFIER_KEYS.includes(lower)) {
        findings.push({
          severity: "blocking",
          path: childPath,
          kind: "direct_identifier",
          detail: `"${k}" names a customer or one of their assets. A derived artefact does not need it — if the analysis cannot be expressed without it, the artefact is not derived.`,
        });
      } else if (QUASI_IDENTIFIER_KEYS.includes(lower)) {
        findings.push({
          severity: "blocking",
          path: childPath,
          kind: "quasi_identifier",
          detail: `"${k}" is precise enough to fingerprint a specific machine or event even with no name attached. Aggregate it to a band, or drop it.`,
        });
      } else if (
        FREE_TEXT_KEYS.includes(lower) &&
        typeof v === "string" &&
        UNIT_NUMBER_PATTERN.test(v)
      ) {
        findings.push({
          severity: "blocking",
          path: childPath,
          kind: "free_text",
          detail: `"${k}" contains what looks like an equipment identifier ("${(v.match(UNIT_NUMBER_PATTERN) ?? [""])[0].trim()}"). Free text is where identifiers survive de-identification.`,
        });
      } else if (
        FREE_TEXT_KEYS.includes(lower) &&
        typeof v === "string" &&
        v.length > 200
      ) {
        findings.push({
          severity: "advisory",
          path: childPath,
          kind: "free_text",
          detail: `"${k}" is ${v.length} characters of free text. Long prose is hard to screen and easy to leak through — worth a human read before this is contributed.`,
        });
      }

      walk(v, childPath, findings);
    }
  }
}

export function screenPayload(
  payload: unknown,
  assetCount: number,
): ScreeningResult {
  const findings: ScreeningFinding[] = [];
  walk(payload, "", findings);

  if (assetCount <= 1) {
    findings.push({
      severity: "blocking",
      path: "assetCount",
      kind: "singleton_sample",
      detail: `A statistic computed over ${assetCount} asset(s) is that asset's data with an average sign in front of it. Aggregation over one thing is not aggregation.`,
    });
  } else if (assetCount < 5) {
    findings.push({
      severity: "advisory",
      path: "assetCount",
      kind: "singleton_sample",
      detail: `${assetCount} assets is a thin sample. It will still be pooled with other contributors, but it carries little and identifies more than a larger one would.`,
    });
  }

  const blocking = findings.filter((f) => f.severity === "blocking");

  return {
    safe: blocking.length === 0,
    findings,
    reason:
      blocking.length > 0
        ? `Not contributable: ${blocking.length} blocking finding(s). ${blocking.map((f) => f.path).join(", ")}. A contribution leaves this tenant permanently — screening happens before it goes, because it cannot be recalled from anyone who has already read it.`
        : findings.length > 0
          ? `Screened clean of identifiers, with ${findings.length} advisory note(s). Nothing blocks contribution.`
          : `Screened clean. No direct identifiers, no quasi-identifiers, no free text carrying equipment numbers.`,
  };
}

/**
 * Which lane an artefact belongs in.
 *
 * The distinction is not about sensitivity but about what the artefact IS. A
 * component breakdown is a fact about a machine type — true whoever owns one,
 * so k-anonymity is meaningless for it and engineering review is what matters.
 * A fitted failure rate is a measurement of somebody's fleet, and stays
 * identifiable until enough fleets are pooled.
 */
export interface LaneRecommendation {
  lane: ContributionLane;
  requiresKAnonymity: boolean;
  requiresEngineerReview: boolean;
  reason: string;
}

export function recommendLane(artefactType: string): LaneRecommendation {
  const structural = [
    "component_breakdown",
    "failure_mode_taxonomy",
    "asset_class_template",
    "maintenance_task_list",
    "functional_hierarchy",
  ];

  if (structural.includes(artefactType)) {
    return {
      lane: "structural",
      requiresKAnonymity: false,
      requiresEngineerReview: true,
      reason: `A ${artefactType.replace(/_/g, " ")} describes how a machine of this type is built and how it can fail. That is true whoever owns one, so pooling more contributors does not make it safer and k-anonymity has nothing to protect. What it needs instead is an engineer willing to sign that it is correct.`,
    };
  }

  return {
    lane: "statistical",
    requiresKAnonymity: true,
    requiresEngineerReview: false,
    reason: `A ${artefactType.replace(/_/g, " ")} is a measurement of a particular fleet, not a fact about a machine type. It stays attributable until enough fleets are pooled, so it needs k-anonymity, a cap on any single contributor, and consent under current terms.`,
  };
}

export interface ContributionPosture {
  structuralConsent: boolean;
  statisticalConsent: boolean;
  termsVersion: string | null;
  policyTermsVersion: string;
  consentIsCurrent: boolean;
  ownContributions: number;
  ownWithdrawn: number;
  freshBenchmarks: number;
  staleBenchmarks: number;
  /** Reciprocal model: contributing is what grants the right to read. */
  mayReadBenchmarks: boolean;
  accessBasis: string;
}

export interface PostureVerdict {
  contributing: boolean;
  /** True when consent exists but was given against superseded terms. */
  consentNeedsRenewal: boolean;
  /** True when this tenant may read the shared pool. */
  mayRead: boolean;
  reason: string;
}

export function assessContributionPosture(
  p: ContributionPosture | null,
): PostureVerdict {
  if (!p) {
    return {
      contributing: false,
      consentNeedsRenewal: false,
      mayRead: false,
      reason:
        "No contribution policy is configured, so nothing can be contributed and nothing can be published. This is the default state and it is the safe one.",
    };
  }

  const anyConsent = p.structuralConsent || p.statisticalConsent;
  const needsRenewal = anyConsent && !p.consentIsCurrent;

  if (!anyConsent) {
    return {
      contributing: false,
      consentNeedsRenewal: false,
      mayRead: p.mayReadBenchmarks,
      reason:
        `This organization contributes nothing to the shared knowledge base. No derived artefact, no statistic, nothing. ` +
        `Consent is off for both lanes and off is the default — a tenant that has never been asked and a tenant that declined are treated identically. ` +
        // Access is reciprocal, so a non-contributor is normally also a
        // non-reader. Saying which of the two applies matters: "you give
        // nothing" and "you also get nothing" are separate facts and a
        // customer weighing the opt-in needs both.
        p.accessBasis,
    };
  }

  return {
    contributing: !needsRenewal,
    consentNeedsRenewal: needsRenewal,
    mayRead: p.mayReadBenchmarks,
    reason:
      (needsRenewal
        ? `Consent was given under terms "${p.termsVersion}" and the current policy is "${p.policyTermsVersion}". That consent does not carry forward — contributions are held and excluded from every published figure until the current terms are agreed. `
        : `Contributing under terms "${p.termsVersion}": ${p.structuralConsent ? "structural" : ""}${p.structuralConsent && p.statisticalConsent ? " and " : ""}${p.statisticalConsent ? "statistical" : ""}. `) +
      `${p.ownContributions} active contribution(s), ${p.ownWithdrawn} withdrawn. ` +
      (p.staleBenchmarks > 0
        ? `${p.staleBenchmarks} published benchmark(s) are withheld because a contributor withdrew and they have not been recomputed.`
        : `No published benchmark is currently withheld.`),
  };
}
