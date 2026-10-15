import {
  normalizeDecisionIndustry,
  type DecisionIndustryId,
} from "./decision-case";
import { safeAuthReturnTo } from "./auth-return";

/** Recover acquisition context from an auth handoff, never its private tokens. */
export function publicAuthJourneySearch(
  search: string,
  origin: string,
): string {
  const outer = new URLSearchParams(search);
  const safeReturn = safeAuthReturnTo(outer.get("returnTo"), origin);
  const combined = publicJourneyParameters(new URL(safeReturn, origin).search);
  for (const [key, value] of publicJourneyParameters(search))
    combined.set(key, value);
  return combined.toString();
}

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

/** Keep a decision identity on explicit journey navigation; no arbitrary query forwarding. */
export function publicDecisionJourneyPaths(
  search: string,
  origin: string,
  pathname = "/",
): { assistant: string; firstDecision: string } {
  const outer = new URLSearchParams(search);
  const returnUrl = new URL(
    safeAuthReturnTo(outer.get("returnTo"), origin),
    origin,
  );
  const validId = (value: string | null) =>
    value &&
    /^(?:draft-[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(
      value,
    )
      ? value
      : null;
  const routeCase = (path: string) => {
    const match = path.match(/^\/workspace\/cases\/([^/]+)$/);
    return validId(match?.[1] ?? null);
  };
  const id =
    validId(outer.get("case")) ??
    routeCase(pathname) ??
    validId(returnUrl.searchParams.get("case")) ??
    routeCase(returnUrl.pathname);
  const context = publicAuthJourneySearch(search, origin);
  if (!id)
    return {
      assistant: publicJourneyPath("/workspace", context),
      firstDecision: publicJourneyPath("/get-started", context),
    };
  const first = new URL(publicJourneyPath("/get-started", context), origin);
  first.searchParams.set("case", id);
  first.searchParams.set(
    "view",
    outer.get("view") === "ask" ? "ask" : "evaluation",
  );
  first.searchParams.set("origin", "evaluation");
  const assistant = new URL(
    publicJourneyPath(`/workspace/cases/${id}`, context),
    origin,
  );
  assistant.searchParams.set("origin", "evaluation");
  return {
    assistant: assistant.pathname + assistant.search,
    firstDecision: first.pathname + first.search,
  };
}
