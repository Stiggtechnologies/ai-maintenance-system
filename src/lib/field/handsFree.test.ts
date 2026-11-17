import { describe, expect, it } from "vitest";
import {
  fieldFilingOutcome,
  filedMessage,
  isAssetId,
  parseFieldVoice,
} from "./handsFree";

const ASSET = "3f2a9c1e-8b7d-4e6f-9a1b-2c3d4e5f6a7b";

describe("parseFieldVoice", () => {
  it("maps whole-phrase commands, ignoring case and punctuation", () => {
    expect(parseFieldVoice("Send report.")).toEqual({ kind: "send" });
    expect(parseFieldVoice("  CLEAR ")).toEqual({ kind: "clear" });
    expect(parseFieldVoice("Safety")).toEqual({ kind: "set-type", value: "safety" });
    expect(parseFieldVoice("type fault")).toEqual({ kind: "set-type", value: "fault" });
  });

  it("never swallows an observation that merely contains a command word", () => {
    expect(parseFieldVoice("Ground fault on the pump motor")).toEqual({
      kind: "dictation",
      text: "Ground fault on the pump motor",
    });
    expect(parseFieldVoice("send the guard back to the shop")).toEqual({
      kind: "dictation",
      text: "send the guard back to the shop",
    });
  });

  it("does not treat photo requests as commands (browsers need a real tap)", () => {
    expect(parseFieldVoice("take photo").kind).toBe("dictation");
  });
});

describe("fieldFilingOutcome", () => {
  it("refuses without an asset, and says why", () => {
    const out = fieldFilingOutcome({ asset: null, text: "Seal weep" });
    expect(out).toEqual({ fileable: false, reason: expect.stringMatching(/Add the asset first/) });
  });

  it("refuses a tag that is not an asset id", () => {
    const out = fieldFilingOutcome({ asset: "T301", text: "Seal weep" });
    expect(out.fileable).toBe(false);
    if (!out.fileable) expect(out.reason).toMatch(/"T301" is a tag, not an asset ID/);
  });

  it("refuses an empty description", () => {
    expect(fieldFilingOutcome({ asset: ASSET, text: "   " }).fileable).toBe(false);
    expect(fieldFilingOutcome({ asset: ASSET, text: "leak" }).fileable).toBe(false);
  });

  it("accepts an asset id with a description", () => {
    expect(fieldFilingOutcome({ asset: ASSET, text: "Seal weep" })).toEqual({ fileable: true });
    expect(isAssetId(ASSET)).toBe(true);
    expect(isAssetId("T301")).toBe(false);
  });

  it("states the human review boundary when filed", () => {
    expect(filedMessage({ notificationId: "n-9", type: "fault", withPhoto: true })).toMatch(
      /Filed as a fault notification with photo \(n-9\)\. It stays open until a person screens it/,
    );
  });
});
