/**
 * Onboarding navigation while a visitor is still reaching a first Decision Case.
 * A person is offered only after that case is saved. Until then the link stays
 * inside the product.
 */

export const TALK_TO_US_HREF = "https://syncai.ca/contact";

export type SelfServeNavInput = {
  decisionCaseSaved: boolean;
  /** A browser draft or an auth form is the current step. */
  draftOpen: boolean;
  continueHref: string;
  continueLabel: string;
  askHref: string;
};

export type SelfServeNavLink = {
  href: string;
  label: string;
  /** True only for the post-save contact link. */
  leavesProduct: boolean;
};

/** Keep a pre-save link on this app. An absolute URL is not a self-serve step. */
export function inProductHref(href: string, fallback: string): string {
  const value = href.trim();
  if (value.startsWith("#") || value.startsWith("/")) return value;
  return fallback;
}

export function selfServeNavLink(input: SelfServeNavInput): SelfServeNavLink {
  if (input.decisionCaseSaved) {
    return {
      href: TALK_TO_US_HREF,
      label: "Talk to us",
      leavesProduct: true,
    };
  }
  if (input.draftOpen) {
    return {
      href: inProductHref(input.continueHref, input.askHref),
      label: input.continueLabel,
      leavesProduct: false,
    };
  }
  return {
    href: inProductHref(input.askHref, "/get-started"),
    label: "Ask your question",
    leavesProduct: false,
  };
}
