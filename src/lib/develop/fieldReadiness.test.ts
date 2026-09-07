import { describe, expect, it } from "vitest";
import {
  FIELD_READY_ELEMENTS,
  FIELD_READY_ELEMENT_TO_KIND,
  FIELD_READY_STATES,
  RECOVERY_START_GATE_ELEMENTS,
  fieldReadyCoverage,
  fieldReadyElement,
  fieldReadyTone,
  isFieldReadyElementKey,
  isStoreDerivedFieldReadyRow,
} from "./fieldReadiness";
import { SPEC28_TO_CANONICAL_KIND } from "./workPackaging";

describe("the ten elements are ten, and seven of them have a store", () => {
  it("names exactly ten elements, with unique keys", () => {
    expect(FIELD_READY_ELEMENTS).toHaveLength(10);
    const keys = FIELD_READY_ELEMENTS.map((e) => e.key);
    expect(new Set(keys).size).toBe(10);
  });

  it("counts its own coverage instead of asserting a number beside it", () => {
    // D7.12's row claims "7 of 10 have canonical objects". That claim is
    // DERIVED here, so an eleventh element or a new store moves it rather than
    // leaving a stale sentence in the register.
    expect(fieldReadyCoverage()).toEqual({
      total: 10,
      derived: 7,
      declared: 3,
    });
  });

  it("gives every derived element a named store and every declared one none", () => {
    for (const element of FIELD_READY_ELEMENTS) {
      if (element.basisKind === "derived") {
        expect(element.source, element.key).not.toBe("none");
        expect(element.source.length, element.key).toBeGreaterThan(3);
      } else {
        // The point of the three: nothing answers them, and the vocabulary
        // says so rather than pointing at a table that does not hold it.
        expect(element.source, element.key).toBe("none");
      }
    }
  });

  it("names the three that cannot be verified, exactly", () => {
    const declared = FIELD_READY_ELEMENTS.filter(
      (e) => e.basisKind === "declared",
    ).map((e) => e.key);
    expect(declared).toEqual(["crew", "access", "predecessor"]);
  });

  it("maps every element onto a canonical constraint kind, and adds none", () => {
    // RULING 20's vocabulary, not a parallel one. The authoritative list is
    // the twenty values in the `restoration_constraints.constraint_kind`
    // CHECK, and `src/test/developSlice7bMigration.test.ts` asserts every kind
    // below against THAT — the SQL, not a copy of it.
    //
    // Nine of the ten land on a §28 type's canonical name. The tenth is
    // `tools -> tooling`, and it is named here rather than smoothed over:
    // `tooling` is one of the seventeen kinds this store carried BEFORE Slice
    // 7A and is not one of §28's ten, so an assertion that every element maps
    // into the ten would have been false — and passing it would have meant
    // renaming a live kind to make a test green.
    const spec28 = new Set(Object.values(SPEC28_TO_CANONICAL_KIND));
    const preExisting = new Set(["tooling"]);
    for (const element of FIELD_READY_ELEMENTS) {
      const kind = FIELD_READY_ELEMENT_TO_KIND[element.key];
      expect(kind, element.key).toBeTruthy();
      expect(
        spec28.has(kind) || preExisting.has(kind),
        `${element.key} -> ${kind}`,
      ).toBe(true);
    }
    expect(
      Object.values(FIELD_READY_ELEMENT_TO_KIND).filter((k) => !spec28.has(k)),
    ).toEqual(["tooling"]);
  });
});

describe("the states, and the third answer", () => {
  it("carries `unverifiable` beside ready and blocked", () => {
    expect([...FIELD_READY_STATES]).toEqual([
      "ready",
      "blocked",
      "not_applicable",
      "unverifiable",
    ]);
  });

  it("does not tone an unverifiable element as if it were ready", () => {
    // The whole failure mode in one assertion: if `unverifiable` rendered in
    // the same register as `ready`, a supervisor reading the board would see
    // an unchecked element as a cleared one.
    expect(fieldReadyTone("unverifiable")).toBe("caution");
    expect(fieldReadyTone("ready")).toBe("positive");
    expect(fieldReadyTone("blocked")).toBe("negative");
    expect(fieldReadyTone("not_applicable")).toBe("neutral");
    expect(fieldReadyTone("")).toBe("unknown");
    expect(fieldReadyTone("nearly")).toBe("unknown");
  });
});

describe("the lookups refuse what they do not know", () => {
  it("recognises the ten and nothing else", () => {
    expect(isFieldReadyElementKey("materials")).toBe(true);
    expect(isFieldReadyElementKey("Materials")).toBe(false);
    expect(isFieldReadyElementKey("weather")).toBe(false);
    expect(isFieldReadyElementKey("")).toBe(false);
  });

  it("returns null rather than a placeholder element", () => {
    expect(fieldReadyElement("weather")).toBeNull();
    expect(fieldReadyElement("scope")?.label).toBe("Approved scope");
  });
});

describe("the client reads the server's provenance, and states no rule of its own", () => {
  it("recognises a row the assessment derived from a canonical store", () => {
    // `clear_package_constraint` refuses a hand clearance on exactly these
    // rows (20261211090200). The screen reads the prefix rather than deciding
    // for itself which constraints are toggleable.
    expect(
      isStoreDerivedFieldReadyRow(
        "awp-field-ready:derived:materials:6f7c8d90-0000-4000-8000-000000000001",
      ),
    ).toBe(true);
  });

  it("does NOT claim a declared question, which a person is the only way to answer", () => {
    // The declared rows carry the same source_kind and a DIFFERENT prefix, and
    // they must stay clearable: a person's answer is their whole discharge
    // path. Discriminating on source_kind alone would have frozen them.
    expect(
      isStoreDerivedFieldReadyRow(
        "awp-field-ready:declared:crew:6f7c8d90-0000-4000-8000-000000000001",
      ),
    ).toBe(false);
  });

  it("treats an absent or hand-recorded provenance as not derived", () => {
    expect(isStoreDerivedFieldReadyRow(null)).toBe(false);
    expect(isStoreDerivedFieldReadyRow(undefined)).toBe(false);
    expect(isStoreDerivedFieldReadyRow("")).toBe(false);
    expect(isStoreDerivedFieldReadyRow("recovery-v2:material:x")).toBe(false);
  });
});

describe("Recovery's start gate is the historical two", () => {
  it("keeps Recovery's gate at the two elements it has always refused on", () => {
    // Slice 7B moved where the material and isolation rules LIVE. It did not
    // widen what start_restoration_work refuses, and this is the assertion
    // that would fail if a later change did it by accident.
    expect([...RECOVERY_START_GATE_ELEMENTS]).toEqual([
      "materials",
      "isolation",
    ]);
  });
});

describe("what this module refuses to contain", () => {
  it("exports no readiness verdict and no element evaluator", async () => {
    // The same guard workPackaging.test.ts carries, for the same reason: the
    // reachability gate caught `packageLateness` in 6A and 6B deleted
    // `warrantyCover`. There is ONE field-readiness predicate
    // (sync_field_readiness_elements) and ONE release verdict
    // (sync_work_package_release_verdict), both server-side.
    const mod = (await import("./fieldReadiness")) as Record<string, unknown>;
    const names = Object.keys(mod);
    for (const banned of [
      "evaluateElements",
      "isFieldReady",
      "assessReadiness",
      "packageReadiness",
      "computeReadiness",
      "readinessVerdict",
    ]) {
      expect(names, banned).not.toContain(banned);
    }
    // Nothing here takes a work order, a package or a set of stores and
    // answers the server's question.
    expect(
      names.filter((n) => /^(evaluate|assess|compute|derive|verdict)/i.test(n)),
    ).toEqual([]);
  });
});
