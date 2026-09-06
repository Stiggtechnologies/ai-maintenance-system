/**
 * uiEvents service — first-party product analytics (Tier 2). The migration
 * contract is pinned here: governed batch RPC, org/user set server-side,
 * admin-only reads, no customer content, bounded batch size.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { MAX_BATCH, trackUiEvent, flushUiEvents } from "./uiEvents";

describe("trackUiEvent (buffered, fire-and-forget)", () => {
  it("never throws, never blocks the caller", () => {
    // No supabase session in this environment: the tracker must silently
    // buffer or drop, never surface analytics errors into the UX.
    expect(() => trackUiEvent("page_view")).not.toThrow();
    expect(() => flushUiEvents()).not.toThrow();
  });

  it("exposes the documented event vocabulary bound", () => {
    expect(MAX_BATCH).toBeLessThanOrEqual(50);
  });
});

describe("ui_events migration contract", () => {
  const migration = readFileSync(
    "supabase/migrations/20261129090000_ui_events.sql",
    "utf8",
  );

  it("creates a tenant-scoped, content-free event register", () => {
    expect(migration).toContain("create table if not exists public.ui_events");
    expect(migration).toContain(
      "organization_id uuid not null references organizations(id)",
    );
    expect(migration).toContain(
      "event_detail text check (char_length(event_detail) <= 160)",
    );
    expect(migration).toContain("device_class in ('mobile', 'desktop')");
  });

  it("reads are admin-only within the same organization", () => {
    expect(migration).toContain("ui_events_read");
    expect(migration).toContain("p.role in ('admin', 'ai_admin')");
  });

  it("writes go only through the governed batch RPC", () => {
    expect(migration).toContain(
      "create or replace function public.log_ui_events",
    );
    expect(migration).toContain("security definer");
    expect(migration).toContain("jsonb_array_length(p_events) > 50");
    expect(migration).toContain(
      "revoke execute on function public.log_ui_events",
    );
    expect(migration).toContain(
      "grant execute on function public.log_ui_events",
    );
    // The RPC sets the tenant server-side; the client never declares it.
    expect(migration).toContain("v_org uuid := app_current_org()");
    expect(migration).not.toContain("p_organization_id");
  });
});
