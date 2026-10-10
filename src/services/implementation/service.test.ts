import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ImplementationCommandError,
  sendImplementationCommand,
  loadImplementationWorkspace,
} from "./service";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ supabase: { rpc } }));
const command = {
  commandId: "command",
  billingId: "billing",
  instanceId: "journey",
  revision: 4,
  action: "prepare" as const,
  payload: {},
};
beforeEach(() => rpc.mockReset());
describe("implementation transport boundaries", () => {
  it("sends the exact retained revision and identity on retry", async () => {
    rpc.mockResolvedValue({
      data: { commandId: "command", instanceId: "journey", revision: 5 },
      error: null,
    });
    await sendImplementationCommand(command);
    expect(rpc).toHaveBeenCalledWith("command_implementation", {
      p_command_id: "command",
      p_billing_id: "billing",
      p_instance_id: "journey",
      p_revision: 4,
      p_action: "prepare",
      p_payload: {},
      p_dry_run: false,
    });
  });
  it("marks a timeout unknown without claiming failure or replaying", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "", message: "timeout" },
    });
    await expect(sendImplementationCommand(command)).rejects.toMatchObject({
      outcome: "unknown",
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("classifies an authoritative SQL refusal as rolled back", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "named administrator required" },
    });
    await expect(sendImplementationCommand(command)).rejects.toEqual(
      new ImplementationCommandError("named administrator required", "refused"),
    );
  });
  it("refuses a mismatched acknowledgement", async () => {
    rpc.mockResolvedValue({
      data: { commandId: "other", instanceId: "journey", revision: 5 },
      error: null,
    });
    await expect(sendImplementationCommand(command)).rejects.toMatchObject({
      outcome: "unknown",
    });
  });
  it("requires an explicit no-write dry-run receipt", async () => {
    rpc.mockResolvedValue({
      data: { dryRun: true, writesPerformed: false },
      error: null,
    });
    await sendImplementationCommand(command, true);
    expect(rpc.mock.calls[0][1].p_dry_run).toBe(true);
    rpc.mockResolvedValue({
      data: { dryRun: true, writesPerformed: true },
      error: null,
    });
    await expect(
      sendImplementationCommand(command, true),
    ).rejects.toMatchObject({ outcome: "unknown" });
  });
  it("does not manufacture a workspace on an invalid server response", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(loadImplementationWorkspace()).rejects.toThrow(
      "invalid workspace",
    );
  });
});
