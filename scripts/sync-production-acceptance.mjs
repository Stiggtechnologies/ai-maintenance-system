#!/usr/bin/env node

/**
 * Authenticated Sync production commissioning through the same low-privilege
 * public boundary used by the browser. The Management API token is used only
 * to discover a publishable/legacy-anon key; product calls use the seeded demo
 * Reliability Engineer JWT and normal RLS/RPC/Edge Function controls.
 *
 * Durable evidence stays where the product governs it: the primary Cowork
 * commissioning conversation is archived and retained. Runtime values are not
 * copied into local artifacts. GitHub logs contain the latency baseline and the
 * workflow summary contains fixed pass/fail claims only.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";

const PROJECT_ID = process.env.SUPABASE_PROJECT_ID ?? "pjvoswbwomesuwhygpby";
const API_URL = `https://${PROJECT_ID}.supabase.co`;
const MANAGEMENT_URL = `https://api.supabase.com/v1/projects/${PROJECT_ID}`;
const EMAIL = process.env.SYNC_COMMISSIONING_EMAIL ?? "demo@syncai.ca";
const PASSWORD = process.env.SYNC_COMMISSIONING_PASSWORD ?? "Demo123!@#";
const DEMO_ORG = "11111111-1111-1111-1111-111111111111";
const DEMO_ASSET_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const DEMO_ASSET_NAME = "Conveyor C-22";
const EXPECTED_RISK_CHECKS = [
  "operational-kpis",
  "asset-data-integrity",
  "safety-indicators",
  "open-recommendations",
  "risk-ranking",
];

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`missing_required_environment:${name}`);
  return value;
}

function jsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function selectPublicKey(keys) {
  assert.ok(Array.isArray(keys), "Management API did not return an API-key list");
  const publishable = keys.find((key) => key?.type === "publishable" && key?.api_key);
  if (publishable) return { value: publishable.api_key, kind: "publishable", name: publishable.name ?? "default" };
  const anon = keys.find(
    (key) => key?.api_key && (key?.name === "anon" || key?.secret_jwt_template?.role === "anon"),
  );
  if (anon) return { value: anon.api_key, kind: "legacy-anon", name: anon.name ?? "anon" };
  throw new Error("production_publishable_or_anon_key_not_found");
}

async function fetchOk(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    const payload = jsonOrNull(text);
    const message = payload?.message ?? payload?.error ?? text.slice(0, 300) ?? response.statusText;
    throw new Error(`http_${response.status}:${message}`);
  }
  return { response, text, json: jsonOrNull(text) };
}

function authHeaders(key, token, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${token}`, ...extra };
}

async function getPublicKey(managementToken) {
  const { json } = await fetchOk(`${MANAGEMENT_URL}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${managementToken}` },
  });
  return selectPublicKey(json);
}

async function login(key) {
  const { json } = await fetchOk(`${API_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert.ok(json?.access_token, "Production login returned no access token");
  return json.access_token;
}

async function rpc(key, token, name, body = {}) {
  const { json, text } = await fetchOk(`${API_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: authHeaders(key, token, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  return json ?? text;
}

async function getRows(key, token, path) {
  return (await fetchOk(`${API_URL}/rest/v1/${path}`, {
    headers: authHeaders(key, token, { Accept: "application/json" }),
  })).json;
}

async function insertRows(key, token, table, body) {
  return (await fetchOk(`${API_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: authHeaders(key, token, {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify(body),
  })).json;
}

function parseSseFrame(frame) {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return data ? jsonOrNull(data) : null;
}

async function streamTurn(key, token, body, { abortAfterFirstDelta = false } = {}) {
  const controller = new AbortController();
  const startedAt = performance.now();
  const response = await fetch(`${API_URL}/functions/v1/sync-investigation-runtime`, {
    method: "POST",
    signal: controller.signal,
    headers: authHeaders(key, token, {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      Origin: "https://app.syncai.ca",
    }),
    body: JSON.stringify(body),
  });
  if (response.status !== 200) {
    const text = await response.text();
    throw new Error(`sync_http_${response.status}:${text.slice(0, 400)}`);
  }
  assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/i);
  const reader = response.body?.getReader();
  assert.ok(reader, "Sync response had no readable stream");

  const decoder = new TextDecoder();
  const events = [];
  let buffer = "";
  let content = "";
  let aborted = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const event = parseSseFrame(frame);
        if (!event) continue;
        events.push(event);
        if (event.type === "assistant.delta" && typeof event.text === "string") content += event.text;
        if (abortAfterFirstDelta && event.type === "assistant.delta") {
          aborted = true;
          controller.abort("commissioning_stop_test");
          break;
        }
      }
      if (aborted) break;
    }
  } catch (error) {
    if (!aborted && error?.name !== "AbortError") throw error;
  } finally {
    if (aborted) await reader.cancel("commissioning_stop_test").catch(() => {});
  }

  const errorEvent = events.find((event) => event.type === "error");
  if (!aborted && errorEvent) {
    throw new Error(`sync_event_error:${errorEvent.code ?? "unknown"}:${errorEvent.message ?? ""}`);
  }
  return {
    events,
    content,
    aborted,
    elapsedMs: Math.round(performance.now() - startedAt),
    started: events.find((event) => event.type === "turn.started") ?? null,
    completed: events.find((event) => event.type === "turn.completed") ?? null,
    telemetry: [...events].reverse().find((event) => event.type === "telemetry.updated")?.telemetry ?? null,
  };
}

function completed(result, label) {
  assert.ok(result.started?.turnId, `${label}: missing turn.started`);
  assert.ok(result.started?.conversationId, `${label}: missing conversation id`);
  assert.ok(result.completed?.turnId, `${label}: missing turn.completed`);
  assert.ok(result.events.some((event) => event.type === "assistant.delta"), `${label}: no assistant.delta`);
  assert.ok(result.content.trim(), `${label}: empty response`);
  return result;
}

async function createConversation(key, token, title) {
  const id = String(await rpc(key, token, "create_sync_conversation", { p_title: title, p_mode: "conversation" }));
  assert.match(id, /^[0-9a-f-]{36}$/i);
  return id;
}

async function deleteConversation(key, token, id) {
  await rpc(key, token, "delete_sync_conversation", { p_workspace_id: id });
}

async function lifecycle(key, token, stamp) {
  const id = await createConversation(key, token, `Commissioning lifecycle ${stamp}`);
  try {
    await rpc(key, token, "rename_sync_conversation", { p_workspace_id: id, p_title: `Commissioning renamed ${stamp}` });
    let rows = await getRows(key, token, `cowork_workspaces?id=eq.${id}&select=id,title,status`);
    assert.equal(rows?.[0]?.title, `Commissioning renamed ${stamp}`);
    await rpc(key, token, "archive_sync_conversation", { p_workspace_id: id });
    rows = await getRows(key, token, `cowork_workspaces?id=eq.${id}&select=id,status`);
    assert.equal(rows?.[0]?.status, "completed");
    await rpc(key, token, "restore_sync_conversation", { p_workspace_id: id });
    rows = await getRows(key, token, `cowork_workspaces?id=eq.${id}&select=id,status`);
    assert.equal(rows?.[0]?.status, "active");
  } finally {
    await deleteConversation(key, token, id).catch(() => {});
  }
  console.log("Conversation lifecycle: passed");
}

async function deleteStorageObject(key, token, path) {
  const response = await fetch(`${API_URL}/storage/v1/object/sync-attachments/${path}`, {
    method: "DELETE",
    headers: authHeaders(key, token),
  });
  if (!response.ok && response.status !== 404) throw new Error(`attachment_cleanup_http_${response.status}`);
}

async function attachmentGrounding(key, token, identity, stamp) {
  const workspaceId = await createConversation(key, token, `Commissioning attachment ${stamp}`);
  const marker = `SYNC-COMMISSION-${stamp}-ALPHA`;
  const path = `${identity.organizationId}/${identity.userId}/${workspaceId}/${crypto.randomUUID()}-commissioning.txt`;
  let uploaded = false;
  try {
    const text = `Synthetic production commissioning evidence. Commissioning identifier: ${marker}.`;
    await fetchOk(`${API_URL}/storage/v1/object/sync-attachments/${path}`, {
      method: "POST",
      headers: authHeaders(key, token, { "Content-Type": "text/plain", "x-upsert": "false" }),
      body: text,
    });
    uploaded = true;
    const rows = await insertRows(key, token, "cowork_attachments", {
      organization_id: identity.organizationId,
      workspace_id: workspaceId,
      uploaded_by: identity.userId,
      file_name: "commissioning.txt",
      mime_type: "text/plain",
      size_bytes: Buffer.byteLength(text),
      object_path: path,
      content_sha256: crypto.createHash("sha256").update(text).digest("hex"),
      extraction_status: "pending",
    });
    const attachmentId = rows?.[0]?.id;
    assert.ok(attachmentId, "Attachment metadata missing id");
    const result = completed(await streamTurn(key, token, {
      conversationId: workspaceId,
      attachmentIds: [attachmentId],
      query: "Using only the attached note, state the commissioning identifier exactly and cite the attachment source.",
      context: { route: "/commissioning", pageTitle: "Production commissioning", mode: "conversation" },
    }), "attachment grounding");
    assert.ok(result.content.includes(marker), "Attachment marker was not grounded");
    assert.match(result.content, /\[A\d+\]/, "Attachment response lacks [A#] provenance");
    const evidence = result.events
      .filter((event) => event.type === "investigation.completed")
      .flatMap((event) => event.evidence ?? []);
    assert.ok(evidence.some((item) => item?.sourceType === "attachment"), "No attachment evidence reference emitted");
  } finally {
    if (uploaded) await deleteStorageObject(key, token, path).catch(() => {});
    await deleteConversation(key, token, workspaceId).catch(() => {});
  }
  console.log("Attachment grounding + provenance: passed");
}

async function cancellation(key, token, stamp) {
  const workspaceId = await createConversation(key, token, `Commissioning stop ${stamp}`);
  try {
    const result = await streamTurn(key, token, {
      conversationId: workspaceId,
      query: "Provide a detailed engineering diagnosis of repeated drive-end bearing vibration alarms on Conveyor C-22, including evidence, hypotheses and next checks.",
      context: {
        route: `/assets/${DEMO_ASSET_ID}`,
        pageTitle: DEMO_ASSET_NAME,
        mode: "conversation",
        entity: { type: "asset", id: DEMO_ASSET_ID, displayName: DEMO_ASSET_NAME },
      },
    }, { abortAfterFirstDelta: true });
    assert.equal(result.aborted, true);
    assert.ok(result.started?.turnId);
    assert.equal(Boolean(result.completed), false, "Stopped turn emitted turn.completed");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const messages = await getRows(
      key,
      token,
      `cowork_messages?workspace_id=eq.${workspaceId}&turn_id=eq.${result.started.turnId}&select=role,delivery_status`,
    );
    assert.equal(messages.some((message) => message.role === "agent"), false, "Stopped turn persisted a completed agent message");
  } finally {
    await deleteConversation(key, token, workspaceId).catch(() => {});
  }
  console.log("Stop/cancellation: passed");
}

async function governedAction(key, token, conversationId, flags, stamp) {
  assert.equal(flags.get("sync_tools"), true, "commissioning_blocker: sync_tools is disabled");
  const marker = `SYNC-COMMISSION-ACTION-${stamp}`;
  const proposalTurn = completed(await streamTurn(key, token, {
    conversationId,
    query: `Create a maintenance observation for ${marker}: automated commissioning observation only; no maintenance action is required.`,
    context: {
      route: `/assets/${DEMO_ASSET_ID}`,
      pageTitle: DEMO_ASSET_NAME,
      mode: "conversation",
      revisionId: `commissioning-${stamp}`,
      entity: { type: "asset", id: DEMO_ASSET_ID, displayName: DEMO_ASSET_NAME },
    },
  }), "governed proposal");
  const proposal = proposalTurn.events.find((event) => event.type === "tool.proposed")?.proposal;
  assert.ok(proposal?.proposalId, "No governed proposal emitted");
  assert.equal(proposal.toolId, "raise_maintenance_notification");
  assert.equal(proposal.requiresApproval, true);

  const confirmation = {
    conversationId,
    toolExecution: {
      proposalId: proposal.proposalId,
      toolId: proposal.toolId,
      idempotencyKey: proposal.proposalId,
      params: proposal.params,
    },
  };
  const execution = await streamTurn(key, token, confirmation);
  const toolCompleted = execution.events.find((event) => event.type === "tool.completed");
  assert.ok(toolCompleted?.executionId, "Confirmed action did not complete");
  const notificationId = toolCompleted?.result?.id;
  assert.ok(notificationId, "Confirmed action returned no notification id");

  const screened = await rpc(key, token, "screen_maintenance_notification", {
    p_id: notificationId,
    p_status: "rejected",
    p_reason: `Automated production commissioning cleanup ${stamp}`,
  });
  assert.equal(screened?.status, "rejected", "Synthetic notification was not safely closed");

  const replay = await streamTurn(key, token, confirmation);
  const replayCompleted = replay.events.find((event) => event.type === "tool.completed");
  assert.equal(replayCompleted?.result?.id, notificationId, "Idempotent replay did not return original result");
  console.log("Governed proposal + confirmation + cleanup + idempotent replay: passed");
}

async function persistedEvidence(key, token, workspaceId, turnIds) {
  const messages = await getRows(
    key,
    token,
    `cowork_messages?workspace_id=eq.${workspaceId}&select=id,turn_id,role,metadata,evidence_refs&order=created_at.asc`,
  );
  for (const turnId of turnIds) {
    const message = messages.find((row) => row.turn_id === turnId && row.role === "agent");
    assert.ok(message, `Missing persisted agent message for ${turnId}`);
    assert.ok(Array.isArray(message.metadata?.investigation_checks) && message.metadata.investigation_checks.length > 0, `Missing persisted checks for ${turnId}`);
    assert.ok(message.metadata?.telemetry?.firstTokenMs != null, `Missing first-token telemetry for ${turnId}`);
    assert.ok(message.metadata?.telemetry?.totalMs != null, `Missing total latency for ${turnId}`);
    assert.ok(Array.isArray(message.evidence_refs), `Missing evidence refs for ${turnId}`);
  }
  console.log("Persisted checks/evidence/telemetry: passed");
}

function logLatency(label, result) {
  const t = result.telemetry ?? {};
  const number = (value) => Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : "n/a";
  console.log(
    `LATENCY ${label}: firstActivity=${number(t.firstActivityMs)}ms firstEvidence=${number(t.firstEvidenceMs)}ms firstToken=${number(t.firstTokenMs)}ms retrieval=${number(t.retrievalMs)}ms specialist=${number(t.specialistMs)}ms model=${number(t.modelMs)}ms total=${number(t.totalMs ?? result.elapsedMs)}ms sources=${number(t.sourceCount)} checks=${number(t.checkCount)}`,
  );
}

async function selfTest() {
  assert.equal(selectPublicKey([
    { type: "secret", api_key: "do-not-use" },
    { type: "publishable", api_key: "sb_publishable_test", name: "default" },
  ]).value, "sb_publishable_test");
  assert.deepEqual(
    parseSseFrame('event: assistant.delta\ndata: {"type":"assistant.delta","text":"hello"}'),
    { type: "assistant.delta", text: "hello" },
  );
  completed({
    events: [{ type: "assistant.delta", text: "ok" }],
    content: "ok",
    started: { turnId: "t", conversationId: "c" },
    completed: { turnId: "t" },
  }, "self-test");
  console.log("Sync production acceptance self-test passed");
}

async function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const managementToken = requiredEnv("SUPABASE_ACCESS_TOKEN");
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const publicKey = await getPublicKey(managementToken);
  console.log(`Public client boundary: ${publicKey.kind} (${publicKey.name}); value not logged.`);
  const token = await login(publicKey.value);
  console.log(`Authenticated ${EMAIL}; access token not logged.`);

  const user = (await fetchOk(`${API_URL}/auth/v1/user`, { headers: authHeaders(publicKey.value, token) })).json;
  assert.ok(user?.id, "Authenticated user unavailable");
  const profile = (await getRows(
    publicKey.value,
    token,
    `user_profiles?id=eq.${user.id}&select=id,organization_id,role,email`,
  ))?.[0];
  assert.equal(profile?.role, "reliability_engineer");
  assert.equal(profile?.organization_id, DEMO_ORG);

  const flagRows = await getRows(
    publicKey.value,
    token,
    "feature_flags?select=flag_key,enabled&flag_key=like.sync_%25&order=flag_key.asc",
  );
  const flags = new Map((flagRows ?? []).map((row) => [row.flag_key, row.enabled === true]));
  assert.equal(flags.get("sync_global_shell"), true, "commissioning_blocker: sync_global_shell is disabled");
  assert.equal(flags.get("sync_tools"), true, "commissioning_blocker: sync_tools is disabled");
  console.log(`Rollout gates: sync_global_shell=${flags.get("sync_global_shell")} sync_tools=${flags.get("sync_tools")}`);

  const workspaceId = await createConversation(publicKey.value, token, `Sync production commissioning ${stamp}`);
  const context = { route: "/", pageTitle: "Sync production commissioning", mode: "conversation" };
  const retainedTurns = [];
  try {
    const greeting = completed(await streamTurn(publicKey.value, token, {
      conversationId: workspaceId, query: "Hi", context,
    }), "lightweight chat");
    retainedTurns.push(greeting.completed.turnId);
    logLatency("lightweight-chat", greeting);

    const capability = completed(await streamTurn(publicKey.value, token, {
      conversationId: workspaceId, query: "What can you do for me?", context,
    }), "capability conversation");
    retainedTurns.push(capability.completed.turnId);
    logLatency("capability", capability);

    const risk = completed(await streamTurn(publicKey.value, token, {
      conversationId: workspaceId, query: "What is the highest risk in my operation today?", context,
    }), "operational risk investigation");
    const checks = new Set(
      risk.events
        .filter((event) => event.type === "investigation.check.completed")
        .map((event) => event.check?.id)
        .filter(Boolean),
    );
    for (const id of EXPECTED_RISK_CHECKS) assert.ok(checks.has(id), `Missing completed investigation check ${id}`);
    assert.ok(risk.events.some((event) => event.type === "investigation.completed"));
    retainedTurns.push(risk.completed.turnId);
    logLatency("risk-investigation", risk);

    const diagnosisQuery = "Conveyor C-22 has repeated drive-end bearing vibration alarms. Give a rigorous engineering diagnosis that separates facts from hypotheses, identifies missing evidence, and recommends the lowest-regret next action.";
    const assetContext = {
      ...context,
      route: `/assets/${DEMO_ASSET_ID}`,
      pageTitle: DEMO_ASSET_NAME,
      entity: { type: "asset", id: DEMO_ASSET_ID, displayName: DEMO_ASSET_NAME },
    };
    const diagnosis = completed(await streamTurn(publicKey.value, token, {
      conversationId: workspaceId, query: diagnosisQuery, context: assetContext,
    }), "engineering diagnosis");
    assert.ok(diagnosis.events.some((event) => event.type === "retrieval.completed"));
    retainedTurns.push(diagnosis.completed.turnId);
    logLatency("engineering-diagnosis", diagnosis);

    const regenerate = completed(await streamTurn(publicKey.value, token, {
      conversationId: workspaceId, query: diagnosisQuery, context: assetContext,
    }), "regenerate");
    assert.notEqual(regenerate.completed.turnId, diagnosis.completed.turnId);
    retainedTurns.push(regenerate.completed.turnId);
    logLatency("regenerate", regenerate);

    await lifecycle(publicKey.value, token, stamp);
    await attachmentGrounding(publicKey.value, token, {
      userId: user.id, organizationId: profile.organization_id,
    }, stamp);
    await cancellation(publicKey.value, token, stamp);
    await governedAction(publicKey.value, token, workspaceId, flags, stamp);
    await persistedEvidence(publicKey.value, token, workspaceId, retainedTurns);

    await rpc(publicKey.value, token, "archive_sync_conversation", { p_workspace_id: workspaceId });
    console.log(`AUTHENTICATED_PRODUCTION_COMMISSIONING=PASS evidence_conversation=${workspaceId}`);
  } catch (error) {
    await rpc(publicKey.value, token, "archive_sync_conversation", { p_workspace_id: workspaceId }).catch(() => {});
    throw error;
  }
}

main().catch((error) => {
  console.error(`Sync production commissioning failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
