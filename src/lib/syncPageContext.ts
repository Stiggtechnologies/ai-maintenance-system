export const MAX_SYNC_PAGE_SNAPSHOT_CHARS = 8_000;
const PAGE_SNAPSHOT_TIMEOUT_MS = 4_000;
const PAGE_SNAPSHOT_MINIMUM_WAIT_MS = 700;
const PAGE_SNAPSHOT_SETTLE_MS = 300;
const PAGE_SNAPSHOT_POLL_MS = 100;

const PAGE_CONTEXT_QUERY =
  /\b(?:this|current|open|opened|visible)\b[\s\S]{0,30}\b(?:page|screen|view|dashboard|workspace|report|chart|table|panel)\b|\b(?:page|screen|dashboard|workspace|report|chart|table|panel)\s+(?:shows?|contains?|displays?|means?)\b|\bwhat(?:'s| is)\s+(?:on|shown|displayed)\b|\bwhat (?:am i|are we) looking at\b|\bwhat do you see\b|\bwhat is this telling me\b|\bsummari[sz]e (?:this|the current|the open)\b/i;

const EXCLUDED_PAGE_CONTEXT_SELECTOR = [
  "script",
  "style",
  "noscript",
  "input",
  "textarea",
  "select",
  "option",
  "[contenteditable]",
  "[data-sync-private]",
  "[aria-hidden='true']",
  "[hidden]",
].join(",");

const BLOCK_PAGE_CONTEXT_SELECTOR = [
  "address",
  "article",
  "aside",
  "blockquote",
  "button",
  "dd",
  "details",
  "dialog",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "section",
  "summary",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
].join(",");

function compactVisibleText(value: string): string {
  return value
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line, index, lines) => line || lines[index - 1])
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isRenderedForSyncContext(element: Element, root: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (current.matches(EXCLUDED_PAGE_CONTEXT_SELECTOR)) return false;
    const view = current.ownerDocument.defaultView;
    if (view) {
      const style = view.getComputedStyle(current);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.visibility === "collapse" ||
        style.contentVisibility === "hidden" ||
        style.opacity === "0"
      ) {
        return false;
      }
    }
    if (current === root) return true;
    current = current.parentElement;
  }
  return false;
}

function collectRenderedPageText(page: HTMLElement): string {
  const showText = page.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = page.ownerDocument.createTreeWalker(page, showText);
  const chunks: string[] = [];
  let previousBlock: Element | null = null;
  let node = walker.nextNode();

  while (node) {
    const parent = node.parentElement;
    const value = node.textContent?.replace(/\s+/g, " ").trim();
    if (parent && value && isRenderedForSyncContext(parent, page)) {
      const block = parent.closest(BLOCK_PAGE_CONTEXT_SELECTOR) ?? page;
      if (chunks.length > 0 && block !== previousBlock) chunks.push("\n");
      chunks.push(value);
      previousBlock = block;
    }
    node = walker.nextNode();
  }

  return chunks.join(" ").replace(/ *\n */g, "\n");
}

/**
 * Captures only text already rendered inside the role-visible application
 * surface. Form values, private-marked regions, scripts, styles, hidden
 * content, attributes, and markup are deliberately excluded.
 */
export function captureSyncPageSnapshot(
  source: ParentNode = document,
): string | undefined {
  const page = source.querySelector<HTMLElement>("[data-sync-page-content]");
  if (!page) return undefined;

  const text = compactVisibleText(collectRenderedPageText(page));
  return text ? text.slice(0, MAX_SYNC_PAGE_SNAPSHOT_CHARS) : undefined;
}

export function questionNeedsPageSnapshot(question: string): boolean {
  return PAGE_CONTEXT_QUERY.test(question);
}

/** Wait briefly for route content and its first data render to settle. */
export async function waitForSyncPageSnapshot(
  source: ParentNode = document,
): Promise<string | undefined> {
  const startedAt = Date.now();
  let lastSnapshot: string | undefined;
  let lastChangeAt = startedAt;

  while (Date.now() - startedAt < PAGE_SNAPSHOT_TIMEOUT_MS) {
    const snapshot = captureSyncPageSnapshot(source);
    if (snapshot !== lastSnapshot) {
      lastSnapshot = snapshot;
      lastChangeAt = Date.now();
    }
    if (
      lastSnapshot &&
      Date.now() - startedAt >= PAGE_SNAPSHOT_MINIMUM_WAIT_MS &&
      Date.now() - lastChangeAt >= PAGE_SNAPSHOT_SETTLE_MS
    ) {
      return lastSnapshot;
    }
    await new Promise<void>((resolve) =>
      globalThis.setTimeout(resolve, PAGE_SNAPSHOT_POLL_MS),
    );
  }
  return lastSnapshot;
}
