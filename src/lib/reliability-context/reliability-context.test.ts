import { describe, expect, it, vi } from "vitest";
import { retrieveReliabilityContext } from "../../../supabase/functions/_shared/reliability-context";

const sharedChunk = {
  chunk_id: "chunk-shared",
  title: "Mechanical Equipment Reliability Handbook",
  page_start: 42,
  page_end: 43,
  content: "Verify the suspected failure mechanism before a permanent change.",
  documentClass: "handbook",
  redistributable: true,
  isClientPrivate: false,
};

describe("retrieveReliabilityContext", () => {
  it("deduplicates results and exposes only redistributable public passages", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        sharedChunk,
        {
          ...sharedChunk,
          chunk_id: "chunk-private",
          title: "Client maintenance strategy",
          isClientPrivate: true,
        },
        {
          ...sharedChunk,
          chunk_id: "chunk-controlled",
          title: "Controlled training note",
          redistributable: false,
        },
      ],
      error: null,
    });

    const result = await retrieveReliabilityContext(
      { rpc },
      "centrifugal pump seal failure mechanism verification",
      { publicOnly: true },
    );

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(result.knowledgeBaseUsed).toBe(true);
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].label).toBe(
      "[Mechanical Equipment Reliability Handbook, p.42-43 — handbook]",
    );
    expect(result.promptContext).not.toContain("Client maintenance strategy");
    expect(result.promptContext).not.toContain("Controlled training note");
  });

  it("retains tenant-private context for an authorized organization query", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          ...sharedChunk,
          chunk_id: "chunk-private",
          title: "Client maintenance strategy",
          isClientPrivate: true,
          redistributable: false,
        },
      ],
      error: null,
    });

    const result = await retrieveReliabilityContext(
      { rpc },
      "centrifugal pump seal failure mechanism verification",
      { organizationId: "org-1" },
    );

    expect(result.citations[0].label).toContain("client-supplied");
    expect(rpc).toHaveBeenCalledWith(
      "retrieve_kb_context",
      expect.objectContaining({ p_organization_id: "org-1" }),
    );
  });
});
