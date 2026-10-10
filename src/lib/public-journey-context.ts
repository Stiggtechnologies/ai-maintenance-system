import {
  normalizeDecisionIndustry,
  type DecisionIndustryId,
} from "./decision-case";

const ATTRIBUTION_FIELDS = [
  "entry",
  "source",
  "campaign",
  "variant",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
] as const;

/** Only acquisition context crosses public routes; tokens and redirects never do. */
export function publicJourneyParameters(
  search: string,
  industry?: DecisionIndustryId,
): URLSearchParams {
  const source = new URLSearchParams(search);
  const result = new URLSearchParams();
  if (industry || source.has("industry")) {
    result.set(
      "industry",
      normalizeDecisionIndustry(industry ?? source.get("industry")),
    );
  }
  for (const field of ATTRIBUTION_FIELDS) {
    const value = source
      .get(field)
      ?.split("")
      .filter(
        (character) =>
          character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
      )
      .join("")
      .trim()
      .slice(0, 120);
    if (value) result.set(field, value);
  }
  return result;
}

export function publicJourneyPath(path: string, search: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("Public journey destinations must be local paths.");
  }
  const destination = new URL(path, "https://syncai.invalid");
  if (destination.origin !== "https://syncai.invalid") {
    throw new Error("Public journey destinations must be local paths.");
  }
  for (const [name, value] of publicJourneyParameters(search)) {
    destination.searchParams.set(name, value);
  }
  return `${destination.pathname}${destination.search}${destination.hash}`;
}
