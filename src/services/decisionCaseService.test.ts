import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDraftDecisionCase,
  createSeedDecisionCases,
} from "../lib/decision-case";
import { createHonestEmptyDecisionCase } from "../lib/decision-case-honesty";
import {
  askDecisionCase,
  createPersistedDecisionCase,
  listDecisionCaseAuthorityDirectory,
  recordDecisionCaseApproval,
  savePersistedDecisionCase,
} from "./decisionCaseService";
import { runPublicDecisionCaseAgent } from "./publicReliabilityAgent";
import { createCoworkWorkspaceFromObjective } from "./operatingLoopService";

const workspaceWrite = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const select = vi.fn(() => ({ maybeSingle }));
  const eq = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  const rpc = vi.fn();
  return { from, update, eq, select, maybeSingle, rpc };
});

vi.mock("../lib/supabase", () => ({
  supabase: { from: workspaceWrite.from, rpc: workspaceWrite.rpc },
}));

vi.mock("./operatingLoopService", () => ({
  createCoworkWorkspaceFromObjective: vi.fn(),
  getCoworkMessages: vi.fn(),
  sendCoworkMessage: vi.fn(),
}));

vi.mock("./publicReliabilityAgent", () => ({
  runPublicDecisionCaseAgent: vi.fn(),
}));

const runPublicAgentMock = vi.mocked(runPublicDecisionCaseAgent);
const createWorkspaceMock = vi.mocked(createCoworkWorkspaceFromObjective);

describe("decisionCaseService", () => {
  beforeEach(() => {
    runPublicAgentMock.mockReset();
    createWorkspaceMock.mockReset();
    workspaceWrite.from.mockClear();
    workspaceWrite.update.mockClear();
    workspaceWrite.eq.mockClear();
    workspaceWrite.select.mockClear();
    workspaceWrite.maybeSingle.mockReset();
    workspaceWrite.rpc.mockReset();
  });

  it("requires a tenant-visible initialized row before reporting a case creation", async () => {
    const seed = createHonestEmptyDecisionCase("Reliability Engineer");
    const workspaceId = "11111111-1111-4111-8111-111111111111";
    createWorkspaceMock.mockResolvedValue({
      workspaceId,
      artifactId: null,
      recommendationId: null,
    });
    workspaceWrite.maybeSingle.mockResolvedValueOnce({
      data: { id: workspaceId, case_version: 0 },
      error: null,
    });
    workspaceWrite.rpc.mockImplementationOnce((_name, input) => ({
      data: {
        caseState: { ...input.p_case_state, revision: 1 },
        version: 1,
      },
      error: null,
    }));

    await expect(createPersistedDecisionCase(seed, {})).resolves.toMatchObject({
      id: workspaceId,
      revision: 1,
    });
    expect(workspaceWrite.rpc).toHaveBeenCalledWith(
      "apply_decision_case_command",
      expect.objectContaining({
        p_workspace_id: workspaceId,
        p_expected_version: 0,
        p_command: "initialize",
      }),
    );
    expect(workspaceWrite.update).toHaveBeenCalledWith(
      expect.not.objectContaining({ case_state: expect.anything() }),
    );

    workspaceWrite.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: null,
    });
    await expect(createPersistedDecisionCase(seed, {})).rejects.toThrow(
      /no tenant-visible workspace row was updated/i,
    );
  });

  it("uses the versioned command RPC and returns the newer canonical case", async () => {
    const decisionCase = {
      ...createHonestEmptyDecisionCase("Reliability Engineer"),
      id: "11111111-1111-4111-8111-111111111111",
      revision: 4,
      comments: [
        {
          id: "decision-owner",
          author: "Decision Owner",
          text: "Ada Owner",
          createdAt: "2026-10-03T12:00:00.000Z",
        },
        {
          id: "recommendation-author",
          author: "Recommendation Author",
          text: "Riley Author",
          createdAt: "2026-10-03T12:00:00.000Z",
        },
        {
          id: "verification-owner",
          author: "Verification Owner",
          text: "Vera Owner",
          createdAt: "2026-10-03T12:00:00.000Z",
        },
      ],
    };
    workspaceWrite.rpc.mockResolvedValueOnce({
      data: {
        caseState: { ...decisionCase, revision: 5 },
        version: 5,
      },
      error: null,
    });
    await expect(
      savePersistedDecisionCase(decisionCase, "add_evidence"),
    ).resolves.toMatchObject({ revision: 5 });
    expect(workspaceWrite.rpc).toHaveBeenCalledWith(
      "apply_decision_case_command",
      expect.objectContaining({
        p_workspace_id: decisionCase.id,
        p_expected_version: 4,
        p_command: "add_evidence",
      }),
    );

    workspaceWrite.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "40001", message: "Decision Case conflict" },
    });
    await expect(savePersistedDecisionCase(decisionCase)).rejects.toMatchObject(
      {
        name: "DecisionCaseConflictError",
        message: expect.stringMatching(/Decision Case conflict/i),
      },
    );
  });

  it("sends only each command's bounded payload", async () => {
    const decisionCase = {
      ...createHonestEmptyDecisionCase("Reliability Engineer"),
      id: "11111111-1111-4111-8111-111111111111",
      revision: 4,
      comments: [
        {
          id: "decision-owner",
          author: "Decision Owner",
          text: "Ada Owner",
          createdAt: "2026-10-03T12:00:00.000Z",
        },
        {
          id: "recommendation-author",
          author: "Recommendation Author",
          text: "Riley Author",
          createdAt: "2026-10-03T12:00:00.000Z",
        },
        {
          id: "verification-owner",
          author: "Verification Owner",
          text: "Vera Owner",
          createdAt: "2026-10-03T12:00:00.000Z",
        },
      ],
      requiredPerson: {
        userId: "22222222-2222-4222-8222-222222222222",
        name: "Kai",
        authorityRole: "maintenance_manager",
        invitationStatus: "not_sent" as const,
        recordedAt: "2026-10-03T12:00:00.000Z",
      },
    };
    const expectedKeys: Array<
      [Parameters<typeof savePersistedDecisionCase>[1], string[]]
    > = [
      ["record_conversation", ["messages", "tokensUsed"]],
      [
        "add_evidence",
        [
          "decisionMetrics",
          "evidence",
          "evidenceScore",
          "recommendation",
          "recommendationDetail",
          "stage",
        ],
      ],
      ["record_disposition", ["humanDecision", "people"]],
      ["define_verification", ["verification"]],
      ["record_required_person", ["requiredPerson"]],
      ["record_source_check", ["sourceCheck"]],
    ];

    for (const [command, keys] of expectedKeys) {
      workspaceWrite.rpc.mockResolvedValueOnce({
        data: { caseState: { ...decisionCase, revision: 5 }, version: 5 },
        error: null,
      });
      await savePersistedDecisionCase(decisionCase, command);
      const payload = workspaceWrite.rpc.mock.calls.at(-1)?.[1]
        .p_case_state as Record<string, unknown>;
      expect(Object.keys(payload).sort()).toEqual(keys.sort());
      expect(payload).not.toHaveProperty("learningRecord");
      expect(payload).not.toHaveProperty("workPackage");
      expect(payload).not.toHaveProperty("humanApproval");
      if (command === "record_disposition") {
        expect(payload.people).toEqual({
          decisionOwner: "Ada Owner",
          recommendationAuthor: "Riley Author",
          verificationOwner: "Vera Owner",
        });
        expect(payload.people).not.toHaveProperty("requiredApprover");
      }
    }
  });

  it("uses the canonical command return without dropping case context", async () => {
    const decisionCase = {
      ...createHonestEmptyDecisionCase("Reliability Engineer"),
      id: "11111111-1111-4111-8111-111111111111",
      revision: 7,
      objective: "Should this inspection interval remain unchanged?",
      evidence: [
        {
          id: "ev-1",
          title: "Inspection note",
          summary: "Customer note",
          quality: "medium" as const,
          state: "Supplied",
          record: "note-1",
          finding: "Observed condition is unchanged.",
          lineage: "manual",
          sourceSystem: "customer",
          persistence: "embedded" as const,
        },
      ],
      humanDecision: {
        disposition: "accept" as const,
        rationale: "The supplied condition remains inside the reviewed basis.",
        counterfactual: "A contradictory inspection finding.",
        recordedAt: "2026-10-03T12:00:00.000Z",
      },
    };
    const canonical = {
      ...decisionCase,
      revision: 8,
      comments: [
        {
          id: "people-decisionOwner-8",
          author: "Decision Owner",
          text: "Ada Owner",
          createdAt: "2026-10-03T12:01:00.000Z",
        },
        {
          id: "people-verificationOwner-8",
          author: "Verification Owner",
          text: "Vera Owner",
          createdAt: "2026-10-03T12:01:00.000Z",
        },
      ],
      valueMetrics: [
        {
          id: "verify-expected",
          label: "Expected",
          detail: "How we will know this worked",
          baseline: "No adverse change",
          target: "No adverse change",
          verifiedActual: "Pending",
        },
        {
          id: "verify-evidence",
          label: "Verification evidence",
          detail: "Not yet attached",
          baseline: "2026-10-10",
          target: "How will we know this worked?",
          verifiedActual: "Scheduled",
        },
      ],
    };
    workspaceWrite.rpc.mockResolvedValueOnce({
      data: { caseState: canonical, version: 8 },
      error: null,
    });

    await expect(
      savePersistedDecisionCase(decisionCase, "record_disposition"),
    ).resolves.toMatchObject({
      objective: "Should this inspection interval remain unchanged?",
      evidence: [expect.objectContaining({ id: "ev-1" })],
      humanDecision: expect.objectContaining({
        rationale: "The supplied condition remains inside the reviewed basis.",
      }),
      comments: expect.arrayContaining([
        expect.objectContaining({
          author: "Decision Owner",
          text: "Ada Owner",
        }),
        expect.objectContaining({
          author: "Verification Owner",
          text: "Vera Owner",
        }),
      ]),
      valueMetrics: expect.arrayContaining([
        expect.objectContaining({ id: "verify-expected" }),
      ]),
    });
  });

  it("records approval through the separate server-authoritative command", async () => {
    const decisionCase = {
      ...createHonestEmptyDecisionCase("Reliability Engineer"),
      id: "11111111-1111-4111-8111-111111111111",
      revision: 4,
    };
    workspaceWrite.rpc.mockImplementationOnce((_name, input) => ({
      data: {
        caseState: {
          ...input.p_case_state,
          humanApproval: {
            decision: "approved",
            recordedAt: "2026-10-03T12:00:00.000Z",
            basisVersion: 4,
            basisSha256: "a".repeat(64),
            approvalVersion: 5,
            actor: {
              id: "22222222-2222-4222-8222-222222222222",
              name: "Required Approver",
              role: "maintenance_manager",
            },
          },
          revision: 5,
        },
        version: 5,
      },
      error: null,
    }));

    await expect(
      recordDecisionCaseApproval(
        decisionCase,
        "approved",
        "Evidence and decision basis reviewed.",
      ),
    ).resolves.toMatchObject({
      revision: 5,
      humanApproval: {
        decision: "approved",
        actor: { id: "22222222-2222-4222-8222-222222222222" },
      },
    });
    expect(workspaceWrite.rpc).toHaveBeenCalledWith(
      "apply_decision_case_command",
      expect.objectContaining({
        p_workspace_id: decisionCase.id,
        p_expected_version: 4,
        p_command: "record_approval",
        p_case_state: expect.objectContaining({
          decision: "approved",
          reason: "Evidence and decision basis reviewed.",
        }),
      }),
    );
  });

  it("loads the server-filtered tenant authority directory", async () => {
    workspaceWrite.rpc.mockResolvedValueOnce({
      data: [
        {
          userId: "22222222-2222-4222-8222-222222222222",
          name: "Kai Manager",
          email: "kai@example.com",
          role: "maintenance_manager",
        },
      ],
      error: null,
    });
    await expect(listDecisionCaseAuthorityDirectory()).resolves.toEqual([
      expect.objectContaining({
        userId: "22222222-2222-4222-8222-222222222222",
        role: "maintenance_manager",
      }),
    ]);
    expect(workspaceWrite.rpc).toHaveBeenCalledWith(
      "get_decision_case_authority_directory",
    );
  });

  it("answers from the active case's canonical calculations", async () => {
    const [pump, compressor] = createSeedDecisionCases();

    const pumpReply = await askDecisionCase(
      pump,
      "Show the calculations and exact source records.",
    );
    expect(pumpReply.message.text).toContain("5 failures in 9 months");
    expect(pumpReply.message.text).toContain("180 hours");
    expect(pumpReply.message.text).not.toContain("102 hours");

    const compressorReply = await askDecisionCase(
      compressor,
      "Show the calculations and exact source records.",
    );
    expect(compressorReply.message.text).toContain("4 trips in 5 months");
    expect(compressorReply.message.text).toContain("102 hours");
    expect(compressorReply.message.text).not.toContain("180 hours");
  });

  it("responds conversationally to a greeting without inventing analysis", async () => {
    const [, compressor] = createSeedDecisionCases();
    const reply = await askDecisionCase(compressor, "hi");

    expect(reply.message.text).toContain("DC-1049");
    expect(reply.message.text).toContain("C-204 compressor");
    expect(reply.message.text).not.toContain("P-101");
    expect(reply.message.meta).toContain("Conversation");
  });

  it("answers a capability question without forcing the active case", async () => {
    const [crusher] = createSeedDecisionCases({ industry: "mining" });
    const reply = await askDecisionCase(
      crusher,
      "What are your capabilities?",
      {
        publicMode: true,
      },
    );

    expect(runPublicAgentMock).not.toHaveBeenCalled();
    expect(reply.message.text).toContain("RAM analysis");
    expect(reply.message.text).toContain(
      "Reliability statistics and life data",
    );
    expect(reply.message.text).toContain("RCA, FRACAS");
    expect(reply.message.text).toContain("FMEA, FMECA, and RCM");
    expect(reply.message.text).toContain("Inventory Management");
    expect(reply.message.text).toContain("a separate specialist");
    expect(reply.message.text).toContain("Planning and scheduling specialist");
    expect(reply.message.text).toContain("6-week schedules");
    expect(reply.message.text).toContain("Risk-to-value decisions");
    expect(reply.message.text).toContain("switch scope");
    expect(reply.message.text).not.toContain("not yet sure which outcome");
    expect(reply.message.meta).toContain("capability map");
  });

  it("asks for the new subject instead of replaying the case recommendation", async () => {
    const [pump] = createSeedDecisionCases();
    const reply = await askDecisionCase(
      pump,
      "i want you look at somethuing else",
    );

    expect(reply.message.text).toContain("What would you like me to examine?");
    expect(reply.message.text).toContain("DC-1048 unchanged");
    expect(reply.message.text).not.toContain(
      "Do not approve the yearly inspection interval",
    );
    expect(reply.message.text).not.toContain("Seal failures: 5");
    expect(reply.message.meta).toContain("preserved");
  });

  it("clarifies an unsupported demo request instead of dumping all metrics", async () => {
    const [pump] = createSeedDecisionCases();
    const reply = await askDecisionCase(pump, "Tell me more");

    expect(reply.message.text).toContain("not yet sure which outcome");
    expect(reply.message.text).toContain(
      "look at a different asset or document",
    );
    expect(reply.message.text).not.toContain("Downtime: 180 h");
    expect(reply.message.meta).toContain("Clarification needed");
  });

  it("uses live RAG for a substantive public Decision Case question", async () => {
    const [pump] = createSeedDecisionCases();
    runPublicAgentMock.mockResolvedValue({
      status: "success",
      response:
        "Test startup contamination before changing the inspection interval.",
      knowledgeBaseUsed: true,
      citations: [
        {
          title: "Reliability handbook",
          pageRange: "p.42",
          documentClass: "handbook",
          label: "[Reliability handbook, p.42 — handbook]",
        },
      ],
    });

    const reply = await askDecisionCase(
      pump,
      "Which failure mechanisms should we test first, and why?",
      { publicMode: true },
    );

    expect(runPublicAgentMock).toHaveBeenCalledWith(
      pump,
      "Which failure mechanisms should we test first, and why?",
    );
    expect(reply.source).toBe("live");
    expect(reply.message.text).toContain("startup contamination");
    expect(reply.message.meta).toContain("RAG-grounded");
    expect(reply.message.meta).toContain("1 approved source");
  });

  it("keeps exact calculations deterministic in public mode", async () => {
    const [pump] = createSeedDecisionCases();
    const reply = await askDecisionCase(
      pump,
      "Show the calculations and exact source records.",
      { publicMode: true },
    );

    expect(runPublicAgentMock).not.toHaveBeenCalled();
    expect(reply.source).toBe("deterministic");
    expect(reply.message.text).toContain("5 failures in 9 months");
  });

  it("routes a calculation for a different asset to the live agent", async () => {
    const [pump] = createSeedDecisionCases();
    runPublicAgentMock.mockResolvedValue({
      status: "success",
      response:
        "MTBF is 1,014 operating hours, subject to the stated chargeable-failure boundary.",
      knowledgeBaseUsed: false,
      citations: [],
    });
    const prompt =
      "Calculate MTBF for compressor C-330 from 7,100 operating hours and 7 chargeable failures, and state the assumptions.";

    const reply = await askDecisionCase(pump, prompt, { publicMode: true });

    expect(runPublicAgentMock).toHaveBeenCalledWith(pump, prompt);
    expect(reply.source).toBe("live");
    expect(reply.scope).toBe("provisional_new_subject");
    expect(reply.message.meta).toContain("DC-1048 unchanged");
    expect(reply.message.text).not.toContain("5 failures in 9 months");
  });

  it("never substitutes the active case when new-subject live analysis fails", async () => {
    const [pump] = createSeedDecisionCases();
    runPublicAgentMock.mockResolvedValue({
      status: "fallback",
      error: "provider unavailable",
    });

    const reply = await askDecisionCase(
      pump,
      "Set this case aside. Review a safety-critical stamping press PM interval.",
      { publicMode: true },
    );

    expect(reply.scope).toBe("provisional_new_subject");
    expect(reply.message.text).toContain("will not substitute facts");
    expect(reply.message.text).not.toContain("Seal failures: 5");
    expect(reply.message.meta).toContain("DC-1048 unchanged");
  });

  it("explains the live RAG boundary when free capacity is reached", async () => {
    const [pump] = createSeedDecisionCases();
    runPublicAgentMock.mockResolvedValue({
      status: "rate_limited",
      error: "capacity used",
    });

    const reply = await askDecisionCase(
      pump,
      "Challenge the recommendation using approved reliability references.",
      { publicMode: true },
    );

    expect(reply.message.text).toContain("included live RAG analysis capacity");
    expect(reply.message.text).toContain("Sign in");
    expect(reply.message.meta).toContain("capacity reached");
  });

  it("does not inject a demo case when none is selected", async () => {
    const empty = createHonestEmptyDecisionCase("Reliability Engineer");
    const leftoverDraft = createDraftDecisionCase("Reliability Engineer");

    for (const unbound of [empty, leftoverDraft]) {
      const reply = await askDecisionCase(
        unbound,
        "What should we fix first?",
        { publicMode: true },
      );
      expect(runPublicAgentMock).not.toHaveBeenCalled();
      expect(reply.message.meta).toMatch(/no case selected/i);
      expect(reply.message.text).toMatch(/what asset, site, or decision/i);
      expect(reply.message.text).not.toMatch(
        /P-101|DC-1048|Fort McMurray|North Ridge/i,
      );
      expect(reply.scope).toBe("provisional_new_subject");
    }
  });

  it("greets on unbound chat without assuming a case", async () => {
    const empty = createHonestEmptyDecisionCase("Reliability Engineer");
    const reply = await askDecisionCase(empty, "hi", { publicMode: true });

    expect(runPublicAgentMock).not.toHaveBeenCalled();
    expect(reply.source).toBe("deterministic");
    expect(reply.message.text).toContain("What would you like to work on?");
    expect(reply.message.text).toMatch(/no decision case is selected/i);
    expect(reply.message.meta).toContain("Conversation");
    expect(reply.message.text).not.toMatch(/P-101|DC-1048|Fort McMurray/i);
    expect(reply.scope).toBe("provisional_new_subject");
  });

  it("answers unbound capability questions without binding a case", async () => {
    const empty = createHonestEmptyDecisionCase("Reliability Engineer");
    const reply = await askDecisionCase(empty, "What are your capabilities?", {
      publicMode: true,
    });

    expect(runPublicAgentMock).not.toHaveBeenCalled();
    expect(reply.source).toBe("deterministic");
    expect(reply.message.meta).toContain("capability map");
    expect(reply.message.text).toMatch(/no decision case is selected/i);
    expect(reply.message.text).not.toMatch(/P-101|DC-1048|Fort McMurray/i);
  });

  it("asks one clarifying question for a vague unbound topic change", async () => {
    const empty = createHonestEmptyDecisionCase("Reliability Engineer");

    for (const prompt of [
      "I want to talk without a decision case",
      "something else",
    ]) {
      runPublicAgentMock.mockClear();
      const reply = await askDecisionCase(empty, prompt, { publicMode: true });
      expect(runPublicAgentMock).not.toHaveBeenCalled();
      expect(reply.source).toBe("deterministic");
      expect(reply.message.text).toMatch(/what asset, site, or decision/i);
      expect(reply.message.meta).toContain("Clarification needed");
      expect(reply.message.text).not.toMatch(
        /P-101|DC-1048|Fort McMurray|Name the asset, site, or decision you want to examine/i,
      );
      expect(reply.scope).toBe("provisional_new_subject");
    }
  });

  it("routes an unbound concrete subject to the live RE path without binding a demo", async () => {
    const empty = createHonestEmptyDecisionCase("Reliability Engineer");
    const leftoverDraft = createDraftDecisionCase("Reliability Engineer");
    runPublicAgentMock.mockResolvedValue({
      status: "success",
      response:
        "Provisional analysis of haul-truck availability from the named subject only.",
      knowledgeBaseUsed: false,
      citations: [],
    });
    const prompt = "HMER haul truck availability optimization";

    for (const unbound of [empty, leftoverDraft]) {
      runPublicAgentMock.mockClear();
      const reply = await askDecisionCase(unbound, prompt, {
        publicMode: true,
      });
      expect(runPublicAgentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: unbound.id,
          asset: "Decision scope not yet defined",
          organization: "",
          site: "",
        }),
        `New subject. ${prompt}`,
      );
      const sentCase = runPublicAgentMock.mock.calls[0]?.[0] as {
        recommendation?: string;
        organization?: string;
        site?: string;
      };
      expect(JSON.stringify(sentCase)).not.toMatch(
        /P-101|Fort McMurray|North Ridge/i,
      );
      expect(reply.source).toBe("live");
      expect(reply.scope).toBe("provisional_new_subject");
      expect(reply.message.meta).toMatch(/provisional/i);
      expect(reply.message.meta).toMatch(/no case selected/i);
      expect(reply.message.text).toContain("haul-truck availability");
      expect(reply.message.text).not.toMatch(
        /P-101|DC-1048|Fort McMurray|North Ridge/i,
      );
    }
  });

  it("does not substitute a demo when unbound live analysis fails", async () => {
    const empty = createHonestEmptyDecisionCase("Reliability Engineer");
    runPublicAgentMock.mockResolvedValue({
      status: "fallback",
      error: "provider unavailable",
    });

    const reply = await askDecisionCase(
      empty,
      "HMER haul truck availability optimization",
      { publicMode: true },
    );

    expect(reply.source).toBe("deterministic");
    expect(reply.scope).toBe("provisional_new_subject");
    expect(reply.message.text).toContain("temporarily unavailable");
    expect(reply.message.text).toContain("did not bind a demo");
    expect(reply.message.meta).toContain("no case selected");
    expect(reply.message.text).not.toMatch(/P-101|DC-1048|Fort McMurray/i);
  });
});
