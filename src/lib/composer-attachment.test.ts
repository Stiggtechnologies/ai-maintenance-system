import { describe, expect, it } from "vitest";
import {
  MAX_ATTACHMENT_BYTES,
  formatAttachmentForMessage,
  isRefusal,
  profileAttachment,
  refuseFileType,
} from "./composer-attachment";

function file(name: string, content: string): File {
  return new File([content], name, { type: "text/csv" });
}

const CSV = [
  "wo_number,asset,description,hours",
  "WO-1,Pump P-101,Seal leak,4",
  "WO-2,Conveyor C-22,Bearing noise,6",
].join("\n");

describe("refuseFileType", () => {
  it("accepts delimited text", () => {
    for (const n of ["a.csv", "a.CSV", "b.tsv", "c.txt", "d.log"]) {
      expect(refuseFileType(n)).toBeNull();
    }
  });

  // Each refusal must say WHICH gap it is — a missing parser or a missing
  // capability. "Unsupported file type" teaches a prospect nothing.
  it("tells a spreadsheet user the workaround", () => {
    expect(refuseFileType("history.xlsx")).toMatch(/export the sheet as CSV/i);
  });

  it("admits audio transcription does not exist rather than implying it might", () => {
    const r = refuseFileType("walkdown.m4a");
    expect(r).toMatch(/not built yet/i);
    expect(r).toMatch(/microphone button to dictate/i);
  });

  it("points documents at pasting rather than silently failing", () => {
    expect(refuseFileType("manual.pdf")).toMatch(/paste the relevant passage/i);
  });
});

describe("profileAttachment", () => {
  it("profiles a CSV without uploading it", async () => {
    const r = await profileAttachment(file("wos.csv", CSV));
    expect(isRefusal(r)).toBe(false);
    if (isRefusal(r)) return;
    expect(r.rowCount).toBe(2);
    expect(r.headers).toEqual(["wo_number", "asset", "description", "hours"]);
    expect(r.sampleRows).toHaveLength(2);
  });

  it("refuses a header-only file — there is nothing to discuss", async () => {
    const r = await profileAttachment(file("empty.csv", "a,b,c"));
    expect(isRefusal(r) && r.error).toMatch(
      /header row and at least one data row/i,
    );
  });

  it("refuses an oversized file with the actual limit", async () => {
    const big = file("big.csv", "x".repeat(MAX_ATTACHMENT_BYTES + 1));
    const r = await profileAttachment(big);
    expect(isRefusal(r) && r.error).toMatch(/limit here is 5 MB/i);
  });

  it("refuses by type before reading the bytes", async () => {
    const r = await profileAttachment(file("sheet.xlsx", CSV));
    expect(isRefusal(r)).toBe(true);
  });
});

describe("formatAttachmentForMessage", () => {
  it("states exactly what left the browser", async () => {
    const r = await profileAttachment(file("wos.csv", CSV));
    if (isRefusal(r)) throw new Error("expected a profile");
    const msg = formatAttachmentForMessage(r);
    expect(msg).toContain("wos.csv");
    expect(msg).toContain("2 rows × 4 columns");
    expect(msg).toContain("wo_number, asset, description, hours");
    // The disclosure is the point: the person can audit the message in their
    // own transcript and see the file itself never travelled.
    expect(msg).toMatch(/the file itself stayed in the browser/i);
  });

  it("truncates long cells so one wide column cannot dump the row", async () => {
    const wide = ["h1,h2", `${"z".repeat(200)},ok`].join("\n");
    const r = await profileAttachment(file("wide.csv", wide));
    if (isRefusal(r)) throw new Error("expected a profile");
    expect(formatAttachmentForMessage(r)).toContain("…");
  });
});
