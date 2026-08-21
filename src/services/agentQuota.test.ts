/**
 * Quota-refusal UX — a 429 from the money cap must read as "budget used,
 * resets at X", never as an outage with "try again shortly".
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeQuotaRefusal, quotaRefusalFromBody } from "./agentQuota";

describe("quotaRefusalFromBody", () => {
  it("maps org_daily_quota_exceeded (calls) to plain-language copy with the reset", () => {
    const refusal = quotaRefusalFromBody({
      success: false,
      error: "org_daily_quota_exceeded",
      limit: "max_calls_per_day",
      calls_used: 5184,
      max_calls: 5184,
      resets_at: "2026-08-20T00:00:00.000Z",
    });
    expect(refusal?.kind).toBe("quota_exceeded");
    expect(refusal?.message).toContain("daily AI request allowance");
    expect(refusal?.message).toContain("resets at");
    expect(refusal?.resetsAt).toBe("2026-08-20T00:00:00.000Z");
    // The wrong guidance this replaces:
    expect(refusal?.message).not.toMatch(/try again shortly/i);
  });

  it("maps the token limit to its own wording", () => {
    const refusal = quotaRefusalFromBody({
      error: "org_daily_quota_exceeded",
      limit: "max_tokens_per_day",
      resets_at: null,
    });
    expect(refusal?.kind).toBe("quota_exceeded");
    expect(refusal?.message).toContain("daily AI token allowance");
    expect(refusal?.message).toContain("midnight UTC");
  });

  it("maps quota_check_unavailable to 'nothing was spent', no reset claim", () => {
    const refusal = quotaRefusalFromBody({ error: "quota_check_unavailable" });
    expect(refusal?.kind).toBe("quota_unavailable");
    expect(refusal?.message).toContain("nothing was spent");
    expect(refusal?.resetsAt).toBeNull();
  });

  it("returns null for anything that is not a quota refusal", () => {
    expect(quotaRefusalFromBody(null)).toBeNull();
    expect(quotaRefusalFromBody("org_daily_quota_exceeded")).toBeNull();
    expect(quotaRefusalFromBody({ error: "request_failed" })).toBeNull();
    expect(quotaRefusalFromBody({})).toBeNull();
  });
});

describe("describeQuotaRefusal", () => {
  it("reads the body out of a FunctionsHttpError-shaped context Response", async () => {
    const error = {
      name: "FunctionsHttpError",
      message: "Edge Function returned a non-2xx status code",
      context: new Response(
        JSON.stringify({
          error: "org_daily_quota_exceeded",
          limit: "max_calls_per_day",
          resets_at: "2026-08-20T00:00:00.000Z",
        }),
        { status: 429, headers: { "content-type": "application/json" } },
      ),
    };
    const refusal = await describeQuotaRefusal(error);
    expect(refusal?.kind).toBe("quota_exceeded");
    expect(refusal?.resetsAt).toBe("2026-08-20T00:00:00.000Z");
  });

  it("returns null for plain errors, non-JSON bodies, and non-quota bodies", async () => {
    expect(await describeQuotaRefusal(new Error("network"))).toBeNull();
    expect(
      await describeQuotaRefusal({
        context: new Response("<html>bad gateway</html>", { status: 502 }),
      }),
    ).toBeNull();
    expect(
      await describeQuotaRefusal({
        context: new Response(JSON.stringify({ error: "request_failed" }), {
          status: 500,
        }),
      }),
    ).toBeNull();
  });
});

describe("every tenant surface that calls ai-agent-processor renders the refusal", () => {
  it.each([
    ["src/components/CopilotDock.tsx", "describeQuotaRefusal"],
    ["src/pages/WorkOrderDetailPage.tsx", "describeQuotaRefusal"],
    // UnifiedChatInterface.tsx was the third entry. It was deleted in the
    // honesty pass: no module imported it, so no tenant could reach it, and
    // it sent the anon key as its own Authorization header — a surface that
    // authenticated as "any visitor" while appearing to be a signed-in chat.
  ])("%s consumes the quota body via %s", (path, helper) => {
    const source = readFileSync(path, "utf8");
    expect(source).toContain(helper);
    expect(source).toContain("agentQuota");
  });
});
