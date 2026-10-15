import { beforeEach, describe, expect, it } from "vitest";
import { contextOperatingFixture } from "../../test/support/syncContextOperatingFixture";
import {
  contextViewKey,
  contextSessionStorage,
  DEFAULT_CONTEXT_VIEW,
  restoreContextView,
  saveContextView,
} from "./view-preferences";
const scope = {
  actorId: "actor-a",
  organizationId: "org-a",
  siteId: null,
  siteName: "All sites",
};
beforeEach(() => sessionStorage.clear());
describe("fresh-response-scoped Context view metadata", () => {
  it("tolerates a throwing storage getter, not just failing storage methods", () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      window,
      "sessionStorage",
    )!;
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new Error("privacy policy");
      },
    });
    try {
      expect(contextSessionStorage()).toBeNull();
      expect(
        restoreContextView(
          contextSessionStorage(),
          scope,
          contextOperatingFixture(),
        ),
      ).toEqual(DEFAULT_CONTEXT_VIEW);
      expect(() =>
        saveContextView(contextSessionStorage(), scope, DEFAULT_CONTEXT_VIEW),
      ).not.toThrow();
    } finally {
      Object.defineProperty(window, "sessionStorage", descriptor);
    }
  });
  it("persists only explicit view metadata, not evidence/source/object payloads", () => {
    const view = {
      ...DEFAULT_CONTEXT_VIEW,
      selectedId: "feature-a",
      viewport: { x: 0, y: 0, width: 1000, height: 500 },
    };
    saveContextView(
      sessionStorage,
      scope,
      Object.assign({}, view, {
        snapshot: contextOperatingFixture(),
        token: "never persist",
      }),
    );
    expect(JSON.parse(sessionStorage.getItem(contextViewKey(scope))!)).toEqual(
      view,
    );
    expect(sessionStorage.getItem(contextViewKey(scope))).not.toMatch(
      /snapshot|token|evidence-a|Synthetic Pump/,
    );
    expect(
      restoreContextView(sessionStorage, scope, contextOperatingFixture())
        .selectedId,
    ).toBe("feature-a");
  });
  it("ignores metadata for different actor, organization or site", () => {
    saveContextView(sessionStorage, scope, {
      ...DEFAULT_CONTEXT_VIEW,
      selectedId: "feature-a",
    });
    for (const other of [
      { ...scope, actorId: "actor-b" },
      { ...scope, organizationId: "org-b" },
      { ...scope, siteId: "site-b" },
    ]) {
      expect(
        restoreContextView(sessionStorage, other, contextOperatingFixture())
          .selectedId,
      ).toBeNull();
    }
  });
  it("does not restore removed/unreadable objects, unknown layers or malformed viewports", () => {
    sessionStorage.setItem(
      contextViewKey(scope),
      JSON.stringify({
        version: 1,
        selectedId: "hidden-risk",
        sourceClass: "invented",
        hiddenLayers: ["assets_sites", "invented"],
        viewport: { x: 0, y: 0, width: -1, height: -1 },
      }),
    );
    expect(
      restoreContextView(sessionStorage, scope, contextOperatingFixture()),
    ).toEqual({ ...DEFAULT_CONTEXT_VIEW, hiddenLayers: ["assets_sites"] });
  });
  it("tolerates unavailable storage without inventing persisted success", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    } as unknown as Storage;
    expect(() =>
      saveContextView(blocked, scope, DEFAULT_CONTEXT_VIEW),
    ).not.toThrow();
    expect(
      restoreContextView(blocked, scope, contextOperatingFixture()),
    ).toEqual(DEFAULT_CONTEXT_VIEW);
  });
});
