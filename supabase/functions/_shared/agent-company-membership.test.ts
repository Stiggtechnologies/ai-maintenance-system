import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AUTHENTICATION_REQUIRED,
  FORBIDDEN,
  authorizeAgentForCaller,
  authorizeRunAgent,
  authorizeSessionAgent,
  guardOrchestratorAction,
  resolveCallerOrganization,
  type AgentMembershipDb,
} from "./agent-company-membership";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const USER_A = "33333333-3333-4333-8333-333333333333";
const AGENT_A = "44444444-4444-4444-8444-444444444444";
const AGENT_B = "55555555-5555-4555-8555-555555555555";
const SESSION_A = "66666666-6666-4666-8666-666666666666";
const SESSION_B = "77777777-7777-4777-8777-777777777777";
const RUN_A = "88888888-8888-4888-8888-888888888888";
const RUN_B = "99999999-9999-4999-8999-999999999999";
const FOREIGN_AGENT_NAME = "other-company-secret-agent";

type Query = { table: string; select: string; filters: Record<string, string> };

function membershipDb(options: {
  user?: { id: string } | null;
  authError?: { message: string } | null;
  throwOnGetUser?: boolean;
  profile?: { organization_id: string | null; role: string | null } | null;
  profileError?: { message: string } | null;
  agents?: Array<{ id: string; organization_id: string; name: string }>;
  agentError?: { message: string } | null;
  sessions?: Array<{ table: string; id: string; agent_id: string | null }>;
  runs?: Array<{ table: string; id: string; agent_id: string | null }>;
}): { db: AgentMembershipDb; queries: Query[] } {
  const queries: Query[] = [];
  const db: AgentMembershipDb = {
    auth: {
      getUser: async () => {
        if (options.throwOnGetUser) throw new Error("auth backend exploded");
        if (options.authError || !options.user) {
          return {
            data: { user: null },
            error: options.authError ?? { message: "invalid jwt" },
          };
        }
        return { data: { user: options.user }, error: null };
      },
    },
    from(table: string) {
      const filters: Record<string, string> = {};
      let select = "";
      const builder = {
        select(columns: string) {
          select = columns;
          return builder;
        },
        eq(column: string, value: string) {
          filters[column] = value;
          return builder;
        },
        async maybeSingle() {
          queries.push({ table, select, filters: { ...filters } });
          if (table === "user_profiles") {
            if (options.profileError) return { data: null, error: options.profileError };
            if (!options.profile || filters.id !== options.user?.id) {
              return { data: null, error: null };
            }
            return { data: options.profile, error: null };
          }
          if (table === "ai_agents") {
            if (options.agentError) return { data: null, error: options.agentError };
            const row = (options.agents ?? []).find(
              (agent) =>
                agent.id === filters.id &&
                agent.organization_id === filters.organization_id,
            );
            return { data: row ? { id: row.id } : null, error: null };
          }
          const session = (options.sessions ?? []).find(
            (item) => item.table === table && item.id === filters.id,
          );
          if (session) return { data: { agent_id: session.agent_id }, error: null };
          const run = (options.runs ?? []).find(
            (item) => item.table === table && item.id === filters.id,
          );
          if (run) return { data: { agent_id: run.agent_id }, error: null };
          return { data: null, error: null };
        },
      };
      return builder;
    },
  };
  return { db, queries };
}

const sameCompany = {
  user: { id: USER_A },
  profile: { organization_id: ORG_A, role: "reliability_engineer" },
  agents: [
    { id: AGENT_A, organization_id: ORG_A, name: "planner" },
    { id: AGENT_B, organization_id: ORG_B, name: FOREIGN_AGENT_NAME },
  ],
  sessions: [
    { table: "openclaw_sessions", id: SESSION_A, agent_id: AGENT_A },
    { table: "openclaw_sessions", id: SESSION_B, agent_id: AGENT_B },
    { table: "sir_sessions", id: SESSION_A, agent_id: AGENT_A },
    { table: "sir_sessions", id: SESSION_B, agent_id: AGENT_B },
  ],
  runs: [
    { table: "openclaw_orchestration_runs", id: RUN_A, agent_id: AGENT_A },
    { table: "openclaw_orchestration_runs", id: RUN_B, agent_id: AGENT_B },
    { table: "sir_orchestration_runs", id: RUN_A, agent_id: AGENT_A },
    { table: "sir_orchestration_runs", id: RUN_B, agent_id: AGENT_B },
  ],
};

function forbiddenBody(result: { body: unknown }): void {
  expect(result.body).toEqual({ error: FORBIDDEN });
  const encoded = JSON.stringify(result.body);
  expect(encoded).not.toContain(ORG_B);
  expect(encoded).not.toContain(FOREIGN_AGENT_NAME);
  expect(encoded).not.toContain("not found");
  expect(encoded).not.toContain("another");
  expect(encoded).not.toContain(AGENT_B);
}

describe("agent company membership", () => {
  it("allows a signed-in member to act as an agent in the same organization", async () => {
    const { db, queries } = membershipDb(sameCompany);
    const result = await authorizeAgentForCaller(
      db,
      "Bearer member-token",
      AGENT_A,
    );

    expect(result).toEqual({
      ok: true,
      userId: USER_A,
      organizationId: ORG_A,
      role: "reliability_engineer",
      agentId: AGENT_A,
    });
    expect(queries).toEqual([
      {
        table: "user_profiles",
        select: "organization_id, role",
        filters: { id: USER_A },
      },
      {
        table: "ai_agents",
        select: "id",
        filters: { id: AGENT_A, organization_id: ORG_A },
      },
    ]);
  });

  it("denies another company's agent and a missing agent with the same 403", async () => {
    const other = membershipDb(sameCompany);
    const missing = membershipDb(sameCompany);
    const foreign = await authorizeAgentForCaller(
      other.db,
      "Bearer member-token",
      AGENT_B,
    );
    const absent = await authorizeAgentForCaller(
      missing.db,
      "Bearer member-token",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    const malformed = await authorizeAgentForCaller(
      missing.db,
      "Bearer member-token",
      "not-a-uuid",
    );

    expect(foreign).toMatchObject({ ok: false, status: 403 });
    expect(absent).toMatchObject({ ok: false, status: 403 });
    expect(malformed).toMatchObject({ ok: false, status: 403 });
    if (!foreign.ok && !absent.ok && !malformed.ok) {
      expect(foreign.body).toEqual(absent.body);
      expect(foreign.body).toEqual(malformed.body);
      forbiddenBody(foreign);
      forbiddenBody(absent);
      forbiddenBody(malformed);
    }
    expect(missing.queries.some((query) => query.filters.id === "not-a-uuid")).toBe(
      false,
    );
    expect(other.queries.map((query) => query.table)).toEqual([
      "user_profiles",
      "ai_agents",
    ]);
    expect(other.queries[1]?.filters.organization_id).toBe(ORG_A);
    expect(other.queries[1]?.select).toBe("id");
  });

  it("denies an unauthenticated caller before looking up an agent", async () => {
    const cases = [
      membershipDb(sameCompany),
      membershipDb(sameCompany),
      membershipDb({ ...sameCompany, user: null, authError: { message: "jwt expired" } }),
    ];
    const headers = [null, "", "Bearer not-a-user"] as const;
    for (let i = 0; i < cases.length; i += 1) {
      const result = await authorizeAgentForCaller(
        cases[i].db,
        headers[i],
        AGENT_A,
      );
      expect(result).toEqual({
        ok: false,
        status: 401,
        body: { error: AUTHENTICATION_REQUIRED },
      });
      expect(cases[i].queries.some((query) => query.table === "ai_agents")).toBe(
        false,
      );
    }
  });

  it("fails closed when the profile or agent lookup errors, without the database message", async () => {
    const profileDown = membershipDb({
      ...sameCompany,
      profileError: { message: `profile leak ${ORG_B}` },
    });
    const agentDown = membershipDb({
      ...sameCompany,
      agentError: { message: `agent leak ${FOREIGN_AGENT_NAME}` },
    });
    const exploded = membershipDb({ ...sameCompany, throwOnGetUser: true });

    const profileResult = await authorizeAgentForCaller(
      profileDown.db,
      "Bearer member-token",
      AGENT_A,
    );
    const agentResult = await authorizeAgentForCaller(
      agentDown.db,
      "Bearer member-token",
      AGENT_A,
    );
    const thrown = await resolveCallerOrganization(
      exploded.db,
      "Bearer member-token",
    );

    for (const result of [profileResult, agentResult, thrown]) {
      expect(result).toMatchObject({ ok: false, status: 403 });
      if (!result.ok) forbiddenBody(result);
    }
  });

  it("keeps every existing profile role inside its own organization", async () => {
    const roles = [
      "executive",
      "maintenance_manager",
      "reliability_engineer",
      "planner",
      "technician",
      "ai_admin",
      "admin",
      "",
      null,
    ];
    for (const role of roles) {
      const allowed = membershipDb({
        ...sameCompany,
        profile: { organization_id: ORG_A, role },
      });
      const denied = membershipDb({
        ...sameCompany,
        profile: { organization_id: ORG_A, role },
      });
      const same = await authorizeAgentForCaller(
        allowed.db,
        "Bearer member-token",
        AGENT_A,
      );
      const other = await authorizeAgentForCaller(
        denied.db,
        "Bearer member-token",
        AGENT_B,
      );
      expect(same).toMatchObject({
        ok: true,
        organizationId: ORG_A,
        role: role ?? "",
        agentId: AGENT_A,
      });
      expect(other).toMatchObject({ ok: false, status: 403 });
      if (!other.ok) forbiddenBody(other);
    }
  });

  it("denies a member with no organization the same way as a missing agent", async () => {
    const { db } = membershipDb({
      ...sameCompany,
      profile: { organization_id: null, role: "admin" },
    });
    const result = await authorizeAgentForCaller(db, "Bearer member-token", AGENT_A);
    expect(result).toMatchObject({ ok: false, status: 403 });
    if (!result.ok) forbiddenBody(result);
  });

  it("authorizes session and run actions only through the same-company agent", async () => {
    const openclaw = membershipDb(sameCompany);
    const sir = membershipDb(sameCompany);
    expect(
      await authorizeSessionAgent(
        openclaw.db,
        "Bearer member-token",
        SESSION_A,
        "openclaw_sessions",
      ),
    ).toMatchObject({ ok: true, agentId: AGENT_A });
    const foreignSession = await authorizeSessionAgent(
      openclaw.db,
      "Bearer member-token",
      SESSION_B,
      "openclaw_sessions",
    );
    const missingSession = await authorizeSessionAgent(
      openclaw.db,
      "Bearer member-token",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "openclaw_sessions",
    );
    expect(foreignSession).toMatchObject({ ok: false, status: 403 });
    expect(missingSession).toMatchObject({ ok: false, status: 403 });
    if (!foreignSession.ok && !missingSession.ok) {
      expect(foreignSession.body).toEqual(missingSession.body);
      forbiddenBody(foreignSession);
    }

    expect(
      await authorizeRunAgent(sir.db, "Bearer member-token", RUN_A, "sir_orchestration_runs"),
    ).toMatchObject({ ok: true, agentId: AGENT_A });
    const foreignRun = await authorizeRunAgent(
      sir.db,
      "Bearer member-token",
      RUN_B,
      "sir_orchestration_runs",
    );
    expect(foreignRun).toMatchObject({ ok: false, status: 403 });
    if (!foreignRun.ok) forbiddenBody(foreignRun);
    expect(
      openclaw.queries.some(
        (query) => query.table === "openclaw_sessions" && query.select !== "agent_id",
      ),
    ).toBe(false);
  });

  it("pins orchestrator writes to the caller and refuses a foreign agent", async () => {
    const { db } = membershipDb(sameCompany);
    const auth = "Bearer member-token";
    const tables = {
      sessionTable: "sir_sessions" as const,
      runTable: "sir_orchestration_runs" as const,
    };

    const created = await guardOrchestratorAction(db, auth, "create_agent", {
      tenant_id: ORG_B,
      name: "new",
    }, tables);
    expect(created).toMatchObject({
      ok: true,
      enforced: true,
      data: { tenant_id: ORG_A, name: "new" },
    });

    const session = await guardOrchestratorAction(db, auth, "create_session", {
      tenant_id: ORG_B,
      user_id: "99999999-9999-4999-8999-999999999991",
      agent_id: AGENT_A,
    }, tables);
    expect(session).toMatchObject({
      ok: true,
      enforced: true,
      data: { tenant_id: ORG_A, user_id: USER_A, agent_id: AGENT_A },
    });

    const foreignSpawn = await guardOrchestratorAction(db, auth, "spawn_agent", {
      tenant_id: ORG_A,
      agent_id: AGENT_B,
    }, tables);
    expect(foreignSpawn).toMatchObject({ ok: false, status: 403 });
    if (!foreignSpawn.ok) forbiddenBody(foreignSpawn);

    const foreignSessionSpawn = await guardOrchestratorAction(db, auth, "spawn_agent", {
      agent_id: AGENT_A,
      session_id: SESSION_B,
    }, tables);
    expect(foreignSessionSpawn).toMatchObject({ ok: false, status: 403 });
    if (!foreignSessionSpawn.ok) forbiddenBody(foreignSessionSpawn);

    const sameSessionSpawn = await guardOrchestratorAction(db, auth, "spawn_agent", {
      agent_id: AGENT_A,
      session_id: SESSION_A,
      tenant_id: ORG_B,
      user_id: ORG_B,
    }, tables);
    expect(sameSessionSpawn).toMatchObject({
      ok: true,
      enforced: true,
      data: {
        agent_id: AGENT_A,
        session_id: SESSION_A,
        tenant_id: ORG_A,
        user_id: USER_A,
      },
    });

    const memory = await guardOrchestratorAction(db, auth, "add_memory", {
      tenant_id: ORG_B,
      agent_id: AGENT_A,
      content: "note",
    }, tables);
    expect(memory).toMatchObject({
      ok: true,
      data: { tenant_id: ORG_A, agent_id: AGENT_A },
    });

    const foreignMemory = await guardOrchestratorAction(db, auth, "search_memory", {
      tenant_id: ORG_B,
      agent_id: AGENT_B,
      query: "leak",
    }, tables);
    expect(foreignMemory).toMatchObject({ ok: false, status: 403 });

    const message = await guardOrchestratorAction(db, auth, "add_message", {
      session_id: SESSION_B,
      content: "hello",
    }, tables);
    expect(message).toMatchObject({ ok: false, status: 403 });
    if (!message.ok) forbiddenBody(message);

    const run = await guardOrchestratorAction(db, null, "complete_run", {
      run_id: RUN_A,
    }, tables);
    expect(run).toEqual({
      ok: false,
      status: 401,
      body: { error: AUTHENTICATION_REQUIRED },
    });

    const tool = await guardOrchestratorAction(db, null, "register_tool", {
      name: "lookup",
    }, tables);
    expect(tool).toEqual({ ok: true, enforced: false });
  });
});

describe("agent action entry points call the membership gate", () => {
  const gateway = readFileSync("supabase/functions/gateway/index.ts", "utf8");
  const sir = readFileSync("supabase/functions/sir-orchestrator/index.ts", "utf8");
  const openclaw = readFileSync(
    "supabase/functions/openclaw-orchestrator/index.ts",
    "utf8",
  );

  it("removes the gateway TODO and gates every agent route before a write", () => {
    expect(gateway).not.toContain("TODO: Validate agent_id");
    expect(gateway).toContain("../_shared/agent-company-membership.ts");
    expect(gateway).toContain("user_id: gate.userId");
    expect(gateway).toContain("agent_id: gate.agentId");
    expect(gateway).not.toContain("const { user_id, agent_id } = body");

    const sessions = gateway.slice(
      gateway.indexOf("async function handleSessions"),
      gateway.indexOf("async function handleRuns"),
    );
    expect(sessions.indexOf("authorizeAgentForCaller")).toBeLessThan(
      sessions.indexOf(".insert("),
    );
    expect(sessions.indexOf("authorizeSessionAgent")).toBeLessThan(
      sessions.lastIndexOf(".insert("),
    );
    expect(sessions.indexOf("authorizeSessionAgent")).toBeLessThan(
      sessions.indexOf(".from('openclaw_messages')"),
    );

    const runs = gateway.slice(
      gateway.indexOf("async function handleRuns"),
      gateway.indexOf("async function handleJobs"),
    );
    expect(runs.indexOf("authorizeAgentForCaller")).toBeLessThan(
      runs.indexOf(".insert("),
    );
    expect(runs).toContain("authorizeSessionAgent");
    const runRead = runs.slice(runs.indexOf("pathname.match(/\\/runs\\/(.+)$/)"));
    expect(runRead.indexOf("authorizeRunAgent")).toBeLessThan(
      runRead.indexOf(".from('openclaw_orchestration_runs')"),
    );
    const trace = runs.slice(runs.indexOf("/trace"));
    expect(trace.indexOf("authorizeRunAgent")).toBeLessThan(
      trace.indexOf(".from('openclaw_tool_calls')"),
    );

    const socket = gateway.slice(gateway.indexOf("async function handleWebSocket"));
    expect(socket.indexOf("resolveCallerOrganization")).toBeLessThan(
      socket.indexOf("Deno.upgradeWebSocket"),
    );
    const execute = socket.slice(socket.indexOf("case 'execute_run'"));
    expect(execute.indexOf("authorizeAgentForCaller")).toBeLessThan(
      execute.indexOf(".insert("),
    );
    const subscribe = socket.slice(
      socket.indexOf("case 'subscribe_run'"),
      socket.indexOf("case 'subscribe_jobs'"),
    );
    expect(subscribe.indexOf("authorizeRunAgent")).toBeLessThan(
      subscribe.indexOf(".from('openclaw_orchestration_runs')"),
    );
  });

  it("gates both orchestrators before they insert or update an agent action", () => {
    for (const [source, sessionTable, runTable] of [
      [sir, "sir_sessions", "sir_orchestration_runs"],
      [openclaw, "openclaw_sessions", "openclaw_orchestration_runs"],
    ] as const) {
      expect(source).toContain("../_shared/agent-company-membership.ts");
      const guardAt = source.indexOf("guardOrchestratorAction");
      const switchAt = source.indexOf("switch (action)");
      expect(guardAt).toBeGreaterThan(-1);
      expect(guardAt).toBeLessThan(switchAt);
      expect(source).toContain(`sessionTable: '${sessionTable}'`);
      expect(source).toContain(`runTable: '${runTable}'`);
      expect(source).toContain("createSession(supabase, acted)");
      expect(source).toContain("spawnAgent(supabase, acted)");
      expect(source).toContain("addMessage(supabase, acted)");
      expect(source).toContain("completeRun(supabase, acted)");
      expect(source).toContain("addMemory(supabase, acted, openaiKey)");
      expect(source).toContain("searchMemory(supabase, acted, openaiKey)");
      expect(source).toContain("logToolCall(supabase, acted)");
      expect(source).toContain("runSkill(supabase, acted)");
      expect(source).toContain("createAgent(supabase, acted)");
      expect(source).not.toContain("createSession(supabase, data)");
      expect(source).not.toContain("spawnAgent(supabase, data)");
    }
  });
});
