import { describe, expect, it } from "vitest";
import { codeSymptom, deriveFailureModes } from "./index";

describe("codeSymptom — refusing most of its input is the point", () => {
  it("codes a real mechanism", () => {
    // Verbatim from the grader change-out data.
    const r = codeSymptom("24M left front duo cone seal is leaking");
    expect(r.classification).toBe("mechanism");
    expect(r.mechanisms).toContain("LEAK");
  });

  it("codes multiple mechanisms when the text describes both", () => {
    const r = codeSymptom(
      "LEFT FRONT DRIVE CHAIN BROKEN. FOUND CRACKED DRIVE GEAR",
    );
    expect(r.classification).toBe("mechanism");
    expect(r.mechanisms).toEqual(["FRACTURE"]);
  });

  it("separates contamination from fracture in one narrative", () => {
    const r = codeSymptom(
      "Found large pieces of metal that appear to be from a broken gear",
    );
    expect(r.mechanisms.sort()).toEqual(["CONTAMINATION", "FRACTURE"]);
  });

  it.each([
    "High Hours",
    "High Hour",
    "Unit Retired",
    "UNIT REBUILD AT KRAMER FEB 2009",
    "BEING REBUILT BY KRAMER",
    "Faulty Engine - Warranty",
  ])("treats %s as administrative, not a failure mode", (text) => {
    const r = codeSymptom(text);
    expect(r.classification).toBe("administrative");
    expect(r.mechanisms).toHaveLength(0);
  });

  it("explains why administrative text is excluded", () => {
    const r = codeSymptom("High Hours");
    expect(r.reason).toMatch(
      /how a failure-mode field ends up meaning nothing/,
    );
  });

  it("lets a described failure win over an administrative reason", () => {
    // Real text: the removal was scheduled AND the part was leaking. The leak
    // is evidence about failure regardless of what prompted the removal.
    const r = codeSymptom(
      "THE RIGHT SIDE IS HOURED OUT AND IS TO BE DONE AT THIS TIME, ALSO LEAKING",
    );
    expect(r.classification).toBe("mechanism");
    expect(r.mechanisms).toContain("LEAK");
    expect(r.reason).toMatch(/whatever prompted the removal/);
  });

  it("declines rather than guesses on text it cannot read", () => {
    const r = codeSymptom("rocker shaft on #4");
    expect(r.classification).toBe("unclassified");
    expect(r.mechanisms).toHaveLength(0);
    expect(r.reason).toMatch(/how unreliable codes get created/);
  });

  it("distinguishes no symptom recorded from no mechanism existing", () => {
    const r = codeSymptom(null);
    expect(r.classification).toBe("unclassified");
    expect(r.reason).toMatch(/different from there being no mechanism/);
  });
});

describe("deriveFailureModes", () => {
  // Verbatim engine symptoms from the 24H/M grader change-out data.
  const engine = [
    "Engine Knocking",
    "Engine Stall",
    "THE ENG WAS DUSTED",
    "ENGINE HAS FAILED CAMSHAFT. # 5 INJECTOR HAD BROKEN",
    "BACK FIRING THROUGH INTAKE,AND FOUND SEVERAL BENT PUSHRODS",
    "HARD FAILURE OF TIMING GEAR TRAIN",
    "High Hour",
    "Unit Retired",
    "Faulty Engine - Warranty",
    "rocker shaft on #4",
  ];

  it("produces candidate modes ranked by evidence", () => {
    const r = deriveFailureModes("ENGINE", "ENGINE-GROUP", engine);
    expect(r.candidateModes.length).toBeGreaterThan(0);
    expect(r.candidateModes[0].evidenceCount).toBeGreaterThanOrEqual(
      r.candidateModes[r.candidateModes.length - 1].evidenceCount,
    );
    // Codes are namespaced to the component so two components can both have
    // a leak mode without colliding.
    expect(r.candidateModes[0].code).toMatch(/^ENGINE-GROUP-/);
  });

  it("excludes the administrative symptoms from the taxonomy", () => {
    const r = deriveFailureModes("ENGINE", "ENGINE-GROUP", engine);
    expect(r.administrativeCount).toBe(3); // High Hour, Unit Retired, Warranty
    const allExamples = r.candidateModes.flatMap((m) => m.examples);
    expect(allExamples).not.toContain("High Hour");
    expect(allExamples).not.toContain("Unit Retired");
  });

  it("surfaces what it could not read instead of dropping it", () => {
    const r = deriveFailureModes("ENGINE", "ENGINE-GROUP", engine);
    expect(r.unclassified).toContain("rocker shaft on #4");
    expect(r.reason).toMatch(/listed for a person rather than guessed at/);
  });

  it("keeps verbatim examples so a reviewer checks the source", () => {
    const r = deriveFailureModes("ENGINE", "ENGINE-GROUP", engine);
    const fracture = r.candidateModes.find((m) => m.code.endsWith("FRACTURE"));
    expect(fracture?.examples.join(" ")).toMatch(/BENT PUSHRODS|BROKEN/);
  });

  it("says a single event is a mechanism and not a rate", () => {
    const r = deriveFailureModes("DIFF", "DIFFERENTIAL", [
      "BROKEN PINION TEETH AND BROKEN BOLT IN DIFF HOUSING",
    ]);
    expect(r.candidateModes[0].evidenceCount).toBe(1);
    expect(r.candidateModes[0].reason).toMatch(
      /a mechanism that has occurred, not a rate/,
    );
  });

  it("reports a component with history and no usable mechanism evidence", () => {
    // Tandem chain RIGHT: 22 scheduled change-outs, every symptom "High Hours".
    const r = deriveFailureModes("TANDEM DRIVE CHAIN RIGHT", "TANDEM-R", [
      "High Hours",
      "High Hours",
      "UNIT REBUILD AT KRAMER FEB 2009",
    ]);
    expect(r.candidateModes).toHaveLength(0);
    expect(r.reason).toMatch(
      /change-out history and no usable mechanism evidence/,
    );
  });
});
