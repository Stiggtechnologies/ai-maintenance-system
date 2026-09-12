import { createClient } from "npm:@supabase/supabase-js@2";
import {
  analyzeHopScreen,
  type HopAgentScreen,
} from "../_shared/develop-hop-core.ts";

const URL = Deno.env.get("SUPABASE_URL") ?? "";
const KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "https://app.syncai.ca";
const headers = {
  "Access-Control-Allow-Origin": ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!URL || !KEY) return json({ error: "function is not configured" }, 500);
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer "))
    return json({ error: "authentication required" }, 401);
  const caller = createClient(URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: auth } },
  });
  const { data: authData, error: authError } = await caller.auth.getUser();
  if (authError || !authData.user)
    return json({ error: "authentication required" }, 401);
  let body: { lookback_days?: number };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const { data, error } = await caller.rpc("screen_hop_agent", {
    p_lookback_days: body.lookback_days ?? 90,
    p_case_limit: 100,
  });
  if (error) return json({ error: error.message }, 400);
  const screen = data as HopAgentScreen & { error?: string; reason?: string };
  if (!screen || typeof screen !== "object" || screen.error)
    return json(
      {
        error: screen?.error ?? "HOP screening unavailable",
        reason: screen?.reason,
      },
      screen?.error === "forbidden" ? 403 : 400,
    );
  return json({
    advisory: true,
    asOf: screen.asOf,
    analysis: analyzeHopScreen(screen),
    narrativeSource: "deterministic_governed_records",
    disclaimer:
      "System conditions only. A qualified human must investigate and authorize every intervention.",
  });
});
