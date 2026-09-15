export const MAX_SYNC_PAGE_SNAPSHOT_CHARS = 8_000;
const PAGE_SNAPSHOT_TIMEOUT_MS = 4_000;
const PAGE_SNAPSHOT_MINIMUM_WAIT_MS = 700;
const PAGE_SNAPSHOT_SETTLE_MS = 300;
const PAGE_SNAPSHOT_POLL_MS = 100;

const PAGE_CONTEXT_QUERY =
  /\b(?:this|current|open|opened|visible)\s+(?:page|screen|view)\b|\b(?:page|screen)\s+(?:shows?|contains?|displays?)\b|\bwhat(?:'s| is)\s+(?:on|shown|displayed)\b|\bwhat (?:am i|are we) looking at\b|\bwhat do you see\b/i;

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

  const copy = page.cloneNode(true) as HTMLElement;
  copy
    .querySelectorAll(EXCLUDED_PAGE_CONTEXT_SELECTOR)
    .forEach((element) => element.remove());
  const text = compactVisibleText(copy.innerText || copy.textContent || "");
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
