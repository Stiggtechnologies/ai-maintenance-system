/**
 * integration-connect — schema-validation tests
 * =============================================
 * The validateAgainstSchema function is pure logic and the riskiest part
 * of the Edge Function (it's the gate before credentials hit the DB).
 * Re-implementing it in this test file keeps the test deno-free and the
 * function behavior contract explicit.
 *
 * If you change validateAgainstSchema in index.ts, mirror the change here.
 */
import { describe, it, expect } from 'vitest';

// Re-implementation of the validator from index.ts. Kept here so the test
// runs under Vitest (Node) without needing the Deno edge runtime.
function validateAgainstSchema(
  data: Record<string, unknown>,
  schema: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  if (!schema || schema.type !== 'object') return { ok: true };
  const required = (schema.required as string[] | undefined) ?? [];
  for (const field of required) {
    const v = data[field];
    if (v === undefined || v === null || v === '') {
      return { ok: false, error: `credentials.${field} is required` };
    }
  }
  const props = (schema.properties as Record<string, { type?: string }> | undefined) ?? {};
  for (const [key, def] of Object.entries(props)) {
    if (data[key] === undefined) continue;
    if (def.type === 'string' && typeof data[key] !== 'string') {
      return { ok: false, error: `credentials.${key} must be a string` };
    }
  }
  return { ok: true };
}

const ANTHROPIC_SCHEMA = {
  type: 'object',
  required: ['api_key'],
  properties: {
    api_key: { type: 'string', format: 'password' },
    model: { type: 'string' },
  },
};

const SAP_SCHEMA = {
  type: 'object',
  required: ['base_url', 'client', 'username', 'password'],
  properties: {
    base_url: { type: 'string', format: 'uri' },
    client: { type: 'string' },
    username: { type: 'string' },
    password: { type: 'string', format: 'password' },
  },
};

describe('integration-connect: validateAgainstSchema', () => {
  it('passes when no schema is provided', () => {
    const r = validateAgainstSchema({ foo: 'bar' }, {});
    expect(r.ok).toBe(true);
  });

  it('passes when all required Anthropic fields are present', () => {
    const r = validateAgainstSchema(
      { api_key: 'sk-ant-test', model: 'claude-sonnet-4-6' },
      ANTHROPIC_SCHEMA,
    );
    expect(r.ok).toBe(true);
  });

  it('rejects when a required Anthropic field is missing', () => {
    const r = validateAgainstSchema({}, ANTHROPIC_SCHEMA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('api_key');
  });

  it('rejects when a required field is an empty string', () => {
    const r = validateAgainstSchema({ api_key: '' }, ANTHROPIC_SCHEMA);
    expect(r.ok).toBe(false);
  });

  it('rejects when a required field is null', () => {
    const r = validateAgainstSchema({ api_key: null as unknown as string }, ANTHROPIC_SCHEMA);
    expect(r.ok).toBe(false);
  });

  it('rejects when a string-typed field is provided as a number', () => {
    const r = validateAgainstSchema(
      { api_key: 12345 as unknown as string },
      ANTHROPIC_SCHEMA,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('api_key');
  });

  it('passes for SAP when all four required fields are present', () => {
    const r = validateAgainstSchema(
      { base_url: 'https://sap.acme.com', client: '100', username: 'user', password: 'pw' },
      SAP_SCHEMA,
    );
    expect(r.ok).toBe(true);
  });

  it('reports the FIRST missing required SAP field', () => {
    const r = validateAgainstSchema(
      { base_url: 'https://sap.acme.com' },
      SAP_SCHEMA,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('client');
  });

  it('does not require fields that are not in the required array', () => {
    const r = validateAgainstSchema(
      { api_key: 'sk-ant-test' }, // model is optional
      ANTHROPIC_SCHEMA,
    );
    expect(r.ok).toBe(true);
  });

  it('returns ok for non-object root schemas (no validation)', () => {
    const r = validateAgainstSchema({}, { type: 'string' });
    expect(r.ok).toBe(true);
  });
});
