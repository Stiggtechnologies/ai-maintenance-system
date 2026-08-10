import { describe, expect, it } from "vitest";
import {
  assessCorpus,
  assessRetrieval,
  type CorpusClassRow,
  type Exclusion,
  type RetrievedChunk,
} from "./index";

const chunk = (o: Partial<RetrievedChunk> = {}): RetrievedChunk => ({
  title: "MIL-HDBK-338B",
  documentClass: "engineering_standard",
  trustRank: 100,
  isClientPrivate: false,
  redistributable: true,
  ...o,
});

const exclusion = (o: Partial<Exclusion> = {}): Exclusion => ({
  documentClass: "oem_marketing",
  label: "OEM brochure or specification sheet",
  chunksMatchedButExcluded: 3,
  rationale:
    "Durability language in a sales document is a claim, not a measurement.",
  ...o,
});

describe("assessRetrieval — the three meanings of an empty result", () => {
  it("distinguishes a refusal from an absence", () => {
    const refused = assessRetrieval([], [exclusion()], "failure_behaviour");
    const absent = assessRetrieval([], [], "failure_behaviour");

    // Both returned zero passages. They mean opposite things and must never
    // render alike: one says "the corpus declined to overreach", the other says
    // "the corpus has nothing".
    expect(refused.verdict).toBe("refused_by_class");
    expect(absent.verdict).toBe("absent");
    expect(refused.reason).not.toBe(absent.reason);
    expect(refused.reason).toMatch(/deliberate refusal, not an absence/);
    expect(absent.reason).toMatch(
      /gap to fill rather than a judgement to trust/,
    );
  });

  it("names what was excluded and how much of it", () => {
    const r = assessRetrieval([], [exclusion()], "failure_behaviour");
    expect(r.reason).toMatch(/3 passage\(s\) matched and were excluded/);
    expect(r.reason).toMatch(/OEM brochure or specification sheet \(3\)/);
    // The class's own rationale travels with the refusal, so the reader learns
    // the rule rather than just being blocked by it.
    expect(r.reason).toMatch(/a claim, not a measurement/);
  });

  it("ranks returned passages by trust and reports the strongest", () => {
    const r = assessRetrieval(
      [
        chunk({
          title: "Client procedure",
          documentClass: "client_supplied",
          trustRank: 75,
          redistributable: false,
          isClientPrivate: true,
        }),
        chunk(),
      ],
      [],
      "failure_behaviour",
    );
    expect(r.verdict).toBe("answered");
    expect(r.citable[0].title).toBe("MIL-HDBK-338B");
    expect(r.strongestSource).toBe(100);
  });

  it("flags client-private and non-redistributable passages separately", () => {
    const r = assessRetrieval(
      [
        chunk({
          documentClass: "client_supplied",
          trustRank: 75,
          redistributable: false,
          isClientPrivate: true,
        }),
      ],
      [],
      "failure_behaviour",
    );
    expect(r.containsClientPrivate).toBe(true);
    expect(r.containsNonRedistributable).toBe(true);
    expect(r.reason).toMatch(/must not leave their tenant/);
    expect(r.reason).toMatch(/do not reproduce them verbatim/);
  });

  it("still reports exclusions when it did find something", () => {
    // The interesting case: a brochure was excluded even though a handbook
    // answered. Dropping that detail hides that the corpus held a tempting
    // wrong answer.
    const r = assessRetrieval([chunk()], [exclusion()], "failure_behaviour");
    expect(r.verdict).toBe("answered");
    expect(r.reason).toMatch(/A further 3 matched and were excluded/);
  });
});

describe("assessCorpus", () => {
  const rows: CorpusClassRow[] = [
    {
      documentClass: "engineering_standard",
      label: "Engineering standard",
      trustRank: 100,
      permittedClaims: [
        "analysis_method",
        "failure_behaviour",
        "component_structure",
        "nameplate_spec",
      ],
      redistributable: true,
      mayBeGlobal: true,
      sharedChunks: 402,
      clientChunks: 0,
      sources: 1,
    },
    {
      documentClass: "government_technical_report",
      label: "Government report",
      trustRank: 90,
      permittedClaims: ["analysis_method", "failure_behaviour"],
      redistributable: true,
      mayBeGlobal: true,
      sharedChunks: 350,
      clientChunks: 0,
      sources: 2,
    },
    {
      documentClass: "oem_service_manual",
      label: "OEM manual",
      trustRank: 80,
      permittedClaims: [
        "component_structure",
        "maintenance_task",
        "nameplate_spec",
      ],
      redistributable: false,
      mayBeGlobal: false,
      sharedChunks: 0,
      clientChunks: 0,
      sources: 0,
    },
    {
      documentClass: "unclassified",
      label: "Unclassified",
      trustRank: 0,
      permittedClaims: [],
      redistributable: false,
      mayBeGlobal: false,
      sharedChunks: 5,
      clientChunks: 0,
      sources: 1,
    },
  ];

  it("separates shared from client-private chunks", () => {
    const r = assessCorpus(rows);
    expect(r.sharedChunks).toBe(757);
    expect(r.clientChunks).toBe(0);
    expect(r.totalChunks).toBe(757);
  });

  it("counts chunks that can be cited for nothing", () => {
    const r = assessCorpus(rows);
    expect(r.unusableChunks).toBe(5);
    expect(r.reason).toMatch(/stored, not usable/);
  });

  it("does not count an empty shelf as coverage", () => {
    // oem_service_manual PERMITS maintenance_task but holds zero chunks. A
    // permission with nothing behind it is not coverage, and treating it as
    // coverage is how a gap goes unnoticed.
    const r = assessCorpus(rows);
    expect(r.claimTypesWithNoSource).toEqual(["maintenance_task"]);
    expect(r.reason).toMatch(/empty shelf rather than a considered refusal/);
  });

  it("catches a global class that may not be redistributed", () => {
    const conflicted = rows.map((r) =>
      r.documentClass === "engineering_standard"
        ? { ...r, redistributable: false }
        : r,
    );
    const r = assessCorpus(conflicted);
    expect(r.policyConflicts).toEqual(["Engineering standard"]);
    expect(r.reason).toMatch(/POLICY CONFLICT/);
    expect(r.reason).toMatch(
      /every tenant can retrieve text none of them may be shown/i,
    );
  });

  it("does not read an empty corpus as a healthy one", () => {
    const r = assessCorpus(
      rows.map((x) => ({ ...x, sharedChunks: 0, clientChunks: 0 })),
    );
    expect(r.totalChunks).toBe(0);
    expect(r.reason).toMatch(
      /reads identically to a question the corpus has considered and declined/,
    );
  });

  it("confirms coverage when every claim type has a stocked source", () => {
    const stocked = rows.map((r) =>
      r.documentClass === "oem_service_manual" ? { ...r, clientChunks: 12 } : r,
    );
    const r = assessCorpus(stocked);
    expect(r.claimTypesWithNoSource).toEqual([]);
    expect(r.clientChunks).toBe(12);
    expect(r.reason).toMatch(
      /Every claim type has at least one source of standing/,
    );
  });
});
