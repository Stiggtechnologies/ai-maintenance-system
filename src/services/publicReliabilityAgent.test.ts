import { beforeEach, describe, expect, it, vi } from "vitest";
import { runPublicReliabilityAgent } from "./publicReliabilityAgent";

vi.mock("../lib/supabase-config", () => ({
  supabaseUrl: "https://syncai-test.supabase.co",
  supabasePublicKey: "test-publishable-key",
}));

describe("publicReliabilityAgent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("uses a dedicated bounded request instead of the shared database timeout", async () => {
    const analysis = {
      executiveSummary: "Inspect before changing the interval.",
      observedPattern: "Startup-linked failures",
      ramInterpretation: "Exposure is incomplete.",
      riskExposure: "High",
      financialImpact: "Not yet verified",
      confidence: "medium",
      hypotheses: [],
      actions: [],
      evidenceGaps: [],
      bottomLine: "Run the evidence plan.",
      citations: [],
    };
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ success: true, analysis, modelUsed: "stigg/agent" }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

    const result = await runPublicReliabilityAgent({
      scenarioId: "pump-seal",
      question: "Assess the failure pattern.",
    });

    expect(result).toMatchObject({ status: "success", analysis });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://syncai-test.supabase.co/functions/v1/public-reliability-agent",
    );
    expect(request).toMatchObject({
      method: "POST",
      headers: {
        apikey: "test-publishable-key",
        authorization: "Bearer test-publishable-key",
      },
    });
    expect(request?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns a useful fallback when the expert endpoint rejects the request", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Gateway unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await runPublicReliabilityAgent({
      scenarioId: "pump-seal",
      question: "Assess the failure pattern.",
    });

    expect(result).toEqual({
      status: "fallback",
      error: "Gateway unavailable",
    });
  });
});
