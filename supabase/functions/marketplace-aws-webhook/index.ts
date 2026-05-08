/**
 * marketplace-aws-webhook Edge Function
 *
 * Mirrors `marketplace-webhook` (Azure lifecycle) but for AWS Marketplace
 * lifecycle events relayed via SNS → SQS → relay Lambda → POST here.
 *
 * Request body:
 *   {
 *     "message_id": "<sqs-message-id>",   // idempotency key
 *     "event": {
 *       "action": "subscribe-success" | "unsubscribe-pending" |
 *                 "unsubscribe-success" | "subscribe-fail",
 *       "customer-identifier": "<resolved-customer-id>",
 *       "product-code": "<product-code>",
 *       "offer-identifier"?: "<offer-code>",
 *       "timestamp": "..."
 *     }
 *   }
 *
 * Schema dependency: 20260513000000_aws_salesforce_marketplace_integration.sql
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "https://app.syncai.ca",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface WebhookBody {
  message_id: string;
  event: {
    action: "subscribe-success" | "unsubscribe-pending" | "unsubscribe-success" | "subscribe-fail";
    "customer-identifier": string;
    "product-code"?: string;
    "offer-identifier"?: string;
    timestamp?: string;
  };
}

const STATUS_MAP: Record<WebhookBody["event"]["action"], string> = {
  "subscribe-success": "aws_subscribed",
  "unsubscribe-pending": "aws_unsubscribe_pending",
  "unsubscribe-success": "aws_unsubscribed",
  "subscribe-fail": "aws_expired",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as WebhookBody;
    if (!body?.message_id) return json({ ok: false, error: "message_id is required (idempotency key)" }, 400);
    if (!body.event?.action || !body.event["customer-identifier"]) {
      return json({ ok: false, error: "event.action and event['customer-identifier'] are required" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ ok: false, error: "Server misconfigured" }, 500);
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const newStatus = STATUS_MAP[body.event.action];
    if (!newStatus) return json({ ok: false, error: `Unknown action: ${body.event.action}` }, 400);

    // 1. Idempotent log via UNIQUE message_id
    const { error: logErr } = await supabase.from("aws_marketplace_events").insert({
      aws_customer_identifier: body.event["customer-identifier"],
      message_id: body.message_id,
      action: body.event.action,
      status: "pending",
      request_payload: body.event as unknown as Record<string, unknown>,
    });
    if (logErr) {
      // Duplicate message_id → already processed; return success
      if (logErr.message.includes("duplicate") || logErr.code === "23505") {
        return json({ ok: true, message_id: body.message_id, action: body.event.action, idempotent: true });
      }
      return json({ ok: false, error: `Event log failed: ${logErr.message}` }, 500);
    }

    // 2. Apply lifecycle change to billing_subscriptions
    const { error: updErr } = await supabase
      .from("billing_subscriptions")
      .update({ aws_status: newStatus, status: newStatus === "aws_subscribed" ? "active" : "cancelled" })
      .eq("aws_customer_identifier", body.event["customer-identifier"]);
    if (updErr) {
      await supabase
        .from("aws_marketplace_events")
        .update({ status: "failure", error_message: updErr.message })
        .eq("message_id", body.message_id);
      return json({ ok: false, error: `Status update failed: ${updErr.message}` }, 500);
    }

    // 3. Mark event processed
    await supabase
      .from("aws_marketplace_events")
      .update({ status: "success", processed_at: new Date().toISOString() })
      .eq("message_id", body.message_id);

    return json({ ok: true, message_id: body.message_id, action: body.event.action, new_status: newStatus });
  } catch (err) {
    console.error("[marketplace-aws-webhook] uncaught", err);
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
