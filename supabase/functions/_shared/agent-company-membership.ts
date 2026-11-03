/**
 * Company membership for a caller-supplied agent.
 *
 * Edge functions that write with the service role bypass RLS. The signed-in
 * company is still `user_profiles.organization_id` — the same row
 * `app_current_org()` and `getOrgContext()` read — and the canonical agent
 * roster is `ai_agents`, whose policy is `organization_id = app_current_org()`.
 * This module applies that predicate before any service-role agent action.
 *
 * Not-found and another-company are the same 403. The agent query is filtered
 * by the caller's organization, so a foreign row is never loaded and the
 * response cannot say which case it was.
 */

export const AUTHENTICATION_REQUIRED = "authentication required";
export const FORBIDDEN = "forbidden";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const SESSION_TABLES = ["openclaw_sessions", "sir_sessions"] as const;
export const RUN_TABLES = [
  "openclaw_orchestration_runs",
  "sir_orchestration_runs",
] as const;

export type SessionTable = (typeof SESSION_TABLES)[number];
export type RunTable = (typeof RUN_TABLES)[number];

export interface OrchestratorTables {
  sessionTable: SessionTable;
  runTable: RunTable;
}

type Row = Record<string, unknown> | null;

export interface AgentEq {
  eq(column: string, value: string): AgentEq;
  maybeSingle(): Promise<{
    data: Row;
    error: { message?: string } | null;
  }>;
}

/**
 * The slice of the service-role client these checks use. Matches
 * `auth.getUser(token)` plus `from().select().eq().maybeSingle()`, which is
 * how the other edge functions resolve the caller's organization.
 */
export interface AgentMembershipDb {
  auth: {
    getUser(jwt: string): Promise<{
      data: { user: { id: string } | null } | null;
      error: { message?: string } | null;
    }>;
  };
  from(table: string): {
    select(columns: string): AgentEq;
  };
}

export type AccessDenial = {
  ok: false;
  status: 401 | 403;
  body: { error: typeof AUTHENTICATION_REQUIRED | typeof FORBIDDEN };
};

export type CallerGrant = {
  ok: true;
  userId: string;
  organizationId: string;
  role: string;
};

export type AgentGrant = CallerGrant & { agentId: string };

export type OrchestratorGuard =
  | AccessDenial
  | { ok: true; enforced: false }
  | { ok: true; enforced: true; data: Record<string, unknown> };

const AGENT_ACTIONS = new Set([
  "create_agent",
  "create_session",
  "spawn_agent",
  "add_message",
  "complete_run",
  "add_memory",
  "search_memory",
  "log_tool_call",
  "run_skill",
]);

function denial(status: 401 | 403): AccessDenial {
  if (status === 401) {
    return { ok: false, status: 401, body: { error: AUTHENTICATION_REQUIRED } };
  }
  return { ok: false, status: 403, body: { error: FORBIDDEN } };
}

export function bearerToken(authHeader: string | null | undefined): string {
  if (!authHeader) return "";
  const trimmed = authHeader.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return "";
  return trimmed.slice("bearer ".length).trim();
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...(value as Record<string, unknown>) };
}

async function resolveCallerUnchecked(
  db: AgentMembershipDb,
  authHeader: string | null | undefined,
): Promise<CallerGrant | AccessDenial> {
  const token = bearerToken(authHeader);
  if (!token) return denial(401);

  const { data, error } = await db.auth.getUser(token);
  const userId = data?.user?.id;
  if (error || !userId) return denial(401);

  const { data: profile, error: profileError } = await db
    .from("user_profiles")
    .select("organization_id, role")
    .eq("id", userId)
    .maybeSingle();
  if (profileError || !profile) return denial(403);

  const organizationId = profile.organization_id;
  if (typeof organizationId !== "string" || organizationId.length === 0) {
    return denial(403);
  }

  const role = profile.role;
  return {
    ok: true,
    userId,
    organizationId,
    role: typeof role === "string" ? role : "",
  };
}

async function authorizeAgentUnchecked(
  db: AgentMembershipDb,
  caller: CallerGrant,
  agentId: unknown,
): Promise<AgentGrant | AccessDenial> {
  if (!isUuid(agentId)) return denial(403);

  const { data, error } = await db
    .from("ai_agents")
    .select("id")
    .eq("id", agentId)
    .eq("organization_id", caller.organizationId)
    .maybeSingle();
  if (error || !data || data.id !== agentId) return denial(403);

  return { ...caller, agentId };
}

async function authorizeSessionUnchecked(
  db: AgentMembershipDb,
  caller: CallerGrant,
  sessionId: unknown,
  sessionTable: SessionTable,
): Promise<AgentGrant | AccessDenial> {
  if (!isUuid(sessionId) || !SESSION_TABLES.includes(sessionTable)) {
    return denial(403);
  }

  const { data, error } = await db
    .from(sessionTable)
    .select("agent_id")
    .eq("id", sessionId)
    .maybeSingle();
  if (error || !data) return denial(403);
  return authorizeAgentUnchecked(db, caller, data.agent_id);
}

async function authorizeRunUnchecked(
  db: AgentMembershipDb,
  caller: CallerGrant,
  runId: unknown,
  runTable: RunTable,
): Promise<AgentGrant | AccessDenial> {
  if (!isUuid(runId) || !RUN_TABLES.includes(runTable)) return denial(403);

  const { data, error } = await db
    .from(runTable)
    .select("agent_id")
    .eq("id", runId)
    .maybeSingle();
  if (error || !data) return denial(403);
  return authorizeAgentUnchecked(db, caller, data.agent_id);
}

async function caught<T extends CallerGrant | AgentGrant | OrchestratorGuard>(
  work: () => Promise<T | AccessDenial>,
): Promise<T | AccessDenial> {
  try {
    return await work();
  } catch {
    return denial(403);
  }
}

export function resolveCallerOrganization(
  db: AgentMembershipDb,
  authHeader: string | null | undefined,
): Promise<CallerGrant | AccessDenial> {
  return caught(() => resolveCallerUnchecked(db, authHeader));
}

export function authorizeAgentForCaller(
  db: AgentMembershipDb,
  authHeader: string | null | undefined,
  agentId: unknown,
): Promise<AgentGrant | AccessDenial> {
  return caught(async () => {
    const caller = await resolveCallerUnchecked(db, authHeader);
    if (!caller.ok) return caller;
    return authorizeAgentUnchecked(db, caller, agentId);
  });
}

export function authorizeSessionAgent(
  db: AgentMembershipDb,
  authHeader: string | null | undefined,
  sessionId: unknown,
  sessionTable: SessionTable,
): Promise<AgentGrant | AccessDenial> {
  return caught(async () => {
    const caller = await resolveCallerUnchecked(db, authHeader);
    if (!caller.ok) return caller;
    return authorizeSessionUnchecked(db, caller, sessionId, sessionTable);
  });
}

export function authorizeRunAgent(
  db: AgentMembershipDb,
  authHeader: string | null | undefined,
  runId: unknown,
  runTable: RunTable,
): Promise<AgentGrant | AccessDenial> {
  return caught(async () => {
    const caller = await resolveCallerUnchecked(db, authHeader);
    if (!caller.ok) return caller;
    return authorizeRunUnchecked(db, caller, runId, runTable);
  });
}

/**
 * Orchestrator actions that name an agent, or continue that agent's session
 * or run. Other actions (tool registration, notifications, queue drain) do
 * not invoke an agent and are left unchanged.
 */
export function isOrchestratorAgentAction(action: unknown): boolean {
  return typeof action === "string" && AGENT_ACTIONS.has(action);
}

export function guardOrchestratorAction(
  db: AgentMembershipDb,
  authHeader: string | null | undefined,
  action: unknown,
  data: unknown,
  tables: OrchestratorTables,
): Promise<OrchestratorGuard> {
  return caught(async () => {
    if (!isOrchestratorAgentAction(action)) {
      return { ok: true, enforced: false };
    }

    const caller = await resolveCallerUnchecked(db, authHeader);
    if (!caller.ok) return caller;

    const payload = asRecord(data);
    if (action === "create_agent") {
      payload.tenant_id = caller.organizationId;
      return { ok: true, enforced: true, data: payload };
    }

    if (action === "create_session" || action === "spawn_agent") {
      const agent = await authorizeAgentUnchecked(db, caller, payload.agent_id);
      if (!agent.ok) return agent;
      if (
        action === "spawn_agent" &&
        payload.session_id != null &&
        payload.session_id !== ""
      ) {
        const session = await authorizeSessionUnchecked(
          db,
          caller,
          payload.session_id,
          tables.sessionTable,
        );
        if (!session.ok) return session;
      }
      payload.agent_id = agent.agentId;
      payload.tenant_id = caller.organizationId;
      payload.user_id = caller.userId;
      return { ok: true, enforced: true, data: payload };
    }

    if (action === "add_memory" || action === "search_memory") {
      payload.tenant_id = caller.organizationId;
      if (payload.agent_id != null && payload.agent_id !== "") {
        const agent = await authorizeAgentUnchecked(
          db,
          caller,
          payload.agent_id,
        );
        if (!agent.ok) return agent;
        payload.agent_id = agent.agentId;
      } else {
        payload.agent_id = null;
      }
      return { ok: true, enforced: true, data: payload };
    }

    if (action === "add_message" || action === "log_tool_call") {
      const session = await authorizeSessionUnchecked(
        db,
        caller,
        payload.session_id,
        tables.sessionTable,
      );
      if (!session.ok) return session;
      return { ok: true, enforced: true, data: payload };
    }

    if (action === "complete_run") {
      const run = await authorizeRunUnchecked(
        db,
        caller,
        payload.run_id,
        tables.runTable,
      );
      if (!run.ok) return run;
      return { ok: true, enforced: true, data: payload };
    }

    if (action === "run_skill") {
      if (payload.session_id != null && payload.session_id !== "") {
        const session = await authorizeSessionUnchecked(
          db,
          caller,
          payload.session_id,
          tables.sessionTable,
        );
        if (!session.ok) return session;
      }
      return { ok: true, enforced: true, data: payload };
    }

    return { ok: true, enforced: false };
  });
}
