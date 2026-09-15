import { supabase } from "../supabase";
import { supabasePublicKey, supabaseUrl } from "../supabase-config";

export const SYNC_REALTIME_FUNCTION = "sync-realtime-session";
export const SYNC_REALTIME_TIMEOUT_MS = 20_000;

export interface SyncRealtimeContext {
  route: string;
  pageTitle?: string;
  mode?: "conversation" | "meeting" | "field";
  entity?: {
    type: string;
    id: string;
    displayName?: string;
  };
}

export interface SyncRealtimeSessionResponse {
  session: { id: string };
  model: string;
  transport: { type: "webrtc"; sdp: string };
}

export interface SyncVoiceQueryResult {
  ok: boolean;
  answer?: string;
  error?: string;
  evidenceCount?: number;
  pendingApproval?: {
    title: string;
    reason?: string;
  };
}

export interface RealtimeFunctionCall {
  type: "function_call";
  call_id: string;
  name: string;
  arguments?: string;
}

export class SyncRealtimeError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 0) {
    super(code);
    this.name = "SyncRealtimeError";
    this.code = code;
    this.status = status;
  }
}

export async function requestSyncRealtimeSession(
  sdp: string,
  context: SyncRealtimeContext,
): Promise<SyncRealtimeSessionResponse> {
  const { data, error } = await supabase.auth.getSession();
  const token = error ? null : data.session?.access_token;
  if (!token) throw new SyncRealtimeError("unauthorized", 401);
  if (!supabaseUrl) throw new SyncRealtimeError("unconfigured", 503);

  const response = await fetch(
    `${supabaseUrl.replace(/\/$/, "")}/functions/v1/${SYNC_REALTIME_FUNCTION}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabasePublicKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sdp, context }),
      signal: AbortSignal.timeout(SYNC_REALTIME_TIMEOUT_MS),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as {
    error?: unknown;
    code?: unknown;
    session?: { id?: unknown };
    model?: unknown;
    transport?: { type?: unknown; sdp?: unknown };
  };
  if (!response.ok) {
    throw new SyncRealtimeError(
      typeof payload.code === "string"
        ? payload.code
        : typeof payload.error === "string"
          ? payload.error
          : "voice_connection_failed",
      response.status,
    );
  }
  if (
    typeof payload.transport?.sdp !== "string" ||
    !payload.transport.sdp ||
    typeof payload.model !== "string"
  ) {
    throw new SyncRealtimeError("invalid_voice_response", 502);
  }
  return {
    session: {
      id:
        typeof payload.session?.id === "string"
          ? payload.session.id
          : "realtime",
    },
    model: payload.model,
    transport: { type: "webrtc", sdp: payload.transport.sdp },
  };
}

export function normalizeSyncNavigationPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (
    path.length < 2 ||
    path.length > 300 ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("?") ||
    path.includes("#") ||
    path.includes("..") ||
    !/^\/[A-Za-z0-9/_-]+$/.test(path)
  ) {
    return null;
  }
  return path;
}

export function parseRealtimeToolArguments(
  call: RealtimeFunctionCall,
): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(call.arguments || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function collectUnhandledFunctionCalls(
  event: unknown,
  handled: Set<string>,
): RealtimeFunctionCall[] {
  if (!event || typeof event !== "object") return [];
  const response = (event as { response?: { output?: unknown } }).response;
  if (!Array.isArray(response?.output)) return [];
  const calls: RealtimeFunctionCall[] = [];
  for (const item of response.output) {
    if (!item || typeof item !== "object") continue;
    const call = item as Partial<RealtimeFunctionCall>;
    if (
      call.type !== "function_call" ||
      typeof call.call_id !== "string" ||
      !call.call_id ||
      typeof call.name !== "string" ||
      handled.has(call.call_id)
    ) {
      continue;
    }
    handled.add(call.call_id);
    calls.push(call as RealtimeFunctionCall);
  }
  return calls;
}
