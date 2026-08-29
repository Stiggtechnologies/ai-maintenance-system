/**
 * First-party product analytics (ui_events) — Tier 2 of the analytics plan.
 *
 * Fire-and-forget by design: analytics must never block or break the UX.
 * Events are buffered (max 5 or 10s) and flushed through the governed
 * log_ui_events RPC (org/user/device set server-side). NO customer content
 * is ever sent — event names, a short detail, and the route only.
 */
import { supabase } from "../lib/supabase";

export type UiEventName =
  | "page_view"
  | "tab_tap"
  | "drawer_open"
  | "drawer_close"
  | "field_report_filed"
  | "kb_ingest_submitted"
  | "copilot_question";

interface UiEventPayload {
  event_name: UiEventName;
  event_detail?: string;
  route: string;
  device_class: "mobile" | "desktop";
}

export const MAX_BATCH = 50;
const FLUSH_BATCH = 5;
const FLUSH_MS = 10_000;

let buffer: UiEventPayload[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function deviceClass(): "mobile" | "desktop" {
  if (typeof window === "undefined") return "desktop";
  if (typeof window.matchMedia !== "function") return "desktop";
  return window.matchMedia("(max-width: 767px)").matches ? "mobile" : "desktop";
}

function scheduleFlush() {
  if (timer != null) return;
  timer = setTimeout(() => {
    timer = null;
    void flushUiEvents();
  }, FLUSH_MS);
}

export function trackUiEvent(name: UiEventName, detail?: string): void {
  if (typeof window === "undefined") return;
  buffer.push({
    event_name: name,
    event_detail: detail?.slice(0, 120),
    route: window.location.pathname.slice(0, 200),
    device_class: deviceClass(),
  });
  if (buffer.length >= FLUSH_BATCH) {
    void flushUiEvents();
  } else {
    scheduleFlush();
  }
}

export async function flushUiEvents(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer;
  buffer = [];
  if (timer != null) {
    clearTimeout(timer);
    timer = null;
  }
  try {
    await supabase.rpc("log_ui_events", { p_events: batch });
  } catch {
    // Analytics must never surface errors — drop silently.
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (buffer.length === 0) return;
    // Best-effort on teardown; a missed flush is acceptable.
    void flushUiEvents();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && buffer.length > 0) {
      void flushUiEvents();
    }
  });
}
