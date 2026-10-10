import {
  test,
  expect,
  type Page,
  type Response,
  type Route,
  type Request,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Real local GoTrue/PostgREST/SQL witness. No fabricated RPC response, governing
// value, customer observation, approved document or normative authority.
// Seed scripts/tests/asset-service-level-browser-fixture.sql in a FRESH isolated
// database first. This stateful suite deliberately cannot retry consumed state.
test.describe.configure({ mode: "serial", retries: 0 });
// This file cannot retry consumed state. Retain the FIRST failure's real local
// transport/UI trace; credentials and observations are disposable synthetic fixtures.
test.use({ trace: "retain-on-failure" });
const ORG = "11111111-1111-1111-1111-111111111111";
const ASSET = "9208b000-0000-4000-8000-000000000001";
const SECOND_ASSET = "9208b000-0000-4000-8000-000000000002";
const EVIDENCE = "9208b000-0000-4000-8000-000000000011";
const DOCUMENT = "9208b000-0000-4000-8000-000000000012";
const MANAGER = "00000000-0000-0000-0000-000000000003";
const ADMIN = "00000000-0000-0000-0000-000000000006";
const SERVICE = "Synthetic U2 water service";
const controlPath = fileURLToPath(
  new URL(
    "../../scripts/tests/asset-service-level-browser-control.mjs",
    import.meta.url,
  ),
);
type Json = Record<string, unknown>;
type Snapshot = {
  service: Json | null;
  history: Json[];
  approvals: unknown[];
  workOrders: unknown[];
};

function fixture(action: "snapshot"): Snapshot;
function fixture(
  action:
    | "associate-risk"
    | "restrict-risk"
    | "public-risk"
    | "drift-evidence"
    | "role-technician"
    | "organization-foreign"
    | "restore-profile",
): Json;
function fixture(action: string) {
  // Invoked only inside the test body, never during --list/module evaluation.
  return JSON.parse(
    execFileSync(process.execPath, [controlPath, action], {
      encoding: "utf8",
      timeout: 25000,
    }),
  );
}

function localEndpoint(url: string) {
  const parsed = new URL(url);
  expect(parsed.protocol).toBe("http:");
  expect(["127.0.0.1", "localhost"]).toContain(parsed.hostname);
  expect(parsed.port).toBe("54321");
}

const panel = (page: Page) =>
  page.getByRole("region", {
    name: "Service consequence governance",
    exact: true,
  });
const isRpc = (response: Response, name: string) =>
  response.url().endsWith(`/rpc/${name}`) &&
  response.request().method() === "POST";
const httpRpc = (page: Page, name: string) =>
  page.waitForResponse((response) => isRpc(response, name));

async function login(page: Page, email: string, password: string) {
  await page.goto("/signin");
  await page.getByRole("textbox", { name: /work email/i }).fill(email);
  await page.locator('input[type="password"]').fill(password);
  const auth = page.waitForResponse(
    (response) =>
      response.url().includes("/auth/v1/token") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /access syncai/i }).click();
  const response = await auth;
  localEndpoint(response.url());
  expect(response.status()).toBe(200);
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible({ timeout: 30000 });
}

async function openAsset(page: Page, version?: number, status?: string) {
  await expect(panel(page)).toBeVisible({ timeout: 30000 });
  await expect(
    panel(page).getByRole("option", { name: /U208-BROWSER-PW-1/ }),
  ).toBeAttached();
  await panel(page).getByLabel("Asset", { exact: true }).selectOption(ASSET);
  if (version !== undefined)
    await expect(
      panel(page).getByText(`${status} · VERSION ${version}`, { exact: true }),
    ).toBeVisible();
}

async function riskPage(page: Page, version?: number, status?: string) {
  await page.goto("/risk");
  await page
    .getByRole("button", { name: "Risk portfolio", exact: true })
    .click();
  await openAsset(page, version, status);
}

async function rpc(page: Page, name: string, args: Json): Promise<Json> {
  return page.evaluate(
    async ({ name, args }) => {
      const modulePath = "/src/lib/supabase.ts";
      const { supabase } = await import(/* @vite-ignore */ modulePath);
      const { data, error } = await supabase.rpc(name, args);
      if (error) throw new Error(error.message);
      return data;
    },
    { name, args },
  );
}

async function actualAuthTransition(
  page: Page,
  email?: string,
  password?: string,
) {
  // Real auth HTTP/session notification, not React-context injection. Refresh
  // rereads canonical profile through AuthProvider after fixture role/org change.
  await page.evaluate(
    async ({ email, password }) => {
      const modulePath = "/src/lib/supabase.ts";
      const { supabase } = await import(/* @vite-ignore */ modulePath);
      const result = email
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.refreshSession();
      if (result.error) throw new Error(result.error.message);
    },
    { email, password },
  );
}

async function capture(
  page: Page,
  id: string,
  evidenceClass: "INSPECTED" | "DOCUMENTED",
) {
  const rows = await page.evaluate(
    async ({ id, evidenceClass, org, asset, manager }) => {
      const modulePath = "/src/lib/supabase.ts";
      const { supabase } = await import(/* @vite-ignore */ modulePath);
      // Risk-unlinked capture respects the actual restrictive INSERT policy.
      const { data, error } = await supabase
        .from("evidence_items")
        .insert({
          id,
          organization_id: org,
          asset_id: asset,
          source_system: "synthetic-u208-browser-inspection",
          source_reference: `synthetic-u208-browser-${evidenceClass.toLowerCase()}`,
          evidence_type: "field_inspection",
          signal_kind: "inspection",
          evidence_class: evidenceClass,
          description: `Declared SYNTHETIC browser ${evidenceClass} fixture: simulated pump isolation removes simulated water delivery. No customer observation, approved document or normative limit.`,
          provenance: {
            synthetic: true,
            captured_by: manager,
            capture_method: "controlled synthetic browser fixture",
          },
        })
        .select();
      if (error) throw new Error(error.message);
      return data;
    },
    { id, evidenceClass, org: ORG, asset: ASSET, manager: MANAGER },
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    id,
    risk_id: null,
    evidence_class: evidenceClass,
    verification_status: "unverified",
  });
}

async function evidenceVerify(page: Page, id: string) {
  const result = await rpc(page, "verify_evidence_item", {
    p_evidence_id: id,
    p_method:
      "Independent human verification of explicitly synthetic browser capture",
    p_outcome: "verified",
    p_note:
      "Separate named human checked synthetic provenance and asset applicability; no approved document or normative authority is asserted.",
  });
  expect(result.error).toBeUndefined();
  expect(result).toMatchObject({
    verification_status: "verified",
    verified_by: ADMIN,
  });
}

function receipt(
  value: Json,
  request: Json,
  actor: string,
  version: number,
  status: "draft" | "verified",
) {
  expect(value).toMatchObject({
    outcome: "committed",
    command_id: request.p_command_id,
    actor_id: actor,
    organization_id: ORG,
    asset_id: ASSET,
    version,
    status,
    operation: status === "draft" ? "record" : "verify",
  });
  expect(Number.isSafeInteger(value.version)).toBe(true);
  expect(request.p_command_id).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );
  expect(value.request).toEqual(request); // Full raw tuple, not normalized content.
  expect(request.p_observed_actor_id).toBe(actor);
  expect(request.p_observed_organization_id).toBe(ORG);
}

async function submit(
  page: Page,
  operation: "record" | "verify",
  actor: string,
  version: number,
) {
  const ack = httpRpc(page, `${operation}_asset_service_level`);
  const graph = httpRpc(page, "get_dependency_graph");
  const button =
    operation === "verify"
      ? "Verify current version"
      : version === 1
        ? "Record draft service consequence"
        : "Save new draft version";
  await panel(page).getByRole("button", { name: button, exact: true }).click();
  const response = await ack;
  localEndpoint(response.url());
  expect(response.status()).toBe(200);
  const value = await response.json();
  receipt(
    value,
    response.request().postDataJSON(),
    actor,
    version,
    operation === "record" ? "draft" : "verified",
  );
  await graph; // Parent refetch deliberately remounts the panel.
  await openAsset(page, version, operation === "record" ? "DRAFT" : "VERIFIED");
  return value as Json;
}

async function review(page: Page, expectedVersion: number) {
  await riskPage(page, expectedVersion, "DRAFT");
  await panel(page)
    .getByLabel("Independent review note")
    .fill(
      "Separate named human reviewed the exact synthetic service, evidence basis and preserved unknown values.",
    );
  return submit(page, "verify", ADMIN, expectedVersion + 1);
}

async function graphService(page: Page, admitted: boolean) {
  const graph = await rpc(page, "get_dependency_graph", {});
  const node = (graph.nodes as Json[]).find((node) => node.id === ASSET);
  if (admitted) {
    expect(node).toMatchObject({
      serviceName: SERVICE,
      tolerableDowntimeHours: null,
      restorationRank: null,
    });
  } else {
    expect(node?.serviceName ?? null).toBeNull();
  }
}

async function frozen(page: Page) {
  for (const label of [
    "Asset",
    "Service name",
    "Beneficiary",
    "Tolerable downtime hours",
    "Restoration rank",
    "Consequence class",
    "Verified evidence",
    "Consequence notes",
    "Evidence basis",
  ])
    await expect(panel(page).getByLabel(label, { exact: true })).toBeDisabled();
  await expect(
    panel(page).getByRole("button", {
      name: "Save new draft version",
      exact: true,
    }),
  ).toBeDisabled();
}

function canonicalHistory(snapshot: Snapshot, predecessor?: Snapshot) {
  expect(snapshot.history).toHaveLength(Number(snapshot.service?.version ?? 0));
  snapshot.history.forEach((row, index) => {
    expect(row.previous_state).toEqual(
      index === 0 ? null : snapshot.history[index - 1].new_state,
    );
  });
  expect(snapshot.service).toEqual(snapshot.history.at(-1)?.new_state ?? null);
  if (predecessor) {
    expect(snapshot.history).toHaveLength(predecessor.history.length + 1);
    expect(snapshot.history.slice(0, predecessor.history.length)).toEqual(
      predecessor.history,
    );
    expect(snapshot.history.at(-1)?.previous_state).toEqual(
      predecessor.service,
    );
  }
}

async function renderedHistory(page: Page, actor: string, snapshot: Snapshot) {
  // Compare the actual permitted HTTP projection and all three rendered JSON
  // blocks against the complete canonical records, not a version/count summary.
  const projection = await rpc(page, "get_asset_service_level_editor", {
    p_observed_actor_id: actor,
    p_observed_organization_id: ORG,
    p_section: "history",
    p_asset_id: ASSET,
  });
  const fields = [
    "id",
    "created_at",
    "entity_type",
    "actor",
    "previous_state",
    "new_state",
    "event_data",
    "approval_reference",
  ];
  expect(projection).toMatchObject({
    actor_id: actor,
    organization_id: ORG,
    section: "history",
  });
  expect(projection.rows).toEqual(
    snapshot.history.map((row) =>
      Object.fromEntries(fields.map((key) => [key, row[key]])),
    ),
  );
  const entries = panel(page)
    .getByRole("region", {
      name: "Canonical service consequence history",
      exact: true,
    })
    .locator("details");
  await expect(entries).toHaveCount(snapshot.history.length);
  for (const [index, row] of snapshot.history.entries()) {
    const entry = entries.nth(index);
    if ((await entry.getAttribute("open")) === null)
      await entry.locator("summary").click();
    for (const text of [row.created_at, row.entity_type, row.actor])
      await expect(entry.locator("summary")).toContainText(String(text));
    const blocks = entry.locator("pre");
    await expect(blocks).toHaveCount(3);
    await expect(blocks.nth(0)).toBeVisible();
    expect(JSON.parse((await blocks.nth(0).textContent())!)).toEqual(
      row.previous_state,
    );
    expect(JSON.parse((await blocks.nth(1).textContent())!)).toEqual(
      row.new_state,
    );
    expect(JSON.parse((await blocks.nth(2).textContent())!)).toEqual({
      id: row.id,
      event_data: row.event_data,
      approval_reference: row.approval_reference,
    });
  }
}

async function bounded<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${label} did not settle; do not restore fixtures while RPC work is unsettled`,
              ),
            ),
          10000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function holdActualResponse(page: Page, name: string, section?: string) {
  let release!: () => void;
  let finish!: () => void;
  let announce!: (result: { route: Route; value: Json; request: Json }) => void;
  let rejectHeld!: (cause: unknown) => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const held = new Promise<{ route: Route; value: Json; request: Json }>(
    (resolve, reject) => {
      announce = resolve;
      rejectHeld = reject;
    },
  );
  // Observe immediately, before the caller reaches `await held`. The original
  // promise still rejects for that await; early route failures cannot produce
  // an unhandled rejected promise or leave the caller on an unresolved gate.
  void held.catch(() => undefined);
  let used = false;
  let started = false;
  let failure: unknown;
  const handler = async (route: Route) => {
    if (used) return route.fallback();
    let ownsHold = false;
    try {
      const parsed: unknown = route.request().postDataJSON();
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(parsed))
      )
        throw new Error(`Held ${name} request must be a non-null plain object`);
      const request = parsed as Json;
      // Parsing, validation and property access all belong to the settlement
      // boundary. A malformed request must not strand either promise.
      if (
        (section && request.p_section !== section) ||
        (section &&
          ["history", "evidence"].includes(section) &&
          request.p_asset_id !== ASSET)
      )
        return await route.fallback();
      used = true;
      started = true;
      ownsHold = true;
      // REAL backend result, held unchanged. No automatic retries/redirects.
      const response = await route.fetch({
        timeout: 5000,
        maxRetries: 0,
        maxRedirects: 0,
      });
      expect(response.status()).toBe(200);
      announce({ route, value: await response.json(), request });
      await gate;
      await route.fulfill({ response });
    } catch (cause) {
      used = true;
      started = true;
      ownsHold = true;
      failure = cause;
      rejectHeld(cause);
    } finally {
      if (ownsHold) finish();
    }
  };
  return {
    url: `**/rpc/${name}`,
    handler,
    held,
    finished,
    release: () => release(),
    started: () => started,
    async drain() {
      if (!started) return undefined; // Never-matched holds must not hang cleanup.
      release();
      await bounded(finished, `Held ${name}/${section ?? "command"} handler`);
      return failure;
    },
    page,
  };
}

async function settleHeld(held: ReturnType<typeof holdActualResponse>) {
  const failure = await held.drain();
  if (failure) throw failure;
}

test("bounded U2 real-browser governance, standing, recovery and observed-context transitions; full document/obligation acceptance pending", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240000);
  expect(
    process.env.GITHUB_ACTIONS === "true" ||
      process.env.SYNCAI_U208_BROWSER_PRIVATE_FIXTURE === "1",
    "explicit disposable fixture authorization required",
  ).toBe(true);
  localEndpoint(process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321");
  const initial = fixture("snapshot");
  expect(initial.service).toBeNull();
  expect(initial.history).toEqual([]);
  const base = testInfo.project.use.baseURL!;
  // Independent context with its own genuine GoTrue session.
  const reviewerContext = await browser.newContext({ baseURL: base });
  const reviewer = await reviewerContext.newPage();
  const heldResponses: ReturnType<typeof holdActualResponse>[] = [];
  const cleanupRouteFailures: unknown[] = [];
  try {
    await login(page, "manager@syncai.ca", "Manager123!@#");
    await login(reviewer, "admin@syncai.ca", "Admin123!@#");
    await capture(page, EVIDENCE, "INSPECTED");
    await capture(page, DOCUMENT, "DOCUMENTED");
    await evidenceVerify(reviewer, EVIDENCE);
    await evidenceVerify(reviewer, DOCUMENT);
    fixture("associate-risk"); // PRIVILEGED FIXTURE association, not capture/RLS or audit proof.
    await riskPage(page);
    await expect(
      panel(page).getByText(/Unfinished operational-evidence rail/),
    ).toBeVisible();
    for (const label of ["Tolerable downtime hours", "Restoration rank"])
      await expect(panel(page).getByLabel(label)).toHaveValue("");
    await panel(page).getByLabel("Service name").fill(SERVICE);
    await panel(page)
      .getByLabel("Beneficiary")
      .fill("Synthetic browser wash plant");
    await panel(page)
      .getByLabel("Consequence notes")
      .fill(
        "Simulated loss removes simulated water service; no customer fact or governing limit is asserted.",
      );
    await panel(page)
      .getByLabel("Evidence basis")
      .fill(
        "Declared synthetic inspection; approved document and primary normative obligation acceptance remain pending.",
      );
    await panel(page).getByLabel("Verified evidence").selectOption(EVIDENCE);
    await submit(page, "record", MANAGER, 1);
    const recorded = fixture("snapshot");
    canonicalHistory(recorded, initial);
    await renderedHistory(page, MANAGER, recorded);
    await graphService(page, false);
    await panel(page)
      .getByLabel("Independent review note")
      .fill(
        "Author attempts self-review; this must refuse without altering state.",
      );
    const selfAck = httpRpc(page, "verify_asset_service_level");
    await panel(page)
      .getByRole("button", { name: "Verify current version", exact: true })
      .click();
    expect(await (await selfAck).json()).toMatchObject({ outcome: "refused" });
    await expect(panel(page).getByRole("alert")).toContainText(
      /author cannot verify/,
    );
    expect(fixture("snapshot")).toEqual(recorded);
    await review(reviewer, 1);
    const independentlyVerified = fixture("snapshot");
    canonicalHistory(independentlyVerified, recorded);
    await renderedHistory(reviewer, ADMIN, independentlyVerified);
    await graphService(reviewer, true);
    await riskPage(page, 2, "VERIFIED");

    // Negative values are deliberately UNAPPROVED test inputs, not evidence
    // establishing any downtime or restoration priority.
    const beforeRefusals = fixture("snapshot");
    for (const label of ["Tolerable downtime hours", "Restoration rank"]) {
      await panel(page).getByLabel(label).fill("1");
      const refused = httpRpc(page, "record_asset_service_level");
      await panel(page)
        .getByRole("button", { name: "Save new draft version", exact: true })
        .click();
      expect(await (await refused).json()).toMatchObject({
        outcome: "refused",
      });
      await expect(panel(page).getByRole("alert")).toContainText(
        /primary obligation.*pending/,
      );
      await panel(page).getByLabel(label).fill("");
      expect(fixture("snapshot")).toEqual(beforeRefusals);
    }
    await panel(page).getByLabel("Verified evidence").selectOption(DOCUMENT);
    const documentRefusal = httpRpc(page, "record_asset_service_level");
    await panel(page)
      .getByRole("button", { name: "Save new draft version", exact: true })
      .click();
    expect(await (await documentRefusal).json()).toMatchObject({
      outcome: "refused",
    });
    await expect(panel(page).getByRole("alert")).toContainText(
      /document.*pending/,
    );
    expect(fixture("snapshot")).toEqual(beforeRefusals);
    await panel(page).getByLabel("Verified evidence").selectOption(EVIDENCE);
    await panel(page)
      .getByLabel("Beneficiary")
      .fill("Synthetic browser wash plant and backup interface");
    await submit(page, "record", MANAGER, 3);
    const edited = fixture("snapshot");
    canonicalHistory(edited, independentlyVerified);
    await renderedHistory(page, MANAGER, edited);
    expect(edited.service).toMatchObject({
      status: "draft",
      reviewed_by: null,
      reviewed_at: null,
    });
    await graphService(page, false);
    await review(reviewer, 3);
    const historical = fixture("snapshot");
    canonicalHistory(historical, edited);
    await renderedHistory(reviewer, ADMIN, historical);
    expect(
      historical.history.map((row) => (row.new_state as Json).version),
    ).toEqual([1, 2, 3, 4]);
    expect(historical.history.map((row) => row.actor)).toEqual([
      MANAGER,
      ADMIN,
      MANAGER,
      ADMIN,
    ]);
    expect(
      historical.history.map((row) =>
        row.previous_state === null
          ? null
          : (row.previous_state as Json).version,
      ),
    ).toEqual([null, 1, 2, 3]);
    for (const row of historical.history)
      expect(row.new_state).toMatchObject({
        basis: expect.any(String),
        notes: expect.any(String),
        evidence_snapshot: expect.any(Object),
      });

    fixture("restrict-risk"); // Privileged visibility fixture mutation.
    await riskPage(page);
    await expect(panel(page).getByLabel("Service name")).toHaveValue("");
    await expect(
      panel(page)
        .getByRole("region", { name: "Canonical service consequence history" })
        .locator("details"),
    ).toHaveCount(0);
    for (const section of ["levels", "history"]) {
      const projected = await rpc(page, "get_asset_service_level_editor", {
        p_observed_actor_id: MANAGER,
        p_observed_organization_id: ORG,
        p_section: section,
        p_asset_id: ASSET,
      });
      expect(
        (projected.rows as Json[]).filter(
          (row) =>
            row.asset_id === ASSET ||
            row.id === EVIDENCE ||
            (row.new_state as Json | undefined)?.asset_id === ASSET,
        ),
      ).toEqual([]);
      // History is asset-scoped: no captured previous/new record may survive
      // merely because some other evidence for this asset remains readable.
      if (section === "history") expect(projected.rows).toEqual([]);
    }
    const visibleEvidence = await rpc(page, "get_asset_service_level_editor", {
      p_observed_actor_id: MANAGER,
      p_observed_organization_id: ORG,
      p_section: "evidence",
      p_asset_id: ASSET,
    });
    const visibleEvidenceRows = visibleEvidence.rows as Json[];
    expect(visibleEvidenceRows.filter((row) => row.id === EVIDENCE)).toEqual(
      [],
    );
    // Only INSPECTED ...11 was risk-associated. Independently verified,
    // risk-unlinked DOCUMENTED ...12 is allowed to remain visible by canonical
    // evidence RLS. Visibility is NOT document-purpose/normative admission:
    // the real document and numeric write-refusal oracles above remain intact.
    expect(visibleEvidenceRows.filter((row) => row.id === DOCUMENT)).toEqual([
      expect.objectContaining({
        id: DOCUMENT,
        asset_id: ASSET,
        evidence_class: "DOCUMENTED",
        source_system: "synthetic-u208-browser-inspection",
      }),
    ]);
    await expect(
      panel(page)
        .getByLabel("Verified evidence")
        .locator(`option[value="${EVIDENCE}"]`),
    ).toHaveCount(0);
    await expect(
      panel(page)
        .getByLabel("Verified evidence")
        .locator(`option[value="${DOCUMENT}"]`),
    ).toBeAttached();
    await graphService(page, false);
    await riskPage(reviewer, 4, "VERIFIED");
    await renderedHistory(reviewer, ADMIN, historical);
    expect(fixture("snapshot")).toEqual(historical);
    fixture("public-risk");
    fixture("drift-evidence"); // Privileged description correction; NOT an audited correction claim.
    await riskPage(page, 4, "VERIFIED");
    await expect(
      panel(page).getByText(/current evidence standing is not established/),
    ).toBeVisible();
    await graphService(page, false);
    expect(fixture("snapshot")).toEqual(historical);
    await renderedHistory(page, MANAGER, historical);
    const references = await page.evaluate(
      async ({ asset }) => {
        const modulePath = "/src/lib/supabase.ts";
        const { supabase } = await import(/* @vite-ignore */ modulePath);
        const { data, error } = await supabase
          .from("current_asset_service_level_references")
          .select()
          .eq("asset_id", asset);
        if (error) throw new Error(error.message);
        return data;
      },
      { asset: ASSET },
    );
    expect(references).toEqual([]);

    // Truly discard the REAL committed response after SQL, not a fabricated
    // success, pre-send abort, replay or promise rejection standing in for SQL.
    let discarded!: Json;
    let discardedRequest!: Json;
    let writes = 0;
    const lostUrl = "**/rpc/record_asset_service_level";
    const discard = async (route: Route) => {
      writes++;
      discardedRequest = route.request().postDataJSON();
      const response = await route.fetch({
        timeout: 5000,
        maxRetries: 0,
        maxRedirects: 0,
      });
      expect(response.status()).toBe(200);
      discarded = await response.json();
      receipt(discarded, discardedRequest, MANAGER, 5, "draft");
      await route.abort("failed");
    };
    await page.route(lostUrl, discard);
    await panel(page)
      .getByLabel("Consequence notes")
      .fill(
        "Synthetic corrected evidence scope reviewed for a fresh draft; no normative values or authority.",
      );
    await panel(page)
      .getByRole("button", { name: "Save new draft version", exact: true })
      .click();
    await expect(panel(page).getByRole("alert")).toContainText(
      /outcome is unknown/,
    );
    await frozen(page);
    expect(writes).toBe(1);
    const afterDiscard = fixture("snapshot");
    canonicalHistory(afterDiscard, historical);
    expect(afterDiscard.service).toMatchObject({ status: "draft", version: 5 });
    expect(afterDiscard.history).toHaveLength(5);
    const reconciledResponse = httpRpc(page, "get_asset_service_level_command");
    const reconciledGraph = httpRpc(page, "get_dependency_graph");
    await panel(page)
      .getByRole("button", { name: "Reconcile submission", exact: true })
      .click();
    const reconciled = await (await reconciledResponse).json();
    // Direct ACK has an informational note; the canonical reconciliation
    // returns the same complete command identity/request tuple without it.
    expect(reconciled).toEqual(
      Object.fromEntries(
        Object.entries(discarded).filter(([key]) => key !== "note"),
      ),
    );
    receipt(reconciled, discardedRequest, MANAGER, 5, "draft");
    await reconciledGraph;
    await openAsset(page, 5, "DRAFT");
    await renderedHistory(page, MANAGER, afterDiscard);
    expect(writes).toBe(1);
    expect(fixture("snapshot")).toEqual(afterDiscard);
    await page.unroute(lostUrl, discard);

    // Known committed + failed refresh/reconciliation must remain committed.
    let failWorkspaceRead = true;
    const editorUrl = "**/rpc/get_asset_service_level_editor";
    const failRefresh = async (route: Route) => {
      if (
        failWorkspaceRead &&
        route.request().postDataJSON().p_section === "assets"
      ) {
        failWorkspaceRead = false;
        return route.abort("failed");
      }
      return route.continue();
    };
    await page.route(editorUrl, failRefresh);
    const knownAck = httpRpc(page, "record_asset_service_level");
    await panel(page)
      .getByLabel("Consequence notes")
      .fill(
        "Another explicitly synthetic scope clarification; no approved limits or restoration priority.",
      );
    await panel(page)
      .getByRole("button", { name: "Save new draft version", exact: true })
      .click();
    const knownHttp = await knownAck;
    receipt(
      await knownHttp.json(),
      knownHttp.request().postDataJSON(),
      MANAGER,
      6,
      "draft",
    );
    await expect(panel(page).getByRole("alert")).toContainText(
      /committed.*refresh failed/,
    );
    await frozen(page);
    const knownSnapshot = fixture("snapshot");
    canonicalHistory(knownSnapshot, afterDiscard);
    const reconcileUrl = "**/rpc/get_asset_service_level_command";
    const failReconcile = (route: Route) => route.abort("failed");
    await page.route(reconcileUrl, failReconcile);
    await panel(page)
      .getByRole("button", { name: "Reconcile submission", exact: true })
      .click();
    await expect(panel(page).getByRole("alert")).toContainText(
      /committed.*reconciliation failed/,
    );
    await expect(panel(page).getByRole("alert")).not.toContainText(
      /outcome is unknown/,
    );
    await page.unroute(reconcileUrl, failReconcile);
    await page.unroute(editorUrl, failRefresh);
    const recoveredGraph = httpRpc(page, "get_dependency_graph");
    await panel(page)
      .getByRole("button", { name: "Reconcile submission", exact: true })
      .click();
    await recoveredGraph;
    await openAsset(page, 6, "DRAFT");
    expect(fixture("snapshot")).toEqual(knownSnapshot);
    await renderedHistory(page, MANAGER, knownSnapshot);

    // Same actor/org/role, different asset generation. B has no fixture service
    // or history, but canonical standing also permits same-tenant asset-null
    // evidence from preceding smokes. Capture the real authenticated B baseline
    // before holding A; do not invent an empty evidence projection.
    const bSections = ["evidence", "history"] as const;
    const bBaseline = await Promise.all(
      bSections.map((section) =>
        rpc(page, "get_asset_service_level_editor", {
          p_observed_actor_id: MANAGER,
          p_observed_organization_id: ORG,
          p_section: section,
          p_asset_id: SECOND_ASSET,
        }),
      ),
    );
    for (const [index, section] of bSections.entries()) {
      expect(bBaseline[index]).toMatchObject({
        actor_id: MANAGER,
        organization_id: ORG,
        section,
      });
      expect(Array.isArray(bBaseline[index].rows)).toBe(true);
    }
    expect(bBaseline[1].rows).toEqual([]);
    const bEvidenceRows = bBaseline[0].rows as Json[];
    for (const row of bEvidenceRows) {
      expect([null, SECOND_ASSET]).toContain(row.asset_id);
      expect([EVIDENCE, DOCUMENT]).not.toContain(row.id);
    }
    const bEvidenceOptions = [
      { value: "", text: "Verified supporting evidence…" },
      ...bEvidenceRows.map((row) => ({
        value: row.id,
        text: row.description,
      })),
    ];
    const expectBEvidence = async () => {
      await expect
        .poll(() =>
          panel(page)
            .getByLabel("Verified evidence")
            .locator("option")
            .evaluateAll((options) =>
              options.map((option) => ({
                value: (option as HTMLOptionElement).value,
                text: option.textContent,
              })),
            ),
        )
        .toEqual(bEvidenceOptions);
      for (const id of [EVIDENCE, DOCUMENT])
        await expect(
          panel(page)
            .getByLabel("Verified evidence")
            .locator(`option[value="${id}"]`),
        ).toHaveCount(0);
    };
    // Both held envelopes below are actual A responses.
    const evidenceHold = holdActualResponse(
      page,
      "get_asset_service_level_editor",
      "evidence",
    );
    const historyHold = holdActualResponse(
      page,
      "get_asset_service_level_editor",
      "history",
    );
    heldResponses.push(evidenceHold, historyHold);
    await page.route(evidenceHold.url, evidenceHold.handler);
    await page.route(historyHold.url, historyHold.handler);
    await page
      .getByRole("button", { name: "Leadership cockpit", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Risk portfolio", exact: true })
      .click();
    await openAsset(page, 6, "DRAFT");
    const [oldEvidence, oldAssetHistory] = await Promise.all([
      evidenceHold.held,
      historyHold.held,
    ]);
    expect(
      (oldEvidence.value.rows as Json[]).some((row) => row.id === EVIDENCE),
    ).toBe(true);
    expect(oldAssetHistory.value.rows).toEqual(
      knownSnapshot.history.map((row) =>
        Object.fromEntries(
          [
            "id",
            "created_at",
            "entity_type",
            "actor",
            "previous_state",
            "new_state",
            "event_data",
            "approval_reference",
          ].map((key) => [key, row[key]]),
        ),
      ),
    );
    const bResponses = bSections.map((section) =>
      page.waitForResponse(
        (response) =>
          isRpc(response, "get_asset_service_level_editor") &&
          response.request().postDataJSON().p_section === section &&
          response.request().postDataJSON().p_asset_id === SECOND_ASSET,
      ),
    );
    await panel(page).getByLabel("Asset").selectOption(SECOND_ASSET);
    for (const [index, response] of (await Promise.all(bResponses)).entries()) {
      expect(response.request().postDataJSON()).toEqual({
        p_observed_actor_id: MANAGER,
        p_observed_organization_id: ORG,
        p_section: bSections[index],
        p_asset_id: SECOND_ASSET,
      });
      expect(await response.json()).toEqual(bBaseline[index]);
    }
    await expectBEvidence();
    await expect(panel(page).getByLabel("Service name")).toHaveValue("");
    await panel(page)
      .getByLabel("Service name")
      .fill("Unsaved synthetic B-only editor marker");
    for (const held of [evidenceHold, historyHold]) held.release();
    await Promise.all([settleHeld(evidenceHold), settleHeld(historyHold)]);
    await page.unroute(evidenceHold.url, evidenceHold.handler);
    await page.unroute(historyHold.url, historyHold.handler);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(panel(page).getByLabel("Service name")).toHaveValue(
      "Unsaved synthetic B-only editor marker",
    );
    await expect(panel(page).getByLabel("Asset")).toHaveValue(SECOND_ASSET);
    await expectBEvidence();
    await expect(panel(page).getByText(SERVICE, { exact: true })).toHaveCount(0);
    await expect(
      panel(page)
        .getByRole("region", { name: "Canonical service consequence history" })
        .locator("details"),
    ).toHaveCount(0);
    expect(fixture("snapshot")).toEqual(knownSnapshot);
    await openAsset(page, 6, "DRAFT");
    await renderedHistory(page, MANAGER, knownSnapshot);

    // Hold an actual OLD readable history envelope, then observe role change
    // and newly restricted risk in the mounted application. No response data
    // is rewritten: release must not resurrect old visible historical content.
    const roleHold = holdActualResponse(
      page,
      "get_asset_service_level_editor",
      "history",
    );
    heldResponses.push(roleHold);
    await page.route(roleHold.url, roleHold.handler);
    await page
      .getByRole("button", { name: "Leadership cockpit", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Risk portfolio", exact: true })
      .click();
    await openAsset(page);
    const oldHistory = await roleHold.held;
    expect((oldHistory.value.rows as Json[]).length).toBe(6);
    fixture("restrict-risk");
    fixture("role-technician");
    await actualAuthTransition(page);
    await expect(panel(page).getByLabel("Service name")).toHaveCount(0);
    await expect(
      panel(page)
        .getByRole("region", { name: "Canonical service consequence history" })
        .locator("details"),
    ).toHaveCount(0);
    roleHold.release();
    await settleHeld(roleHold);
    await page.unroute(roleHold.url, roleHold.handler);
    await expect(panel(page).getByText(SERVICE, { exact: false })).toHaveCount(
      0,
    );
    fixture("restore-profile");
    fixture("public-risk");
    await actualAuthTransition(page);
    await openAsset(page, 6, "DRAFT");

    const orgHold = holdActualResponse(
      page,
      "get_asset_service_level_editor",
      "assets",
    );
    heldResponses.push(orgHold);
    await page.route(orgHold.url, orgHold.handler);
    await page
      .getByRole("button", { name: "Leadership cockpit", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Risk portfolio", exact: true })
      .click();
    const oldAssets = await orgHold.held;
    expect(
      (oldAssets.value.rows as Json[]).some((row) => row.id === ASSET),
    ).toBe(true);
    fixture("organization-foreign");
    await actualAuthTransition(page);
    await expect(
      panel(page).getByRole("option", { name: /U208-BROWSER-FOREIGN/ }),
    ).toBeAttached();
    orgHold.release();
    await settleHeld(orgHold);
    await page.unroute(orgHold.url, orgHold.handler);
    await expect(
      panel(page).getByRole("option", { name: /U208-BROWSER-PW-1/ }),
    ).toHaveCount(0);
    fixture("restore-profile");
    await actualAuthTransition(page);
    await openAsset(page, 6, "DRAFT");

    // A successful old actor write is held AFTER the real commit. A genuine
    // new actor session must discard its late callback/success message, while
    // the immutable receipt still proves the old named human decision.
    await riskPage(reviewer, 6, "DRAFT");
    const actorHold = holdActualResponse(
      reviewer,
      "verify_asset_service_level",
    );
    heldResponses.push(actorHold);
    await reviewer.route(actorHold.url, actorHold.handler);
    await panel(reviewer)
      .getByLabel("Independent review note")
      .fill(
        "Independent named human reviewed the exact current synthetic correction and preserved unknown values.",
      );
    await panel(reviewer)
      .getByRole("button", { name: "Verify current version", exact: true })
      .click();
    const oldWrite = await actorHold.held;
    receipt(oldWrite.value, oldWrite.request, ADMIN, 7, "verified");
    const committedBeforeRelease = fixture("snapshot");
    canonicalHistory(committedBeforeRelease, knownSnapshot);
    expect(committedBeforeRelease.service).toMatchObject({
      version: 7,
      status: "verified",
      reviewed_by: ADMIN,
    });
    await actualAuthTransition(reviewer, "technician@syncai.ca", "Tech123!@#");
    await expect(panel(reviewer).getByLabel("Service name")).toHaveCount(0);
    let staleGraphCallbacks = 0;
    const countGraph = (request: Request) => {
      if (request.url().endsWith("/rpc/get_dependency_graph"))
        staleGraphCallbacks++;
    };
    reviewer.on("request", countGraph);
    actorHold.release();
    await settleHeld(actorHold);
    await reviewer.unroute(actorHold.url, actorHold.handler);
    await reviewer.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(
      panel(reviewer).getByText(/Independently verified/),
    ).toHaveCount(0);
    expect(staleGraphCallbacks).toBe(0);
    reviewer.off("request", countGraph);
    expect(fixture("snapshot")).toEqual(committedBeforeRelease);
    expect(committedBeforeRelease.approvals).toEqual(initial.approvals);
    expect(committedBeforeRelease.workOrders).toEqual(initial.workOrders);
    await riskPage(page, 7, "VERIFIED");
    await renderedHistory(page, MANAGER, committedBeforeRelease);
    await expect(
      panel(page).getByText(
        /Included in analysis against the current evidence basis/,
      ),
    ).toBeVisible();
    await expect(
      panel(page).getByText(/Unfinished operational-evidence rail/),
    ).toBeVisible();
    await panel(page).screenshot({
      path: testInfo.outputPath("u208-bounded-operational-governance.png"),
    });
    await testInfo.attach("u208-acceptance-boundary", {
      body: "Real local auth/HTTP/SQL synthetic operational witness only. Privileged risk association, sensitivity/profile changes and description correction are fixture controls, not customer actions or canonical correction-audit proof. Full positive approved-document and primary normative-obligation standing acceptance remains pending.",
      contentType: "text/plain",
    });
  } finally {
    for (const held of heldResponses) held.release();
    try {
      // Drain only actually-started held RPC handlers and all route handlers
      // BEFORE shared fixture restoration. A bounded drain failure skips those
      // writes: the isolated database then needs a fresh reset, not an unsafe
      // restoration concurrent with unsettled work. Never-matched holds don't wait.
      const routeFailures = await Promise.all(
        heldResponses
          .filter((held) => held.started())
          .map((held) => held.drain()),
      );
      await bounded(page.unrouteAll({ behavior: "wait" }), "Author routes");
      await bounded(
        reviewer.unrouteAll({ behavior: "wait" }),
        "Reviewer routes",
      );
      fixture("restore-profile");
      fixture("public-risk");
      const failures = routeFailures.filter((failure) => failure !== undefined);
      cleanupRouteFailures.push(...failures);
    } finally {
      await reviewerContext.close();
    }
  }
  // Preserve an already-thrown body failure. If the body succeeded, a contained
  // late handler failure must still fail acceptance, after safe restoration.
  if (cleanupRouteFailures.length)
    throw new AggregateError(
      cleanupRouteFailures,
      "Real held response handler failed",
    );
});
