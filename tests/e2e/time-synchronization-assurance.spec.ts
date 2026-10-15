import { test, expect } from "@playwright/test";

// Actual seeded Supabase/browser witness, not a mocked RPC or a production claim.
for (const fixture of [
  {
    key: "e12-browser-enabled-synthetic",
    enabled: true,
    expectedState: "unproven",
  },
  {
    key: "e12-browser-disabled-synthetic",
    enabled: false,
    expectedState: "disabled",
  },
]) {
  test(`clock assurance ${fixture.expectedState} source is customer-reachable without invented defaults or authority`, async ({
    page,
  }, testInfo) => {
    await page.goto("/signin");
    await page
      .getByRole("textbox", { name: /work email/i })
      .fill("admin@syncai.ca");
    await page.locator('input[type="password"]').fill("Admin123!@#");
    await page.getByRole("button", { name: /access syncai/i }).click();
    await expect(
      page.getByRole("heading", { name: "Mission Control" }),
    ).toBeVisible({ timeout: 30_000 });
    const initialResponse = page.waitForResponse((r) =>
      r.url().endsWith("/rpc/get_connector_time_assurance"),
    );
    await page.goto("/integrations");
    const initialStatus = await (await initialResponse).json();
    // Each attempt owns a fresh explicit synthetic source. A retry may not
    // reset or reuse the first attempt's committed contract/receipt history.
    expect(testInfo.retry).toBeLessThan(2);
    const attemptKey = `${fixture.key}-attempt-${testInfo.retry}`;
    const matches = initialStatus.connectors.filter(
      (row: { connectorKey: string }) => row.connectorKey === attemptKey,
    );
    expect(matches).toHaveLength(1);
    const initial = matches[0];
    expect(initial.configurationRevision).toBe(0);
    expect(initial.configuredAt).toBeNull();
    expect(initial.enabled).toBe(fixture.enabled);
    expect(initial.configurationEvidenceVerified).toBe(false);
    expect(initial.eligibleForTimeSensitiveEvidence).toBe(false);
    const clock = page.getByRole("region", { name: "Event-time assurance" });
    await expect(clock).toBeVisible({ timeout: 30_000 });
    await expect(
      clock.getByText(/an opaque evidence reference is not verified/i),
    ).toBeVisible();
    const tolerance = clock.getByLabel("Recorded tolerance in milliseconds");
    const freshness = clock.getByLabel("Maximum observation age in minutes");
    const save = clock.getByRole("button", { name: "Save clock contract" });
    await expect(tolerance).toHaveValue("");
    await expect(freshness).toHaveValue("");
    await expect(save).toBeDisabled();
    const connector = clock.getByLabel("Time-assurance connector");
    await connector.selectOption(initial.connectorId);
    await clock
      .getByPlaceholder(/Authoritative source/i)
      .fill("E2E draft grandmaster");
    await tolerance.fill("25");
    await freshness.fill("10");
    await clock
      .getByPlaceholder(/Evidence reference/i)
      .fill("E2E-DRAFT-TIME-REFERENCE");
    await clock
      .getByPlaceholder(/Clock authority/i)
      .fill(
        "Synthetic browser fixture; canonical engineering evidence approval is not claimed.",
      );
    await expect(save).toBeEnabled();
    const configuredResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/rpc/configure_connector_time_assurance") &&
        response.request().method() === "POST",
    );
    await save.click();
    const response = await configuredResponse;
    expect(response.status()).toBe(200);
    const recorded = await response.json();
    expect(recorded.error).toBeUndefined();
    expect(recorded.ok).toBe(true);
    const submitted = response.request().postDataJSON();
    expect(recorded.connector_id).toBe(initial.connectorId);
    expect(recorded.idempotency_key).toBe(submitted.p_idempotency_key);
    expect(recorded.idempotency_key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(recorded.audit_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(recorded.replay).toBe(false);
    expect(recorded.current_configuration_revision).toBe(
      recorded.configuration_revision,
    );
    expect(Number.isSafeInteger(recorded.configuration_revision)).toBe(true);
    expect(recorded.configuration_revision).toBeGreaterThan(0);
    expect(recorded.state).toBe("unproven");
    expect(recorded.operational_authority).toBe(false);
    expect(recorded.configuration_evidence_verified).toBe(false);
    expect(recorded.eligible_for_time_sensitive_evidence).toBe(false);
    await expect(
      clock.getByText(
        `Clock contract recorded as revision ${recorded.configuration_revision}. A current service observation is still required; canonical evidence approval remains unverified.`,
        { exact: true },
      ),
    ).toBeVisible();

    const statusResponse = page.waitForResponse((r) =>
      r.url().endsWith("/rpc/get_connector_time_assurance"),
    );
    await page.reload();
    const status = await (await statusResponse).json();
    const retained = status.connectors.find(
      (row: { connectorId: string }) => row.connectorId === initial.connectorId,
    );
    expect(retained.configurationEvidenceReference).toBe(
      "E2E-DRAFT-TIME-REFERENCE",
    );
    expect(retained.configurationRevision).toBe(
      recorded.configuration_revision,
    );
    expect(retained.toleranceMs).toBe(25);
    expect(retained.maxObservationAgeMinutes).toBe(10);
    expect(retained.configurationEvidenceVerified).toBe(false);
    expect(retained.eligibleForTimeSensitiveEvidence).toBe(false);
    expect(retained.enabled).toBe(fixture.enabled);
    expect(retained.state).toBe(fixture.expectedState);
    await expect(
      page.getByRole("region", { name: "Event-time assurance" }),
    ).toBeVisible();
    const assessmentRegion = page.getByRole("region", {
      name: "Event-time assurance",
    });
    if (fixture.enabled) {
      // Assess the earlier event AFTER a newer contract is saved, proving the
      // actual browser/read RPC does not substitute the current tolerance.
      await assessmentRegion
        .getByLabel("Time-assurance connector")
        .selectOption(initial.connectorId);
      await assessmentRegion
        .getByPlaceholder(/Authoritative source/i)
        .fill("E2E draft grandmaster revision two");
      await assessmentRegion
        .getByLabel("Recorded tolerance in milliseconds")
        .fill("1");
      await assessmentRegion
        .getByLabel("Maximum observation age in minutes")
        .fill("1");
      await assessmentRegion
        .getByPlaceholder(/Evidence reference/i)
        .fill("E2E-DRAFT-TIME-REFERENCE-TWO");
      await assessmentRegion
        .getByPlaceholder(/Clock authority/i)
        .fill(
          "Synthetic second clock contract; no engineering approval or production clock authority is claimed.",
        );
      const revisedResponse = page.waitForResponse(
        (r) =>
          r.url().endsWith("/rpc/configure_connector_time_assurance") &&
          r.request().method() === "POST",
      );
      await assessmentRegion
        .getByRole("button", { name: "Save clock contract" })
        .click();
      const revisedHttp = await revisedResponse;
      expect(revisedHttp.status()).toBe(200);
      const revised = await revisedHttp.json();
      expect(revised.error).toBeUndefined();
      expect(revised.ok).toBe(true);
      expect(revised.connector_id).toBe(initial.connectorId);
      expect(revised.idempotency_key).toBe(
        revisedHttp.request().postDataJSON().p_idempotency_key,
      );
      expect(revised.idempotency_key).not.toBe(recorded.idempotency_key);
      expect(revised.audit_id).not.toBe(recorded.audit_id);
      expect(revised.replay).toBe(false);
      expect(revised.current_configuration_revision).toBe(
        revised.configuration_revision,
      );
      expect(revised.configuration_revision).toBe(
        recorded.configuration_revision + 1,
      );
      expect(revised.operational_authority).toBe(false);
      expect(revised.configuration_evidence_verified).toBe(false);
      expect(revised.eligible_for_time_sensitive_evidence).toBe(false);
      await expect(
        assessmentRegion.getByText(
          `Clock contract recorded as revision ${revised.configuration_revision}. A current service observation is still required; canonical evidence approval remains unverified.`,
          { exact: true },
        ),
      ).toBeVisible();
    }
    await assessmentRegion
      .getByLabel("Event assessment connector")
      .selectOption(initial.connectorId);
    await assessmentRegion
      .getByLabel("Event timestamp with timezone")
      .fill(retained.configuredAt);
    const assessmentResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/rpc/evaluate_connector_event_time") &&
        r.request().method() === "POST",
    );
    await assessmentRegion
      .getByRole("button", { name: "Assess recorded event time" })
      .click();
    const assessedResponse = await assessmentResponse;
    expect(assessedResponse.status()).toBe(200);
    const assessed = await assessedResponse.json();
    expect(assessed.error).toBeUndefined();
    expect(assessed.contract_scope).toBe("recorded_contract_at_event");
    expect(assessed.state).toBe(fixture.expectedState);
    expect(assessed.within_clock_contract).toBe(false);
    expect(assessed.configuration_evidence_verified).toBe(false);
    expect(assessed.eligible_for_time_sensitive_evidence).toBe(false);
    expect(assessed.operational_authority).toBe(false);
    if (fixture.enabled) {
      expect(assessed.history_integrity).toBe("verified_recorded_chain");
      expect(assessed.configuration_revision).toBe(
        recorded.configuration_revision,
      );
      expect(assessed.configuration_audit_id).toBeTruthy();
      expect(assessed.tolerance_ms).toBe(25);
      expect(assessed.max_observation_age_minutes).toBe(10);
      await expect(
        assessmentRegion.getByText(assessed.configuration_audit_id, {
          exact: true,
        }),
      ).toBeVisible();
    } else {
      expect(assessed.history_integrity).toBe("unproven");
      expect(assessed.configuration_revision).toBeNull();
      expect(assessed.configuration_audit_id).toBeNull();
      expect(assessed.observation_id).toBeNull();
    }
    await expect(
      assessmentRegion.getByText(/Time-sensitive evidence remains ineligible/),
    ).toBeVisible();
    await page
      .getByRole("region", { name: "Event-time assurance" })
      .screenshot({
        path: testInfo.outputPath(
          `draft-clock-assurance-${fixture.expectedState}.png`,
        ),
      });
  });
}
