/**
 * Control: nothing from the body-of-knowledge gap analysis may be dropped,
 * claimed without code, or left unowned.
 *
 * docs/enterprise-readiness/bok-coverage-register.json lists every method gap
 * found when the platform was compared against the reliability, maintenance,
 * logistics and risk literature and standards. This suite makes that list
 * binding:
 *
 *   1. Ratchet — the known item ids are pinned here; removing one fails.
 *   2. Shape — every item has a severity, references, a status and a next step.
 *   3. kernel_verified means it: the module exists, every listed export is a
 *      function, the test file names every export and contains a refusal
 *      assertion, and the module is pure (no database, network, LLM or
 *      unseeded randomness).
 *   4. owned_by_open_pr names the PR and records what was handed over.
 *   5. No critical item may be "open".
 *   6. Honesty — a capability-register row tied to a kernel that no customer
 *      can reach yet may not be ✅.
 *   7. Reverse trace — every BOK-nn tag written in src/lib resolves to an
 *      item, and a kernel's tag only appears in its own module or a listed
 *      consumer, so new method code cannot exist outside the register.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const registerPath = path.join(
  root,
  "docs/enterprise-readiness/bok-coverage-register.json",
);

interface Item {
  id: string;
  title: string;
  severity: "critical" | "high" | "medium" | "low";
  references: string[];
  status: "kernel_verified" | "owned_by_open_pr" | "open";
  module?: string;
  exports?: string[];
  testFile?: string;
  consumers?: string[];
  pr?: number;
  handover?: string;
  registerRows: string[];
  customerReachable: boolean;
  nextStep: string;
}

const register = JSON.parse(fs.readFileSync(registerPath, "utf8")) as {
  items: Item[];
};
const items = register.items;
const byId = new Map(items.map((i) => [i.id, i]));

/** The ratchet. Add ids here when the register grows; never remove one. */
const PINNED_IDS = [
  "BOK-01",
  "BOK-02",
  "BOK-03",
  "BOK-04",
  "BOK-05",
  "BOK-06",
  "BOK-07",
  "BOK-08",
  "BOK-08B",
  "BOK-09",
  "BOK-09B",
  "BOK-10",
  "BOK-11",
  "BOK-11B",
  "BOK-12",
  "BOK-12B",
  "BOK-13",
  "BOK-13B",
  "BOK-14",
  "BOK-15",
  "BOK-16",
  "BOK-17",
  "BOK-18",
  "BOK-19",
];

const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("BoK coverage register — ratchet and shape", () => {
  it("contains every pinned item exactly once", () => {
    for (const id of PINNED_IDS)
      expect(byId.has(id), `${id} was removed from the register`).toBe(true);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it.each(items.map((i) => [i.id, i] as const))(
    "%s is fully specified",
    (_id, item) => {
      expect(item.title.length).toBeGreaterThan(10);
      expect(["critical", "high", "medium", "low"]).toContain(item.severity);
      expect(item.references.length).toBeGreaterThan(0);
      expect(["kernel_verified", "owned_by_open_pr", "open"]).toContain(
        item.status,
      );
      expect(Array.isArray(item.registerRows)).toBe(true);
      expect(typeof item.customerReachable).toBe("boolean");
      expect(item.nextStep.length).toBeGreaterThanOrEqual(20);
    },
  );

  it("no critical gap is left open", () => {
    const open = items
      .filter((i) => i.severity === "critical" && i.status === "open")
      .map((i) => i.id);
    expect(
      open,
      `critical items with no code and no owner: ${open.join(", ")}`,
    ).toEqual([]);
  });
});

const kernels = items.filter((i) => i.status === "kernel_verified");
const FORBIDDEN = [
  /supabase/i,
  /\bfetch\(/,
  /openai|anthropic|@ai-sdk/i,
  /Math\.random\(/,
  /from ["']react/,
];

describe("BoK coverage register — kernel_verified items are real", () => {
  it.each(kernels.map((i) => [i.id, i] as const))(
    "%s has code, exports and tests",
    async (_id, item) => {
      expect(
        item.module && fs.existsSync(path.join(root, item.module)),
        `${item.module} missing`,
      ).toBe(true);
      expect(
        item.testFile && fs.existsSync(path.join(root, item.testFile)),
        `${item.testFile} missing`,
      ).toBe(true);
      expect(item.exports && item.exports.length > 0).toBe(true);

      const mod = (await import(
        /* @vite-ignore */ path.join(root, item.module!)
      )) as Record<string, unknown>;
      const testSrc = read(item.testFile!);
      for (const name of item.exports!) {
        expect(
          typeof mod[name],
          `${item.id}: ${name} is not exported as a function`,
        ).toBe("function");
        expect(
          new RegExp(`\\b${name}\\b`).test(testSrc),
          `${item.id}: ${name} is never exercised in ${item.testFile}`,
        ).toBe(true);
      }
      expect(
        /toThrow\(|toBe\(false\)|toBeNull\(\)/.test(testSrc),
        `${item.id}: no refusal or negative-path assertion`,
      ).toBe(true);

      const src = read(item.module!);
      for (const re of FORBIDDEN)
        expect(re.test(src), `${item.module} must stay pure (${re})`).toBe(
          false,
        );
      expect(
        src.includes(item.id),
        `${item.module} must carry its ${item.id} tag in its header`,
      ).toBe(true);
    },
  );

  it("owned items name the PR and the handover", () => {
    for (const i of items.filter((x) => x.status === "owned_by_open_pr")) {
      expect(Number.isInteger(i.pr), `${i.id} needs a PR number`).toBe(true);
      expect(
        (i.handover ?? "").length,
        `${i.id} needs a handover note`,
      ).toBeGreaterThanOrEqual(40);
    }
  });
});

describe("BoK coverage register — honesty against the capability register", () => {
  const capReg = read("docs/enterprise-readiness/capability-register.md");
  const rowStatus = (id: string) => {
    const line = capReg
      .split("\n")
      .find((l) => l.startsWith(`| ${id} `) || l.startsWith(`|  ${id} `));
    if (!line) return null;
    const cell = line.split("|")[3] ?? "";
    return cell.trimStart().startsWith("✅")
      ? "green"
      : cell.includes("🟡")
        ? "partial"
        : "other";
  };

  it("a row backed only by an unreachable kernel is not green", () => {
    for (const i of kernels.filter((k) => !k.customerReachable)) {
      for (const row of i.registerRows) {
        const s = rowStatus(row);
        expect(
          s,
          `register row ${row} referenced by ${i.id} not found`,
        ).not.toBeNull();
        expect(
          s,
          `${row} is ✅ but ${i.id}'s kernel is not customer-reachable`,
        ).not.toBe("green");
      }
    }
  });
});

describe("BoK coverage register — reverse trace from code", () => {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory()
        ? walk(p)
        : /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)
          ? [p]
          : [];
    });
  const files = walk(path.join(root, "src/lib"));

  it("every BOK tag in src/lib resolves to a register item and an owning file", () => {
    for (const f of files) {
      const rel = path.relative(root, f).split(path.sep).join("/");
      const tags = [...new Set(read(rel).match(/BOK-\d{2}[A-Z]?/g) ?? [])];
      for (const tag of tags) {
        const item = byId.get(tag);
        expect(
          item,
          `${rel} cites ${tag}, which is not in the BoK coverage register`,
        ).toBeDefined();
        if (item?.status === "kernel_verified") {
          const owners = [item.module, ...(item.consumers ?? [])];
          const anotherKernelOwnsFile = kernels.some((k) => k.module === rel);
          expect(
            owners.includes(rel) || anotherKernelOwnsFile,
            `${rel} implements ${tag} but is not listed as its module or a consumer`,
          ).toBe(true);
        }
      }
    }
  });
});
