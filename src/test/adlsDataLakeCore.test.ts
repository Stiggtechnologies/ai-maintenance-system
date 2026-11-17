import { describe, expect, it } from "vitest";
import {
  applyDataLakeMapping,
  encodeObjectPath,
  parseDataLakeObject,
  selectAdlsObjects,
  sha256Hex,
  withoutDataLakeProvenance,
} from "../../supabase/functions/_shared/adls-data-lake";

describe("ADLS data-lake transport core", () => {
  it("parses RFC 4180 CSV without corrupting commas, quotes or newlines", () => {
    expect(
      parseDataLakeObject(
        'id,note\r\nA-1,"seal, pressure tested"\r\nA-2,"line one\nline two"\r\n',
        "csv",
        "",
      ),
    ).toEqual([
      { id: "A-1", note: "seal, pressure tested" },
      { id: "A-2", note: "line one\nline two" },
    ]);
  });

  it("refuses malformed CSV and non-object JSONL rows", () => {
    expect(() => parseDataLakeObject('id,note\nA-1,"open', "csv", "")).toThrow(
      "unterminated",
    );
    expect(() => parseDataLakeObject('{"id":"A"}\n[]', "jsonl", "")).toThrow(
      "must be a JSON object",
    );
  });

  it("selects a bounded deterministic modified-time/path window", () => {
    const result = selectAdlsObjects(
      [
        {
          name: "landing/a.csv",
          contentLength: "20",
          lastModified: "Tue, 01 Sep 2026 00:00:00 GMT",
          etag: '"a"',
        },
        {
          name: "landing/B.csv",
          contentLength: "10",
          lastModified: "Tue, 01 Sep 2026 00:00:00 GMT",
          etag: '"B"',
        },
        {
          name: "landing/old.csv",
          contentLength: "5",
          lastModified: "Mon, 31 Aug 2026 00:00:00 GMT",
          etag: '"old"',
        },
        {
          name: "landing/ignored.json",
          contentLength: "5",
          lastModified: "Wed, 02 Sep 2026 00:00:00 GMT",
          etag: '"json"',
        },
      ],
      "landing/",
      "csv",
      {
        last_modified: "Mon, 31 Aug 2026 00:00:00 GMT",
        path: "landing/old.csv",
      },
      1,
    );
    expect(result.objects.map((item) => item.path)).toEqual(["landing/B.csv"]);
    expect(result.cursor?.path).toBe("landing/B.csv");
  });

  it("never silently drops malformed matching metadata and respects byte bounds", () => {
    expect(() =>
      selectAdlsObjects(
        [
          {
            name: "landing/bad.csv",
            contentLength: "not-a-number",
            lastModified: "Tue, 01 Sep 2026 00:00:00 GMT",
            etag: '"bad"',
          },
        ],
        "landing/",
        "csv",
        null,
        10,
        100,
      ),
    ).toThrow("immutable metadata");
    expect(() =>
      selectAdlsObjects(
        [
          {
            name: "landing/large.csv",
            contentLength: "101",
            lastModified: "Tue, 01 Sep 2026 00:00:00 GMT",
            etag: '"large"',
          },
        ],
        "landing/",
        "csv",
        null,
        10,
        100,
      ),
    ).toThrow("byte limit");
  });

  it("maps dotted fields and attaches immutable object provenance", () => {
    expect(
      applyDataLakeMapping(
        { source: { id: "A-1", state: "REL" } },
        { external_id: "source.id", status: "source.state" },
        { status: { REL: "scheduled" } },
        { site_external_id: "SITE-1" },
        { path: "landing/a.json", sha256: "abc" },
      ),
    ).toEqual({
      external_id: "A-1",
      status: "scheduled",
      site_external_id: "SITE-1",
      _sync_source: { path: "landing/a.json", sha256: "abc" },
    });
  });

  it("removes only the transport envelope for write-free canonical preview", () => {
    expect(
      withoutDataLakeProvenance({
        external_id: "A-1",
        name: "Asset one",
        _sync_source: { path: "landing/a.json", sha256: "abc" },
      }),
    ).toEqual({ external_id: "A-1", name: "Asset one" });
  });

  it("encodes path segments, refuses traversal and hashes exact bytes", async () => {
    expect(encodeObjectPath("landing/shift one.csv")).toBe(
      "landing/shift%20one.csv",
    );
    expect(() => encodeObjectPath("landing/../secret.csv")).toThrow("unsafe");
    await expect(sha256Hex(new TextEncoder().encode("SyncAI"))).resolves.toBe(
      "a05ade429b4a33543d5572a1db0a67f9a1574677434a87a224f9312cf27818b2",
    );
  });
});
