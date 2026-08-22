#!/usr/bin/env node

/**
 * Authenticated Sync production commissioning.
 *
 * This script deliberately exercises production through the same low-privilege
 * public API boundary as the browser. The Supabase management token is used only
 * to discover a publishable/legacy anon key; it is never used for Data API calls.
 *
 * Production writes are bounded to the seeded demo organization. The only
 * governed-action write is a commissioning maintenance observation which is
 * immediately screened to `rejected` with an explicit automated-test reason so
 * it cannot enter planning. Conversation/attachment lifecycle fixtures are
 * removed; the primary commissioning conversation is archived and retained as
 * the evidence packet.
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
const REQUIRED_FLAGS = ["sync_global_shell", "sync_tools"];
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

function safeJson(text) {
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
  const legacyAnon = keys.find(
    (key) => key?.api_key && (key?.name === "anon" || key?.secret_jwt_template?.role === "anon"),
  );
  if (legacyAnon) return { value: legacyAnon.api_key, kind: "legacy-anon", name: legacyAnon.name ?? "anon" };
  throw new Error("production_publishable_or_anon_key_not_found");
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    const payload = safeJson(text);
    const message = payload?.message ?? payload?.error ?? text.slice(0, 400) ?? response.statusText;
    throw new Error(`http_${response.status}:${message}`);
  }
  return { response, text, json: safeJson(text) };
}

async function getPublicKey(managementToken) {
  const { json } = await request(`${MANAGEMENT_URL}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${managementToken}` },
  });
  return selectPublicKey(json);
}

async function login(publicKey) {
  const { json } = await request(`${API_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publicKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  assert.ok(json?.access_token, "Production demo login did not return an access token");
  return json.access_token;
}

function userHeaders(publicKey, token, extra = {}) {
  return {
    apikey: publicKey,
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

async function rpc(publicKey, token, name, body = {}) {
  const { json, text } = await request(`${API_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: userHeaders(publicKey, token, { "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  return json ?? text;
}

async function restGet(publicKey, token, path) {
  const { json } = await request(`${API_URL}/rest/v1/${path}`, {
    headers: userHeaders(publicKey, token, { Accept: "application/json" }),
  });
  return json;
}

async function restInsert(publicKey, token, table, body) {
  const { json } = await request(`${API_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: userHeaders(publicKey, token, {
      "Content-Type": "application/json",
      Prefer: "return=representation",
    }),
    body: JSON.stringify(body),
  });
  return json;
}

function parseSseFrame(frame) {
  const data = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  return data ? safeJson(data) : null;
}

async function streamTurn(publicKey, token, body, options = {}) {
  const controller = new AbortController();
  const startedAt = performance.now();
  let response;
  try {
    response = await fetch(`${API_URL}/functions/v1/sync-investigation-runtime`, {
      method: "POST",
      signal: controller.signal,
      headers: userHeaders(publicKey, token, {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Origin: "https://app.syncai.ca",
      }),
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`sync_request_failed:${error instanceof Error ? error.message : String(error)}`);
  }

  if (response.status !== 200) {
    const text = await response.text();
    throw new Error(`sync_http_${response.status}:${text.slice(0, 500)}`);
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
        options.onEvent?.(event);
        if (options.abortAfterFirstDelta && event.type === "assistant.delta") {
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
    if (aborted) {
      try {
        await reader.cancel("commissioning_stop_test");
      } catch {
        // Already cancelled by AbortController.
      }
    }
  }

  const errorEvent = events.find((event) => event.type === "error");
  if (!aborted && errorEvent) {
    throw new Error(`sync_event_error:${errorEvent.code ?? "unknown"}:${errorEvent.message ?? ""}`);
  }

  return {
    events,
    content,
    elapsedMs: Math.round(performance.now() - startedAt),
    aborted,
    turnStarted: events.find((event) => event.type === "turn.started") ?? null,
    completed: events.find((event) => event.type === "turn.completed") ?? null,
    telemetry: [...events].reverse().find((event) => event.type === "telemetry.updated")?.telemetry ?? null,
  };
}

function assertCompleted(result, label) {
  assert.ok(result.turnStarted?.turnId, `${label}: missing turn.started`);
  assert.ok(result.turnStarted?.conversationId, `${label}: missing conversationId`);
  assert.ok(result.completed?.turnId, `${label}: missing turn.completed`);
  assert.ok(result.events.some((event) => event.type === "assistant.delta"), `${label}: no assistant.delta`);
  assert.ok(result.content.trim().length > 0, `${label}: empty assistant content`);
  return result;
}

function completedCheckIds(result) {
  return new Set(
    result.events
      .filter((event) => event.type === "investigation.check.completed")
      .map((event) => event.check?.id)
      .filter(Boolean),
  );
}

async function createConversation(publicKey, token, title) {
  const id = await rpc(publicKey, token, "create_sync_conversation", {
    p_title: title,
    p_mode: "conversation",
  });
  assert.match(String(id), /^[0-9a-f-]{36}$/i, "create_sync_conversation returned an invalid id");
  return String(id);
}

async function archiveConversation(publicKey, token, id) {
  await rpc(publicKey, token, "archive_sync_conversation", { p_workspace_id: id });
}

async function deleteConversation(publicKey, token, id) {
  await rpc(publicKey, token, "delete_sync_conversation", { p_workspace_id: id });
}

async function verifyConversationLifecycle(publicKey, token, stamp) {
  const id = await createConversation(publicKey, token, `Commissioning lifecycle ${stamp}`);
  try {
    await rpc(publicKey, token, "rename_sync_conversation", {
      p_workspace_id: id,
      p_title: `Commissioning lifecycle renamed ${stamp}`,
    });
    let rows = await restGet(
      publicKey,
      token,
      `cowork_workspaces?id=eq.${encodeURIComponent(id)}&select=id,title,status`,
    );
    assert.equal(rows?.[0]?.title, `Commissioning lifecycle renamed ${stamp}`);

    await rpc(publicKey, token, "archive_sync_conversation", { p_workspace_id: id });
    rows = await restGet(publicKey, token, `cowork_workspaces?id=eq.${encodeURIComponent(id)}&select=id,status`);
    assert.equal(rows?.[0]?.status, "completed");

    await rpc(publicKey, token, "restore_sync_conversation", { p_workspace_id: id });
    rows = await restGet(publicKey, token, `cowork_workspaces?id=eq.${encodeURIComponent(id)}&select=id,status`);
    assert.equal(rows?.[0]?.status, "active");
  } finally {
    await deleteConversation(publicKey, token, id).catch(() => {});
  }
  return id;
}

async function uploadTextAttachment(publicKey, token, identity, workspaceId, stamp) {
  const marker = `SYNC-COMMISSION-${stamp}-ALPHA`;
  const objectName = `${crypto.randomUUID()}-commissioning-note.txt`;
  const objectPath = `${identity.organizationId}/${identity.userId}/${workspaceId}/${objectName}`;
  const text = `Production commissioning note. Commissioning identifier: ${marker}. This is synthetic test evidence only.`;

  await request(`${API_URL}/storage/v1/object/sync-attachments/${objectPath}`, {
    method: "POST",
    headers: userHeaders(publicKey, token, {
      "Content-Type": "text/plain",
      "x-upsert": "false",
    }),
    body: text,
  });

  const digest = crypto.createHash("sha256").update(text).digest("hex");
  const rows = await restInsert(publicKey, token, "cowork_attachments", {
    organization_id: identity.organizationId,
    workspace_id: workspaceId,
    uploaded_by: identity.userId,
    file_name: "commissioning-note.txt",
    mime_type: "text/plain",
    size_bytes: Buffer.byteLength(text),
    object_path: objectPath,
    content_sha256: digest,
    extraction_status: "pending",
  });
  const attachment = rows?.[0];
  assert.ok(attachment?.id, "Attachment metadata insert returned no id");
  return { ...attachment, marker, objectPath };
}

async function deleteStorageObject(publicKey, token, objectPath) {
  const response = await fetch(`${API_URL}/storage/v1/object/sync-attachments/${objectPath}`, {
    method: "DELETE",
    headers: userHeaders(publicKey, token),
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`attachment_storage_cleanup_http_${response.status}`);
  }
}

async function verifyAttachmentGrounding(publicKey, token, identity, stamp) {
  const workspaceId = await createConversation(publicKey, token, `Commissioning attachment ${stamp}`);
  let attachment;
  try {
    attachment = await uploadTextAttachment(publicKey, token, identity, workspaceId, stamp);
    const result = assertCompleted(
      await streamTurn(publicKey, token, {
        conversationId: workspaceId,
        attachmentIds: [attachment.id],
        query: "Using only the attached commissioning note, state the commissioning identifier exactly and cite the attachment source.",
        context: { route: "/commissioning", pageTitle: "Production commissioning", mode: "conversation" },
      }),
      "attachment grounding",
    );
    assert.ok(result.content.includes(attachment.marker), "Attachment marker was not grounded in the response");
    const attachmentEvidence = result.events
      .filter((event) => event.type === "investigation.completed")
      .flatMap((event) => event.evidence ?? [])
      .filter((evidence) => evidence?.sourceType === "attachment");
    assert.ok(attachmentEvidence.length > 0, "Attachment grounding produced no attachment evidence reference");
    assert.match(result.content, /\[A\d+\]/, "Attachment-grounded answer did not include an [A#] provenance label");
    return { workspaceId, turnId: result.completed.turnId, marker: attachment.marker };
  } finally {
    if (attachment?.objectPath) await deleteStorageObject(publicKey, token, attachment.objectPath).catch(() => {});
    await deleteConversation(publicKey, token, workspaceId).catch(() => {});
  }
}

async function verifyCancellation(publicKey, token, stamp) {
  const workspaceId = await createConversation(publicKey, token, `Commissioning stop ${stamp}`);
  try {
    const result = await streamTurn(
      publicKey,
      token,
      {
        conversationId: workspaceId,
        query: "Provide a detailed engineering diagnosis of repeated drive-end bearing vibration alarms on Conveyor C-22, including evidence, hypotheses and next checks.",
        context: {
          route: "/assets/aaaaaaaa-0000-0000-0000-000000000001",
          pageTitle: DEMO_ASSET_NAME,
          mode: "conversation",
          entity: { type: "asset", id: DEMO_ASSET_ID, displayName: DEMO_ASSET_NAME },
        },
      },
      { abortAfterFirstDelta: true },
    );
    assert.equal(result.aborted, true, "Stop test did not abort the stream");
    assert.ok(result.turnStarted?.turnId, "Stop test never started a turn");
    assert.equal(Boolean(result.completed), false, "Stopped turn emitted turn.completed");
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const messages = await restGet(
      publicKey,
      token,
      `cowork_messages?workspace_id=eq.${encodeURIComponent(workspaceId)}&turn_id=eq.${encodeURIComponent(result.turnStarted.turnId)}&select=role,delivery_status`,
    );
    assert.equal(messages.some((message) => message.role === "agent"), false, "Stopped turn persisted a completed agent response");
    return { workspaceId, turnId: result.turnStarted.turnId };
  } finally {
    await deleteConversation(publicKey, token, workspaceId).catch(() => {});
  }
}

async function verifyGovernedAction(publicKey, token, flags, conversationId, stamp) {
  assert.equal(flags.get("sync_tools"), true, "commissioning_blocker: sync_tools is disabled for the demo organization");
  const marker = `SYNC-COMMISSION-ACTION-${stamp}`;
  const result = assertCompleted(
    await streamTurn(publicKey, token, {
      conversationId,
      query: `Create a maintenance observation for ${marker}: automated commissioning observation only; no maintenance action is required.`,
      context: {
        route: `/assets/${DEMO_ASSET_ID}`,
        pageTitle: DEMO_ASSET_NAME,
        mode: "conversation",
        revisionId: `commissioning-${stamp}`,
        entity: { type: "asset", id: DEMO_ASSET_ID, displayName: DEMO_ASSET_NAME },
      },
    }),
    "governed action proposal",
  );
  const proposed = result.events.find((event) => event.type === "tool.proposed")?.proposal;
  assert.ok(proposed?.proposalId, "Governed action did not emit a proposal");
  assert.equal(proposed?.toolId, "raise_maintenance_notification");
  assert.equal(proposed?.requiresApproval, true, "Governed action proposal did not require approval");

  const execution = await streamTurn(publicKey, token, {
    conversationId,
    toolExecution: {
      proposalId: proposed.proposalId,
      toolId: proposed.toolId,
      idempotencyKey: proposed.proposalId,
      params: proposed.params,
    },
  });
  const completed = execution.events.find((event) => event.type === "tool.completed");
  assert.ok(completed?.executionId, "Confirmed governed action did not complete");
  const notificationId = completed?.result?.id;
  assert.ok(notificationId, "Governed action result did not include notification id");

  // Close the synthetic demo notification immediately so it cannot enter planning.
  const screened = await rpc(publicKey, token, "screen_maintenance_notification", {
    p_id: notificationId,
    p_status: "rejected",
    p_reason: `Automated production commissioning cleanup ${stamp}`,
  });
  assert.equal(screened?.status, "rejected", "Commissioning notification cleanup was not rejected");

  // Replay the exact confirmation to prove idempotency: no second notification.
  const replay = await streamTurn(publicKey, token, {
    conversationId,
    toolExecution: {
      proposalId: proposed.proposalId,
      toolId: proposed.toolId,
      idempotencyKey: proposed.proposalId,
      params: proposed.params,
    },
  });
  const replayCompleted = replay.events.find((event) => event.type === "tool.completed");
  assert.equal(replayCompleted?.result?.id, notificationId, "Idempotent replay did not return the original result");

  return { proposalId: proposed.proposalId, executionId: completed.executionId, notificationId };
}

async function verifyPersistence(publicKey, token, workspaceId, expectedTurnIds) {
  const messages = await restGet(
    publicKey,
    token,
    `cowork_messages?workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id,turn_id,role,message,metadata,evidence_refs,created_at&order=created_at.asc`,
  );
  assert.ok(Array.isArray(messages) && messages.length > 0, "Commissioning conversation has no persisted messages");
  for (const turnId of expectedTurnIds) {
    const agent = messages.find((message) => message.turn_id === turnId && message.role === "agent");
    assert.ok(agent, `No persisted agent response for turn ${turnId}`);
    assert.ok(Array.isArray(agent.metadata?.investigation_checks), `Turn ${turnId} has no persisted investigation checks`);
    assert.ok(agent.metadata.investigation_checks.length > 0, `Turn ${turnId} has an empty investigation trace`);
    assert.ok(agent.metadata?.telemetry?.firstTokenMs != null, `Turn ${turnId} has no persisted first-token telemetry`);
    assert.ok(agent.metadata?.telemetry?.totalMs != null, `Turn ${turnId} has no persisted total latency`);
    assert.ok(Array.isArray(agent.evidence_refs), `Turn ${turnId} has no evidence_refs array`);
  }
  return messages;
}

function summarizeLatency(turns) {
  return turns.map(({ label, result }) => ({
    label,
    firstActivityMs: result.telemetry?.firstActivityMs ?? null,
    firstEvidenceMs: result.telemetry?.firstEvidenceMs ?? null,
    firstTokenMs: result.telemetry?.firstTokenMs ?? null,
    retrievalMs: result.telemetry?.retrievalMs ?? null,
    specialistMs: result.telemetry?.specialistMs ?? null,
    modelMs: result.telemetry?.modelMs ?? null,
    totalMs: result.telemetry?.totalMs ?? result.elapsedMs,
    sourceCount: result.telemetry?.sourceCount ?? null,
    checkCount: result.telemetry?.checkCount ?? null,
  }));
}

async function runSelfTest() {
  const key = selectPublicKey([
    { type: "secret", api_key: "do-not-use", name: "default" },
    { type: "publishable", api_key: "sb_publishable_test", name: "default" },
  ]);
  assert.equal(key.value, "sb_publishable_test");
  const frame = 'event: assistant.delta\ndata: {"type":"assistant.delta","text":"hello"}\n\n';
  assert.deepEqual(parseSseFrame(frame.trim()), { type: "assistant.delta", text: "hello" });
  const fake = {
    events: [
      { type: "turn.started", turnId: "t", conversationId: "c" },
      { type: "assistant.delta", text: "ok" },
      { type: "turn.completed", turnId: "t" },
    ],
    content: "ok",
    turnStarted: { turnId: "t", conversationId: "c" },
    completed: { turnId: "t" },
  };
  assertCompleted(fake, "self-test");
  console.log("Sync production acceptance self-test passed");
}

async function main() {
  if (process.argv.includes("--self-test")) return runSelfTest();

  const managementToken = requiredEnv("SUPABASE_ACCESS_TOKEN");
  const releaseSha = process.env.GITHUB_SHA ?? "manual";
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const evidence = {
    releaseSha,
    projectId: PROJECT_ID,
    startedAt: new Date().toISOString(),
    publicKeyKind: null,
    userId: null,
    organizationId: null,
    featureFlags: {},
    conversationId: null,
    turns: [],
    lifecycle: null,
    attachment: null,
    cancellation: null,
    governedAction: null,
    latency: [],
  };

  const key = await getPublicKey(managementToken);
  evidence.publicKeyKind = key.kind;
  console.log(`Using ${key.kind} public client key (${key.name}); key value is not logged.`);
  const token = await login(key.value);
  console.log(`Authenticated commissioning identity ${EMAIL}; access token is not logged.`);

  const user = (await request(`${API_URL}/auth/v1/user`, {
    headers: userHeaders(key.value, token),
  })).json;
  assert.ok(user?.id, "Authenticated user record unavailable");
  const profileRows = await restGet(
    key.value,
    token,
    `user_profiles?id=eq.${encodeURIComponent(user.id)}&select=id,organization_id,role,email`,
  );
  const profile = profileRows?.[0];
  assert.equal(profile?.role, "reliability_engineer", "Commissioning identity is not a Reliability Engineer");
  assert.equal(profile?.organization_id, DEMO_ORG, "Commissioning identity is not in the seeded demo organization");
  evidence.userId = user.id;
  evidence.organizationId = profile.organization_id;

  const flagRows = await restGet(
    key.value,
    token,
    "feature_flags?select=flag_key,enabled&flag_key=like.sync_%25&order=flag_key.asc",
  );
  const flags = new Map((flagRows ?? []).map((row) => [row.flag_key, row.enabled === true]));
  evidence.featureFlags = Object.fromEntries(flags);
  for (const flag of REQUIRED_FLAGS) {
    assert.equal(flags.get(flag), true, `commissioning_blocker: ${flag} is disabled for the demo organization`);
  }

  const context = { route: "/", pageTitle: "Sync production commissioning", mode: "conversation" };
  const workspaceId = await createConversation(key.value, token, `Sync production commissioning ${stamp}`);
  evidence.conversationId = workspaceId;
  const turns = [];

  try {
    const greeting = assertCompleted(
      await streamTurn(key.value, token, { conversationId: workspaceId, query: "Hi", context }),
      "lightweight chat",
    );
    turns.push({ label: "lightweight chat", result: greeting });

    const capability = assertCompleted(
      await streamTurn(key.value, token, {
        conversationId: workspaceId,
        query: "What can you do for me?",
        context,
      }),
      "capability conversation",
    );
    turns.push({ label: "capability conversation", result: capability });

    const risk = assertCompleted(
      await streamTurn(key.value, token, {
        conversationId: workspaceId,
        query: "What is the highest risk in my operation today?",
        context,
      }),
      "operational risk investigation",
    );
    const riskChecks = completedCheckIds(risk);
    for (const id of EXPECTED_RISK_CHECKS) assert.ok(riskChecks.has(id), `Operational investigation did not complete ${id}`);
    assert.ok(risk.events.some((event) => event.type === "investigation.completed"), "Operational investigation never emitted investigation.completed");
    turns.push({ label: "operational risk investigation", result: risk });

    const diagnosisQuestion = "Conveyor C-22 has repeated drive-end bearing vibration alarms. Give a rigorous engineering diagnosis that separates facts from hypotheses, identifies missing evidence, and recommends the lowest-regret next action.";
    const diagnosis = assertCompleted(
      await streamTurn(key.value, token, {
        conversationId: workspaceId,
        query: diagnosisQuestion,
        context: {
          ...context,
          route: `/assets/${DEMO_ASSET_ID}`,
          pageTitle: DEMO_ASSET_NAME,
          entity: { type: "asset", id: DEMO_ASSET_ID, displayName: DEMO_ASSET_NAME },
        },
      }),
      "engineering diagnosis",
    );
    assert.ok(diagnosis.events.some((event) => event.type === "retrieval.completed"), "Engineering diagnosis did not complete retrieval");
    turns.push({ label: "engineering diagnosis", result: diagnosis });

    // Regenerate semantics: repeat the same engineering prompt in the same
    // conversation and require a new completed server turn, not replacement.
    const regenerated = assertCompleted(
      await streamTurn(key.value, token, {
        conversationId: workspaceId,
        query: diagnosisQuestion,
        context: {
          ...context,
          route: `/assets/${DEMO_ASSET_ID}`,
          pageTitle: DEMO_ASSET_NAME,
          entity: { type: "asset", id: DEMO_ASSET_ID, displayName: DEMO_ASSET_NAME },
        },
      }),
      "regenerate",
    );
    assert.notEqual(regenerated.completed.turnId, diagnosis.completed.turnId, "Regenerate reused the prior turn id");
    turns.push({ label: "regenerate", result: regenerated });

    evidence.lifecycle = await verifyConversationLifecycle(key.value, token, stamp);
    evidence.attachment = await verifyAttachmentGrounding(key.value, token, {
      userId: user.id,
      organizationId: profile.organization_id,
    }, stamp);
    evidence.cancellation = await verifyCancellation(key.value, token, stamp);
    evidence.governedAction = await verifyGovernedAction(key.value, token, flags, workspaceId, stamp);

    const persistedTurnIds = turns.map(({ result }) => result.completed.turnId);
    await verifyPersistence(key.value, token, workspaceId, persistedTurnIds);
    evidence.turns = turns.map(({ label, result }) => ({
      label,
      turnId: result.completed.turnId,
      eventTypes: [...new Set(result.events.map((event) => event.type))],
      telemetry: result.telemetry,
      elapsedMs: result.elapsedMs,
    }));
    evidence.latency = summarizeLatency(turns);

    await archiveConversation(key.value, token, workspaceId);
    evidence.completedAt = new Date().toISOString();
    evidence.status = "passed";

    const outputPath = process.env.SYNC_COMMISSIONING_EVIDENCE_PATH ?? "/tmp/sync-production-commissioning.json";
    await import("node:fs/promises").then(({ writeFile }) => writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 }));

    console.log(`Production commissioning passed. Evidence conversation: ${workspaceId}`);
    console.log("Latency baseline:");
    for (const row of evidence.latency) {
      console.log(`- ${row.label}: firstToken=${row.firstTokenMs ?? "n/a"}ms total=${row.totalMs ?? "n/a"}ms sources=${row.sourceCount ?? "n/a"} checks=${row.checkCount ?? "n/a"}`);
    }

    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFile } = await import("node:fs/promises");
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        [
          "### Authenticated Sync production commissioning",
          "",
          `- Release: \`${releaseSha}\``,
          `- Organization: \`${profile.organization_id}\` (seeded demo tenant)`,
          `- Evidence conversation: \`${workspaceId}\` (archived, retained)`,
          `- Lightweight chat: ✅`,
          `- Capability conversation: ✅`,
          `- Operational risk investigation + truthful checks: ✅`,
          `- Engineering diagnosis + retrieval: ✅`,
          `- Regenerate/new turn: ✅`,
          `- Conversation lifecycle: ✅`,
          `- Attachment grounding + [A#] provenance: ✅`,
          `- Stop/cancellation: ✅`,
          `- Governed proposal + confirmed execution + idempotent replay: ✅`,
          `- Persisted investigation checks/evidence/telemetry: ✅`,
          "",
          "#### Latency baseline",
          ...evidence.latency.map((row) => `- ${row.label}: first token ${row.firstTokenMs ?? "n/a"} ms; total ${row.totalMs ?? "n/a"} ms; ${row.sourceCount ?? "n/a"} sources; ${row.checkCount ?? "n/a"} checks`),
          "",
        ].join("\n"),
      );
    }
  } catch (error) {
    // Keep the main commissioning conversation when a run fails: it is useful
    // forensic evidence. Archive it if possible so it does not remain active.
    await archiveConversation(key.value, token, workspaceId).catch(() => {});
    throw error;
  }
}

main().catch((error) => {
  console.error(`Sync production commissioning failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
