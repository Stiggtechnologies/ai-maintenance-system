import { describe, expect, it } from "vitest";
import {
  DEVELOP_COMPOSITION_BOUNDARY,
  DEVELOP_ENGINES,
  DEVELOP_MODULES,
  DEVELOP_OVERLAYS,
  developModuleHref,
} from "./composition";

describe("Sync Develop composition contract", () => {
  it("pins the eight engines in lifecycle order with unique live anchors", () => {
    expect(DEVELOP_ENGINES.map((engine) => engine.key)).toEqual([
      "frame",
      "value",
      "govern",
      "design",
      "control",
      "deliver",
      "ready",
      "realize",
    ]);
    expect(new Set(DEVELOP_ENGINES.map((engine) => engine.anchor)).size).toBe(
      8,
    );
    expect(
      DEVELOP_ENGINES.every(
        (engine) => engine.anchor === `engine-${engine.key}`,
      ),
    ).toBe(true);
  });

  it("maps all fifteen product modules onto one of the eight engines", () => {
    expect(DEVELOP_MODULES.map((module) => module.key)).toEqual([
      "frame",
      "value",
      "govern",
      "risk",
      "design",
      "control",
      "supply",
      "field",
      "ready",
      "handover",
      "reliability",
      "recovery",
      "realize",
      "learn",
      "portfolio",
    ]);
    const engines = new Set(DEVELOP_ENGINES.map((engine) => engine.key));
    expect(DEVELOP_MODULES.every((module) => engines.has(module.engine))).toBe(
      true,
    );
    expect(new Set(DEVELOP_MODULES.map((module) => module.key)).size).toBe(15);
  });

  it("resolves every module to a case section or an existing routed surface", () => {
    const hrefs = DEVELOP_MODULES.map((module) =>
      developModuleHref(module, "case / 17"),
    );
    expect(
      hrefs.every((href) => href.startsWith("#") || href.startsWith("/")),
    ).toBe(true);
    expect(hrefs).toContain("/sync-field?case=case%20%2F%2017");
    expect(hrefs).toContain("/design");
    expect(hrefs).not.toContain("/design?case=case%20%2F%2017");
    expect(hrefs).toContain("/recovery");
    expect(hrefs).not.toContain("#");
  });

  it("keeps the seven surrounding overlays and deterministic authority boundary explicit", () => {
    expect(DEVELOP_OVERLAYS).toEqual([
      "Risk",
      "Quality",
      "Sustainability",
      "HOP",
      "Stakeholders",
      "Evidence",
      "AI",
    ]);
    expect(DEVELOP_COMPOSITION_BOUNDARY.data).toContain(
      "shared canonical data model",
    );
    expect(DEVELOP_COMPOSITION_BOUNDARY.authority).toContain(
      "never grants approval authority",
    );
    expect(DEVELOP_COMPOSITION_BOUNDARY.ai).toContain("cannot pass a gate");
  });
});
