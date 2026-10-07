import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20270103040002_llm_price_refresh_20261007.sql",
  "utf8",
).toLowerCase();
const evaluationHarness = readFileSync("scripts/eval-models.mjs", "utf8");
const scriptReadme = readFileSync("scripts/README.md", "utf8");
const unitEconomics = JSON.parse(
  readFileSync("marketplace/ai-unit-economics.json", "utf8"),
) as {
  implemented: {
    modelPriceTable: {
      fx: { rate: number; observationDate: string };
      latestRefreshMigration: string;
      ratesCadPerMillionTokens: Record<
        string,
        { input: number; output: number }
      >;
    };
  };
};

describe("current commercial OpenAI price snapshot", () => {
  it("refreshes every proposed model from official USD prices and current CAD FX", () => {
    for (const evidence of [
      "('gpt-5.6-terra', 2.8452, 17.0712",
      "('gpt-5.6-luna', 0.28452, 1.70712",
      "('gpt-4o-mini', 0.21339, 0.85356",
      "usd/cad 1.4226 bank of canada 2026-10-06",
      "retrieved 2026-10-07",
    ]) {
      expect(migration).toContain(evidence);
    }
  });

  it("never downgrades a newer price observation", () => {
    expect(migration).toContain("on conflict (model) do update set");
    expect(migration).toContain(
      "where private.llm_prices.effective_date<=excluded.effective_date",
    );
  });

  it("keeps the standalone evaluation harness on the same OpenAI snapshot", () => {
    expect(evaluationHarness).toContain(
      '"gpt-5.6-terra": { input: 2.8452, output: 17.0712 }',
    );
    expect(evaluationHarness).toContain(
      '"gpt-5.6-luna": { input: 0.28452, output: 1.70712 }',
    );
    expect(evaluationHarness).toContain(
      '"gpt-4o-mini": { input: 0.21339, output: 0.85356 }',
    );
    expect(scriptReadme).toContain("USD/CAD **1.4226**");
    expect(scriptReadme).toContain("2026-10-06");
  });

  it("publishes the same machine-readable commercial evidence", () => {
    const priceTable = unitEconomics.implemented.modelPriceTable;
    expect(priceTable.latestRefreshMigration).toBe(
      "supabase/migrations/20270103040002_llm_price_refresh_20261007.sql",
    );
    expect(priceTable.fx).toEqual({
      rate: 1.4226,
      observationDate: "2026-10-06",
    });
    expect(priceTable.ratesCadPerMillionTokens).toEqual({
      "gpt-5.6-terra": { input: 2.8452, output: 17.0712 },
      "gpt-5.6-luna": { input: 0.28452, output: 1.70712 },
      "gpt-4o-mini": { input: 0.21339, output: 0.85356 },
    });
  });
});
