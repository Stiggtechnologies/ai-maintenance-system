/**
 * Loads a Supabase edge function into the Vitest process without Deno, without
 * deploying, and without contacting Stripe, AWS, Salesforce, or an LLM.
 *
 * Application source is not modified. Imports of `npm:` / `jsr:` modules are
 * removed, `Deno.serve` is captured, and `createClient` is supplied by the test.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { vi } from "vitest";

type EdgeHandler = (req: Request) => Promise<Response> | Response;

type EdgeClient = (url: string, key: string, options?: unknown) => unknown;

type EdgeSlot = {
  env: Record<string, string | undefined>;
  createClient: EdgeClient;
  handler?: EdgeHandler;
};

const registry = new Map<string, EdgeSlot>();

export const edgeBaseEnv = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
  ALLOWED_ORIGIN: "https://app.syncai.ca",
} as const;

function rewrite(source: string, id: string): string {
  const withoutImports = source
    .replace(/^\s*import\s+(?:type\s+)?(?:[^'"\n]+from\s+)?["'][^"']+["'];?\s*$/gm, "")
    .replace(
      /await import\(\s*["']npm:@supabase\/supabase-js@[^"']+["']\s*\)/g,
      `({ createClient: (...args) => globalThis.__edgeSlots[${JSON.stringify(id)}].createClient(...args) })`,
    );

  return `
const __edge = globalThis.__edgeSlots[${JSON.stringify(id)}];
const Deno = {
  env: { get: (name) => __edge.env[name] },
  serve: (handler) => { __edge.handler = handler; },
};
const createClient = (...args) => __edge.createClient(...args);
${withoutImports}
`;
}

export class LoadedEdgeFunction {
  constructor(private readonly slot: EdgeSlot) {}

  get env(): Record<string, string | undefined> {
    return this.slot.env;
  }

  set createClient(fn: EdgeClient) {
    this.slot.createClient = fn;
  }

  invoke(request: Request): Promise<Response> {
    const handler = this.slot.handler;
    if (!handler) throw new Error("Edge function did not register a handler");
    return Promise.resolve(handler(request));
  }
}

export function loadEdgeFunction(
  relativePath: string,
  env: Record<string, string | undefined> = {},
): LoadedEdgeFunction {
  const id = `edge_${Math.random().toString(36).slice(2)}_${registry.size}`;
  const slot: EdgeSlot = {
    env: { ...env },
    createClient: () => {
      throw new Error(`createClient was not stubbed for ${relativePath}`);
    },
  };
  registry.set(id, slot);
  const slots = ((globalThis as { __edgeSlots?: Record<string, EdgeSlot> }).__edgeSlots ??= {});
  slots[id] = slot;

  const source = readFileSync(relativePath, "utf8");
  const rewritten = rewrite(source, id);
  const emitted = ts.transpileModule(rewritten, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    fileName: relativePath,
  }).outputText;

  // The rewritten module has no imports. Evaluate it as a script so Vitest's
  // module graph never fetches npm: or jsr: specifiers.
  const register = new Function(`${emitted}\nreturn __edge.handler;`);
  const handler = register() as EdgeHandler | undefined;
  if (!handler) {
    throw new Error(`Deno.serve did not register a handler for ${relativePath}`);
  }
  slot.handler = handler;
  return new LoadedEdgeFunction(slot);
}

export function edgeRequest(
  functionName: string,
  suffix = "",
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    /** Use the path the function matcher expects, without /functions/v1. */
    root?: "internal" | "deployed";
  } = {},
): Request {
  const headers = new Headers(init.headers);
  const method = init.method ?? (init.body === undefined ? "GET" : "POST");
  let body: string | undefined;
  if (init.body !== undefined && method !== "GET" && method !== "HEAD") {
    body = typeof init.body === "string" ? init.body : JSON.stringify(init.body);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  const prefix = init.root === "deployed" ? `/functions/v1/${functionName}` : `/${functionName}`;
  return new Request(`https://example.supabase.co${prefix}${suffix}`, {
    method,
    headers,
    body,
  });
}

export async function readJson(response: Response): Promise<any> {
  return response.json();
}

export function jsonFetchResult(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function installNoNetworkFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    throw new Error(`unexpected network call to ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}
