/**
 * The Data Room's write paths, and the three ways they used to lie.
 *
 * Every test here is about the difference between "the database did the thing"
 * and "the call returned". PostgREST reports an RLS refusal as zero rows and
 * NO error; supabase-js reports a storage failure in a `.error` field nobody
 * has to read; and a boolean column can be set to a hopeful value long before
 * the fact it describes is true. All three produce a green tick over a failure.
 *
 *   uploadSource      removed the orphaned object on a refused metadata insert
 *                     and never checked whether the removal itself was refused
 *                     — and it CAN be, because ria_source_files_delete matches
 *                     the uploader on owner/owner_id and storage-api does not
 *                     always populate the deprecated `owner`. The file then
 *                     sits in the bucket as unaccounted-for raw customer data:
 *                     exactly the litter the policy comment says it prevents.
 *   retireSource      wrote the audit stub and stopped. `raw_retained` stayed
 *                     true forever because nothing anywhere set it false, and
 *                     the storage policy refused to delete any object a source
 *                     row referenced — which retirement keeps. The customer was
 *                     told the raw export was gone; it was undeletable.
 *   upsertAlias       hardcoded `p_canonical_asset_id: null`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const from = vi.fn();
const upload = vi.fn();
const remove = vi.fn();
const getUser = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (...args: unknown[]) => from(...args),
    auth: { getUser: () => getUser() },
    storage: {
      from: () => ({
        upload: (...args: unknown[]) => upload(...args),
        remove: (...args: unknown[]) => remove(...args),
      }),
    },
  },
}));

const { retireSource, uploadSource, upsertAlias, loadCanonicalAssets } =
  await import("./riaDataRoom");

const ORG = "11111111-1111-1111-1111-111111111111";
const ASSESSMENT = "44444444-0000-0000-0000-000000000001";
const SOURCE = "66666666-0000-0000-0000-00000000000a";

/** An insert builder resolving to whatever PostgREST would have returned. */
function insertReturning(data: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {};
  builder.insert = () => builder;
  builder.select = () => builder;
  builder.maybeSingle = () => Promise.resolve({ data, error });
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  rpc.mockResolvedValue({ data: { ok: true }, error: null });
  upload.mockResolvedValue({ data: { path: "p" }, error: null });
  remove.mockResolvedValue({ data: [{}], error: null });
});

describe("uploadSource: a refused metadata insert is not a success", () => {
  const file = new File(["a,b\n1,2\n"], "export.csv", { type: "text/csv" });

  it("treats zero rows with no error as the refusal it is", async () => {
    from.mockReturnValue(insertReturning(null, null));
    await expect(
      uploadSource(ORG, ASSESSMENT, "work_orders", file),
    ).rejects.toThrow(/refused/i);
  });

  it("removes the orphaned object so the bucket does not accumulate exports", async () => {
    from.mockReturnValue(insertReturning(null, null));
    await expect(
      uploadSource(ORG, ASSESSMENT, "work_orders", file),
    ).rejects.toThrow();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("REPORTS a failed cleanup instead of swallowing it", async () => {
    // The silent failure this exists for. If the remove is refused and nobody
    // looks, raw customer data stays in the bucket with no metadata row to
    // account for it — and the person who uploaded it is told only that their
    // write was refused, so nobody ever goes looking.
    from.mockReturnValue(insertReturning(null, null));
    remove.mockResolvedValue({
      data: null,
      error: { message: "storage: not owner" },
    });
    await expect(
      uploadSource(ORG, ASSESSMENT, "work_orders", file),
    ).rejects.toThrow(/could NOT be removed/);
  });

  it("names the path in that report, so the file can actually be found", async () => {
    from.mockReturnValue(insertReturning(null, null));
    remove.mockResolvedValue({
      data: null,
      error: { message: "storage: not owner" },
    });
    const caught = await uploadSource(ORG, ASSESSMENT, "work_orders", file)
      .then(() => null)
      .catch((e: Error) => e);
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain(`${ORG}/${ASSESSMENT}/`);
  });

  it("a successful insert does not remove anything", async () => {
    from.mockReturnValue(insertReturning({ id: SOURCE }, null));
    const result = await uploadSource(ORG, ASSESSMENT, "work_orders", file);
    expect(result.sourceId).toBe(SOURCE);
    expect(remove).not.toHaveBeenCalled();
  });

  it("the object key is randomised and sanitised, so a name cannot traverse", async () => {
    from.mockReturnValue(insertReturning({ id: SOURCE }, null));
    const hostile = new File(["a\n"], "../../etc/passwd.csv", {
      type: "text/csv",
    });
    await uploadSource(ORG, ASSESSMENT, "work_orders", hostile);
    const key = (upload.mock.calls[0] as [string])[0];
    expect(key.startsWith(`${ORG}/${ASSESSMENT}/`)).toBe(true);
    // The sanitiser strips the separators but leaves the dots ("..-..-etc-…").
    // What makes traversal unreachable is that no SEGMENT is ever "." or "..":
    // there are exactly three, the last is uuid-prefixed, and the first is the
    // org id the storage policy checks with storage.foldername().
    const segments = key.split("/");
    expect(segments).toHaveLength(3);
    expect(segments.some((seg) => seg === "." || seg === "..")).toBe(false);
    expect(segments[0]).toBe(ORG);
    expect(segments[2]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i,
    );
  });
});

describe("retireSource: the stub first, the file second, the claim last", () => {
  it("writes the audit stub before touching storage", async () => {
    const order: string[] = [];
    rpc.mockImplementation((name: string) => {
      order.push(`rpc:${name}`);
      return Promise.resolve({ data: { ok: true }, error: null });
    });
    remove.mockImplementation(() => {
      order.push("storage:remove");
      return Promise.resolve({ data: [{}], error: null });
    });

    await retireSource(SOURCE, "Retention elapsed", undefined, "org/a.csv");

    expect(order).toEqual([
      "rpc:retire_ria_data_source",
      "storage:remove",
      "rpc:confirm_ria_source_raw_purged",
    ]);
  });

  it("reports the purge as done only when the object actually went", async () => {
    const result = await retireSource(
      SOURCE,
      "Retention elapsed",
      "MSA clause 7.4",
      "org/a.csv",
    );
    expect(result).toEqual({ retired: true, rawPurged: true });
  });

  it("does not flip raw_retained when the removal was refused", async () => {
    // A flag set in hope is a false retention claim, and the Data Room renders
    // this one to the customer verbatim.
    remove.mockResolvedValue({
      data: null,
      error: { message: "storage: not owner" },
    });
    const result = await retireSource(
      SOURCE,
      "Retention elapsed",
      undefined,
      "org/a.csv",
    );
    expect(result.rawPurged).toBe(false);
    expect(result.purgeError).toContain("not owner");
    expect(
      rpc.mock.calls.some(([name]) => name === "confirm_ria_source_raw_purged"),
    ).toBe(false);
  });

  it("still retires, and says why the raw export survived, with no path", async () => {
    const result = await retireSource(SOURCE, "Retention elapsed");
    expect(result.retired).toBe(true);
    expect(result.rawPurged).toBe(false);
    expect(result.purgeError).toContain("storage path was not supplied");
    expect(remove).not.toHaveBeenCalled();
  });

  it("surfaces the RPC's own refusal rather than continuing to delete", async () => {
    // The house `{error}` contract: a refusal arrives in the payload, not as a
    // thrown error. Continuing past it would delete the raw export of a source
    // that was never retired.
    rpc.mockResolvedValue({
      data: { error: "retiring an assessment source requires a planning role" },
      error: null,
    });
    await expect(
      retireSource(SOURCE, "Retention elapsed", undefined, "org/a.csv"),
    ).rejects.toThrow(/requires a planning role/);
    expect(remove).not.toHaveBeenCalled();
  });
});

describe("upsertAlias: the canonical asset is reachable", () => {
  it("passes the asset id through instead of hardcoding null", async () => {
    await upsertAlias(
      ASSESSMENT,
      "Finning",
      "CAT-793-0041",
      undefined,
      undefined,
      "asset-1",
    );
    expect(rpc).toHaveBeenCalledWith(
      "upsert_ria_asset_alias",
      expect.objectContaining({ p_canonical_asset_id: "asset-1" }),
    );
  });

  it("still allows a free-text ref for an asset the register does not hold", async () => {
    await upsertAlias(ASSESSMENT, "Finning", "CAT-793-0041", "HT-999");
    expect(rpc).toHaveBeenCalledWith(
      "upsert_ria_asset_alias",
      expect.objectContaining({
        p_canonical_asset_id: null,
        p_canonical_asset_ref: "HT-999",
      }),
    );
  });
});

describe("loadCanonicalAssets: RLS scopes it, not the browser", () => {
  it("sends no organization filter of its own", async () => {
    const calls: string[] = [];
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "order", "limit"]) {
      builder[method] = (...a: unknown[]) => {
        calls.push(`${method}:${String(a[0])}`);
        return builder;
      };
    }
    const result = Promise.resolve({ data: [], error: null });
    builder.then = result.then.bind(result);
    from.mockReturnValue(builder);

    await loadCanonicalAssets();
    // A browser-side org filter is a suggestion; the policy is the boundary.
    expect(calls.some((c) => c.startsWith("eq:"))).toBe(false);
    expect(from).toHaveBeenCalledWith("assets");
  });
});
