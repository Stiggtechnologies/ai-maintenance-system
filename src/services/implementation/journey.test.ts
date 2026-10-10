import { describe, it, expect } from "vitest";
import {
  createImplementationCommand,
  implementationStep,
  reconcileImplementation,
} from "./journey";

const intent = {
  billingId: "purchase",
  instanceId: "journey",
  revision: 2,
  action: "prepare" as const,
  payload: {},
};
describe("retained implementation intent", () => {
  it("creates one exact retry intent without changing the caller's payload", () => {
    const command = createImplementationCommand(intent, "request");
    expect(command).toEqual({ ...intent, commandId: "request", payload: {} });
    intent.payload = { changed: true };
    expect(command.payload).toEqual({});
    intent.payload = {};
  });
  it("requires a matching receipt before discarding an unknown outcome", () => {
    const command = createImplementationCommand(intent, "request");
    expect(
      reconcileImplementation(command, {
        commandId: "other",
        instanceId: "journey",
        revision: 3,
      }),
    ).toBe(false);
    expect(
      reconcileImplementation(command, {
        commandId: "request",
        instanceId: "different",
        revision: 3,
      }),
    ).toBe(false);
    expect(
      reconcileImplementation(command, {
        commandId: "request",
        instanceId: "journey",
        revision: 3,
      }),
    ).toBe(true);
  });
  it("distinguishes subscription, readiness, first result and accepted implementation", () => {
    expect(implementationStep("planning", false)).toContain("mapping");
    expect(implementationStep("prepared", true)).toContain("first result");
    expect(implementationStep("accepted", false)).toContain("revalidate");
    expect(implementationStep("accepted", true)).toContain("accepted");
    expect(implementationStep("paused", false)).toContain("retained");
  });
});
