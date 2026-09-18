import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_SYNC_PAGE_SNAPSHOT_CHARS,
  captureSyncPageSnapshot,
  questionNeedsPageSnapshot,
} from "./syncPageContext";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Sync page context", () => {
  it("captures only bounded visible page text and omits form/private content", () => {
    document.body.innerHTML = `
      <main data-sync-page-content>
        <h1>Asset health</h1>
        <p>Pump P-101 needs attention</p>
        <input value="private typed value" />
        <textarea>private draft</textarea>
        <div data-sync-private>private account detail</div>
        <div style="display: none">css-hidden detail</div>
        <div aria-hidden="true">aria-hidden detail</div>
        <script>hiddenScript()</script>
      </main>
    `;

    const snapshot = captureSyncPageSnapshot();

    expect(snapshot).toContain("Asset health");
    expect(snapshot).toContain("Pump P-101 needs attention");
    expect(snapshot).not.toContain("private typed value");
    expect(snapshot).not.toContain("private draft");
    expect(snapshot).not.toContain("private account detail");
    expect(snapshot).not.toContain("css-hidden detail");
    expect(snapshot).not.toContain("aria-hidden detail");
    expect(snapshot).not.toContain("hiddenScript");
  });

  it("returns no snapshot without the governed page root and enforces the cap", () => {
    expect(captureSyncPageSnapshot()).toBeUndefined();
    document.body.innerHTML = `<main data-sync-page-content>${"x".repeat(
      MAX_SYNC_PAGE_SNAPSHOT_CHARS + 500,
    )}</main>`;
    expect(captureSyncPageSnapshot()).toHaveLength(
      MAX_SYNC_PAGE_SNAPSHOT_CHARS,
    );
  });

  it("includes screen text only for questions that depend on the visible page", () => {
    expect(questionNeedsPageSnapshot("What is on this page?")).toBe(true);
    expect(questionNeedsPageSnapshot("What are we looking at here?")).toBe(
      true,
    );
    expect(questionNeedsPageSnapshot("Summarize this dashboard")).toBe(true);
    expect(questionNeedsPageSnapshot("What is this telling me?")).toBe(true);
    expect(questionNeedsPageSnapshot("Explain cavitation generally")).toBe(
      false,
    );
  });
});
