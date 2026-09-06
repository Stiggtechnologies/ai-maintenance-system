import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import type { KpiRow } from "../../services/kpiService";
import {
  HONEST_EMPTY_BRIEF,
  UNNAMED_SPOKEN_WELCOME,
  buildSpokenWelcome,
  hasSessionWelcome,
  markSessionWelcome,
  presenceSessionStorageKey,
  readMutePreference,
  resolveWelcomeGivenName,
  selectPresenceBriefLines,
  shouldSpeakWelcome,
  writeMutePreference,
} from "./welcome";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

function kpiRow(
  overrides: Partial<KpiRow> & Pick<KpiRow, "kpi_key" | "name">,
): KpiRow {
  return {
    page: "executive",
    formula: "catalog",
    target_label: "per catalog",
    direction: "up",
    unit: "%",
    accountable: "Asset Management Director",
    responsible: "Reliability Manager",
    consulted: null,
    informed: null,
    accountability_tier: "executive",
    agent_owner: null,
    computable: true,
    source_note: null,
    value: null,
    status: null,
    variance_pct: null,
    confidence: null,
    computed_from: null,
    computed_at: null,
    ...overrides,
  };
}

describe("presence welcome speech gate", () => {
  it("speaks once per session when enabled and signed in", () => {
    const session = memoryStorage();
    const userId = "user-orville";

    const first = shouldSpeakWelcome({
      signedIn: true,
      muted: false,
      alreadyWelcomedThisSession: hasSessionWelcome(session, userId),
      voiceOutputEnabled: true,
    });
    expect(first).toBe(true);
    markSessionWelcome(session, userId);

    const second = shouldSpeakWelcome({
      signedIn: true,
      muted: false,
      alreadyWelcomedThisSession: hasSessionWelcome(session, userId),
      voiceOutputEnabled: true,
    });
    expect(second).toBe(false);
    expect(session.getItem(presenceSessionStorageKey(userId))).toBe("1");
  });

  it("does not welcome a signed-out visitor", () => {
    expect(
      shouldSpeakWelcome({
        signedIn: false,
        muted: false,
        alreadyWelcomedThisSession: false,
        voiceOutputEnabled: true,
      }),
    ).toBe(false);
  });

  it("does not welcome when muted", () => {
    expect(
      shouldSpeakWelcome({
        signedIn: true,
        muted: true,
        alreadyWelcomedThisSession: false,
        voiceOutputEnabled: true,
      }),
    ).toBe(false);
  });

  it("does not speak when sync_voice_output is off", () => {
    expect(
      shouldSpeakWelcome({
        signedIn: true,
        muted: false,
        alreadyWelcomedThisSession: false,
        voiceOutputEnabled: false,
      }),
    ).toBe(false);
  });
});

describe("presence mute preference", () => {
  it("persists mute across a later read of the same store", () => {
    const persistent = memoryStorage();
    expect(readMutePreference(persistent)).toBe(false);

    writeMutePreference(persistent, true);
    expect(readMutePreference(persistent)).toBe(true);

    // Simulate a later visit: same storage, new reader.
    expect(readMutePreference(persistent)).toBe(true);

    writeMutePreference(persistent, false);
    expect(readMutePreference(persistent)).toBe(false);
  });
});

describe("presence welcome name", () => {
  it("uses the given name from the profile when available", () => {
    expect(resolveWelcomeGivenName({ fullName: "Orville Davis" })).toBe(
      "Orville",
    );
    expect(buildSpokenWelcome("Orville")).toBe(
      "Welcome Orville. I'm Sync, Reliability Engineer. What Decision Case or plant subject should we work on? I recommend; I do not authorize.",
    );
  });

  it("falls back without inventing a name from email or a default", () => {
    expect(
      resolveWelcomeGivenName({
        fullName: null,
        metadataName: "orville@syncai.ca",
      }),
    ).toBeNull();
    expect(resolveWelcomeGivenName({ fullName: "   " })).toBeNull();
    expect(resolveWelcomeGivenName({})).toBeNull();
    expect(buildSpokenWelcome(null)).toBe(UNNAMED_SPOKEN_WELCOME);
    expect(buildSpokenWelcome(null)).not.toMatch(/Orville/);
  });
});

describe("presence brief honesty", () => {
  it("shows 1–3 live KPI lines when sourced values exist", () => {
    const lines = selectPresenceBriefLines([
      kpiRow({ kpi_key: "oee", name: "OEE", value: 62, unit: "%" }),
      kpiRow({
        kpi_key: "asset_risk_index",
        name: "Asset risk index",
        value: 1.4,
        unit: null,
      }),
      kpiRow({
        kpi_key: "cost_of_downtime",
        name: "Cost of downtime",
        value: 12000,
        unit: "USD",
      }),
      kpiRow({
        kpi_key: "extra",
        name: "Should not appear",
        value: 99,
        unit: "%",
      }),
    ]);

    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("OEE: 62%");
    expect(lines[1]).toBe("Asset risk index: 1.4");
    expect(lines[2]).toBe("Cost of downtime: $12K");
    expect(lines.join("\n")).not.toMatch(/Should not appear/);
  });

  it("uses honest empty lines when KPIs are unavailable or unsourced", () => {
    expect(selectPresenceBriefLines(null, { unavailable: true })).toEqual([
      ...HONEST_EMPTY_BRIEF,
    ]);
    expect(selectPresenceBriefLines([])).toEqual([...HONEST_EMPTY_BRIEF]);
    expect(
      selectPresenceBriefLines([
        kpiRow({ kpi_key: "oee", name: "OEE", value: null }),
      ]),
    ).toEqual([...HONEST_EMPTY_BRIEF]);

    const empty = selectPresenceBriefLines(null, { unavailable: true }).join(
      " ",
    );
    expect(empty).toMatch(/does not report plant state/i);
    expect(empty).not.toMatch(/\b(healthy|87%|online|running)\b/i);
    expect(empty).not.toMatch(/autonomous control/i);
  });

  it("never puts plant claims into the spoken welcome", () => {
    const spoken = buildSpokenWelcome("Orville");
    expect(spoken).toMatch(/Reliability Engineer/);
    expect(spoken).toMatch(/Decision Case/);
    expect(spoken).toMatch(/I recommend; I do not authorize/);
    expect(spoken).not.toMatch(/OEE|healthy|87%/i);
    expect(UNNAMED_SPOKEN_WELCOME).toMatch(/Reliability Engineer/);
    expect(UNNAMED_SPOKEN_WELCOME).not.toMatch(/OEE|healthy|87%/i);
    expect(spoken).not.toMatch(/Claude Code|fullstack-agent|Obsidian/i);
  });
});

describe("presence boundary", () => {
  it("stays a shell welcome and does not revive parallel orchestrators", () => {
    const files = [
      "src/lib/presence/welcome.ts",
      "src/lib/presence/booth.ts",
      "src/lib/presence/askBooth.ts",
      "src/lib/presence/state.ts",
      "src/lib/presence/memory.ts",
      "src/components/PresenceWelcome.tsx",
      "src/components/PresenceBoothConversation.tsx",
      "src/components/PresenceFace.tsx",
    ];
    for (const path of files) {
      const imports = readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line.includes("import "))
        .join("\n");
      expect(imports, path).not.toMatch(
        /openclaw|javis|jarvis|sir-runtime|autonomous-orchestrator/i,
      );
    }
    expect(readFileSync("src/components/AppShell.tsx", "utf8")).toContain(
      "<PresenceWelcome />",
    );
    expect(readFileSync("src/lib/presence/welcome.ts", "utf8")).toContain(
      "Recommend ≠ authorize",
    );
    const welcomeUi = readFileSync(
      "src/components/PresenceWelcome.tsx",
      "utf8",
    );
    expect(welcomeUi).toContain('useFeatureFlag("sync_voice_output")');
    expect(welcomeUi).toContain("border-signal-cyan/40 bg-signal-cyan/10");
    expect(welcomeUi).toContain('className="mt-1 text-[11px] text-slate-500"');
    expect(welcomeUi).toContain("!boothOpen && briefLines.length > 0");
  });
});

describe("presence session isolation", () => {
  let session: Storage;

  beforeEach(() => {
    session = memoryStorage();
  });

  it("does not treat another user's session mark as this user's welcome", () => {
    markSessionWelcome(session, "user-a");
    expect(hasSessionWelcome(session, "user-a")).toBe(true);
    expect(hasSessionWelcome(session, "user-b")).toBe(false);
    expect(
      shouldSpeakWelcome({
        signedIn: true,
        muted: false,
        alreadyWelcomedThisSession: hasSessionWelcome(session, "user-b"),
        voiceOutputEnabled: true,
      }),
    ).toBe(true);
  });
});
