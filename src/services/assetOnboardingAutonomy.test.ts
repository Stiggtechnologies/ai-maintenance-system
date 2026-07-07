import { describe, expect, it } from "vitest";
import {
  formatItemValue,
  groupChecklistBySection,
  isItemHumanQueue,
  isItemSatisfied,
  ITEM_STATUS_META,
  type OnboardingItem,
  type OnboardingItemStatus,
  type OnboardingRequirement,
} from "./assetOnboardingAutonomy";

function makeRequirement(
  overrides: Partial<OnboardingRequirement> = {},
): OnboardingRequirement {
  return {
    key: "s1_asset_name",
    section_number: 1,
    section_title: "Asset Identification",
    item_label: "Asset name",
    hint: null,
    fill_strategy: "record",
    required_for_golive: true,
    sort_order: 10,
    ...overrides,
  };
}

function makeItem(overrides: Partial<OnboardingItem> = {}): OnboardingItem {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    asset_id: "aaaaaaaa-0000-0000-0000-000000000002",
    requirement_key: "s1_asset_name",
    status: "auto_filled",
    value: null,
    source: "asset_record",
    confidence: "high",
    note: null,
    filled_at: null,
    requirement: makeRequirement(),
    ...overrides,
  };
}

describe("isItemSatisfied / isItemHumanQueue", () => {
  it("treats auto, deduced, human and n/a as satisfied", () => {
    for (const status of [
      "auto_filled",
      "deduced",
      "human_provided",
      "not_applicable",
    ] as OnboardingItemStatus[]) {
      expect(isItemSatisfied(status)).toBe(true);
      expect(isItemHumanQueue(status)).toBe(false);
    }
  });

  it("routes human_required and pending_ai to the human queue", () => {
    expect(isItemHumanQueue("human_required")).toBe(true);
    expect(isItemHumanQueue("pending_ai")).toBe(true);
    expect(isItemSatisfied("human_required")).toBe(false);
    expect(isItemSatisfied("pending_ai")).toBe(false);
  });

  it("has display metadata for every status", () => {
    const statuses: OnboardingItemStatus[] = [
      "pending",
      "auto_filled",
      "deduced",
      "pending_ai",
      "human_required",
      "human_provided",
      "not_applicable",
    ];
    for (const status of statuses) {
      expect(ITEM_STATUS_META[status].label.length).toBeGreaterThan(0);
    }
  });
});

describe("groupChecklistBySection", () => {
  it("groups items into ordered sections with satisfaction counts", () => {
    const items = [
      makeItem({
        id: "1",
        requirement: makeRequirement({
          key: "s9_fmea",
          section_number: 9,
          section_title: "Failure Modes (FMEA)",
          sort_order: 10,
        }),
        status: "auto_filled",
      }),
      makeItem({
        id: "2",
        requirement: makeRequirement({ key: "s1_b", sort_order: 20 }),
        status: "human_required",
      }),
      makeItem({
        id: "3",
        requirement: makeRequirement({ key: "s1_a", sort_order: 10 }),
        status: "deduced",
      }),
    ];

    const sections = groupChecklistBySection(items);
    expect(sections.map((s) => s.sectionNumber)).toEqual([1, 9]);
    expect(sections[0].satisfied).toBe(1);
    expect(sections[0].items.map((i) => i.id)).toEqual(["3", "2"]);
    expect(sections[1].sectionTitle).toBe("Failure Modes (FMEA)");
    expect(sections[1].satisfied).toBe(1);
  });

  it("skips items without an embedded requirement", () => {
    const broken = makeItem();
    // Simulate a PostgREST row where the embed failed.
    (broken as { requirement: OnboardingRequirement | null }).requirement =
      null;
    expect(groupChecklistBySection([broken])).toEqual([]);
  });
});

describe("formatItemValue", () => {
  it("prefers summary, strategy, level and path shapes", () => {
    expect(formatItemValue({ summary: "Delivers 250 m3/hr at 6 bar" })).toBe(
      "Delivers 250 m3/hr at 6 bar",
    );
    expect(formatItemValue({ strategy: "CBM + PdM" })).toBe("CBM + PdM");
    expect(formatItemValue({ level: "A / Critical", basis: "risk 82" })).toBe(
      "A / Critical — risk 82",
    );
    expect(formatItemValue({ path: "Site → Mine → Fleet" })).toBe(
      "Site → Mine → Fleet",
    );
  });

  it("flattens scalar records and handles plain strings and null", () => {
    expect(formatItemValue("critical")).toBe("critical");
    expect(formatItemValue(null)).toBe("");
    expect(formatItemValue({ mtbf_days: 340, unit: "days" })).toBe(
      "mtbf days: 340 · unit: days",
    );
  });

  it("truncates long values", () => {
    const long = "x".repeat(500);
    expect(formatItemValue({ summary: long }).length).toBe(160);
    expect(formatItemValue({ summary: long }).endsWith("…")).toBe(true);
  });
});
