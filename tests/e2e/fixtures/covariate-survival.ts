import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { BrowserContext } from "@playwright/test";
import {
  assuranceFixture,
  requireLocalEndpoint,
} from "../../../src/test/support/survivalBrowserBoundary";

// Disposable LOCAL assurance fixtures, not real MFA enrollment, customer
// evidence, engineering qualification or production credentials. Do not log
// tokens/keys or persist them in browser traces. All actual auth/RLS, source,
// capture, independent-review and calculation gates remain enabled.
const ORG = "11111111-1111-1111-1111-111111111111";
const ASSET = "aaaaaaaa-0000-0000-0000-000000000002";
const START = "2026-08-01T00:00:00Z";
const PASSWORD = "SyntheticSurvivalBrowser123!";

function localConfig() {
  const output = execFileSync("supabase", ["status", "-o", "env"], {
    encoding: "utf8",
    timeout: 15_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const values: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const match = line.match(/^(API_URL|ANON_KEY|JWT_SECRET)="([^"]+)"$/);
    if (match) values[match[1]] = match[2];
  }
  if (!values.API_URL || !values.ANON_KEY || !values.JWT_SECRET)
    throw new Error("Local Supabase auth configuration unavailable");
  requireLocalEndpoint(values.API_URL, "54321");
  const clientUrl = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
  requireLocalEndpoint(clientUrl, "54321");
  if (
    new URL(clientUrl).origin !== new URL(values.API_URL).origin ||
    (process.env.E2E_SUPABASE_ANON_KEY &&
      process.env.E2E_SUPABASE_ANON_KEY !== values.ANON_KEY)
  )
    throw new Error(
      "Browser and fixture must use the same local Supabase origin and key",
    );
  return {
    apiUrl: values.API_URL,
    anonKey: values.ANON_KEY,
    signingKey: values.JWT_SECRET,
  };
}

function sql(statement: string): string {
  // Fixed explicit loopback host/port/database. No user shell/environment
  // expansion, no reset, no delete, no production fallback.
  return execFileSync(
    "psql",
    [
      "-h",
      "127.0.0.1",
      "-p",
      "54322",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-qAt",
    ],
    {
      input: statement,
      encoding: "utf8",
      timeout: 15_000,
      env: { ...process.env, PGPASSWORD: "postgres" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  ).trim();
}

export async function actualRpc<T = Record<string, unknown>>(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  if (!data || typeof data !== "object")
    throw new Error(`${name}: no actual receipt`);
  if ("error" in data) throw new Error(`${name}: ${String(data.error)}`);
  return data as T;
}

function clientFor(apiUrl: string, anonKey: string, token?: string) {
  return createClient(apiUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }),
    },
  });
}

export async function installLocalBrowserSession(
  context: BrowserContext,
  apiUrl: string,
  session: Session,
) {
  requireLocalEndpoint(apiUrl, "54321");
  const key = `sb-${new URL(apiUrl).hostname.split(".")[0]}-auth-token`;
  await context.addInitScript(
    ({ key, session }) => {
      // Never transmit or install the local fixture on any other origin.
      if (location.origin === "http://localhost:5173")
        localStorage.setItem(key, JSON.stringify(session));
    },
    { key, session },
  );
}

export async function createSurvivalBrowserFixture(
  baseURL: string,
  { multipleAssets = false }: { multipleAssets?: boolean } = {},
) {
  requireLocalEndpoint(baseURL, "5173");
  if (new URL(baseURL).hostname !== "localhost")
    throw new Error("Expected local browser origin");
  const config = localConfig(); // Validate BOTH origins before any writes.
  const authorId = randomUUID();
  const reviewerId = randomUUID();
  const component = `Browser synthetic survival ${randomUUID()}`;
  for (const id of [authorId, reviewerId]) {
    sql(`insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
      created_at,updated_at,raw_app_meta_data,raw_user_meta_data,confirmation_token,
      recovery_token,email_change,email_change_token_new,email_change_token_current,
      phone_change,phone_change_token,reauthentication_token) values
      ('00000000-0000-0000-0000-000000000000','${id}','authenticated','authenticated',
      'survival-browser-${id}@invalid.syncai.ca',crypt('${PASSWORD}',gen_salt('bf')),now(),now(),now(),
      '{"provider":"email","providers":["email"]}','{}','','','','','','','','');
      insert into user_profiles(id,organization_id,email,full_name,role) values
      ('${id}','${ORG}','survival-browser-${id}@invalid.syncai.ca','Synthetic browser human','reliability_engineer');
      insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at,last_sign_in_at)
      values(gen_random_uuid(),'${id}','${id}',jsonb_build_object('sub','${id}','email',
        'survival-browser-${id}@invalid.syncai.ca'),'email',now(),now(),now());
      insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,secret,created_at,updated_at)
      values('${randomUUID()}','${id}','Synthetic local assurance only','totp','verified','',now(),now());`);
  }
  async function login(id: string) {
    const auth = clientFor(config.apiUrl, config.anonKey);
    const { data, error } = await auth.auth.signInWithPassword({
      email: `survival-browser-${id}@invalid.syncai.ca`,
      password: PASSWORD,
    });
    if (error || !data.session)
      throw new Error("Actual local GoTrue password session unavailable");
    const session = assuranceFixture(data.session, config.signingKey);
    const client = clientFor(
      config.apiUrl,
      config.anonKey,
      session.access_token,
    );
    const verified = await client.auth.getUser(session.access_token);
    if (verified.error || verified.data.user?.id !== id)
      throw new Error(
        `Actual GoTrue getUser must verify the local session (status=${verified.error?.status ?? "none"}, code=${verified.error?.code ?? "none"})`,
      );
    return {
      client,
      session,
      aal1: clientFor(config.apiUrl, config.anonKey, data.session.access_token),
    };
  }
  const author = await login(authorId);
  const reviewer = await login(reviewerId);
  // A repeated component life is not an independent physical asset. Keep the
  // single-asset fixture for the refusal; separately exercise three canonical
  // assets without altering a claimed cluster map in a browser request.
  const assetIds = multipleAssets
    ? [
        ASSET,
        "aaaaaaaa-0000-0000-0000-000000000001",
        "aaaaaaaa-0000-0000-0000-000000000003",
      ]
    : [ASSET];
  const assetEvidenceIds = new Map<string, string>();
  for (const assetId of assetIds) {
    const id = randomUUID();
    assetEvidenceIds.set(assetId, id);
    sql(`insert into evidence_items(id,organization_id,asset_id,source_system,evidence_type,description,
    evidence_class,ts,verification_status,verified_by,verified_at,verification_method)
    values('${id}','${ORG}','${assetId}','Browser synthetic observations','synthetic_covariates',
    'Synthetic browser installation and condition evidence, not customer engineering data.',
    'MEASURED','${START}','verified','${reviewerId}',now(),'Independent synthetic fixture review');`);
  }
  const evidenceId = assetEvidenceIds.get(ASSET)!;
  const xs = [0.2, -0.4, 1, 0, 0.7, -0.8, 0.2, 0.5, -0.1, 0.9, -0.3, 0.4];
  for (let index = 1; index <= 12; index++) {
    // Group four lives per canonical asset so each has failures and censoring.
    const eventAssetId =
      assetIds[Math.floor((index - 1) / 4) % assetIds.length];
    const event = await actualRpc<{ event_id: number }>(
      author.client,
      "record_component_life_event",
      {
        p_asset_id: eventAssetId,
        p_component: component,
        p_hours_at_change_out: index,
        p_event_kind: index % 3 === 0 ? "scheduled" : "failure",
        p_event_date: "2026-09-01",
        p_source_file: "Browser synthetic source",
        p_source_basis:
          "Synthetic actual RPC exposure witness, not customer data.",
      },
    );
    await actualRpc(author.client, "record_survival_covariate_overlay", {
      p_event_id: event.event_id,
      p_expected_version: 0,
      p_overlay: {
        mode: "include",
        basis:
          "Independent synthetic condition, timing and complete-life source witness.",
        lifeRef: `browser-${authorId}-${index}`,
        stratum: "synthetic-design",
        entryHours: 0,
        serviceStartedAt: START,
        terminalObservedAt: "2026-09-01T00:00:00Z",
        intervals: [
          {
            startHours: 0,
            stopHours: index,
            startedAt: START,
            endedAt: "2026-09-01T00:00:00Z",
            values: [
              {
                name: "synthetic_load",
                unit: "ratio",
                value: xs[index - 1],
                evidenceItemId: assetEvidenceIds.get(eventAssetId),
                observedAtHours: 0,
                availableAtHours: 0,
                validThroughHours: index,
                observedAt: START,
                availableAt: START,
              },
            ],
          },
        ],
      },
    });
    await actualRpc(reviewer.client, "review_survival_covariate_overlay", {
      p_event_id: event.event_id,
      p_expected_version: 1,
      p_decision: "validated",
      p_basis:
        "Independent exact synthetic physical-life, measurement and censoring review.",
    });
  }
  const installMeter = Number(
    sql(`select coalesce(max(value),0)+1000 from asset_meter_readings
    where organization_id='${ORG}' and asset_id='${ASSET}' and meter_kind='operating_hours';`),
  );
  const meterTime = new Date(Date.now() - 60_000).toISOString();
  const validUntil = new Date(Date.now() + 86_400_000).toISOString();
  const instance = await actualRpc<{ component_instance_id: string }>(
    author.client,
    "record_component_installation",
    {
      p_asset_id: ASSET,
      p_component: component,
      p_position: "synthetic-current",
      p_installed_at: START,
      p_installed_meter_hours: installMeter,
      p_source_system: "Browser synthetic installation",
      p_basis:
        "Actual canonical installation fixture, not customer engineering evidence.",
    },
  );
  const meter = await actualRpc<{ meter_reading_id: string }>(
    author.client,
    "record_asset_meter_reading",
    {
      p_asset_id: ASSET,
      p_value: installMeter + 8,
      p_recorded_at: meterTime,
      p_source_system: "Browser synthetic meter",
      p_basis:
        "Explicit synthetic operating meter observation; no imputed age.",
    },
  );
  const meterEvidenceId = randomUUID();
  sql(`insert into evidence_items(id,organization_id,asset_id,source_system,evidence_type,description,
    evidence_class,ts,verification_status,verified_by,verified_at,verification_method)
    values('${meterEvidenceId}','${ORG}','${ASSET}','Browser synthetic meter','synthetic_covariates',
    'Synthetic exact current meter observation.','MEASURED','${meterTime}','verified','${reviewerId}',
    now(),'Independent synthetic meter review');`);
  return {
    apiUrl: config.apiUrl,
    author,
    reviewer,
    authorId,
    reviewerId,
    component,
    evidenceId,
    meterEvidenceId,
    instanceId: instance.component_instance_id,
    meterId: meter.meter_reading_id,
    meterTime,
    validUntil,
    installMeter,
    assetId: ASSET,
    assetIds,
    startedAt: START,
  };
}
