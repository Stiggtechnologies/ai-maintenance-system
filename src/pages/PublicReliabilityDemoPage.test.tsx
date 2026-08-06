import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PUBLIC_DEMO_STORAGE_KEY,
  recordPublicDemoRun,
} from "../lib/public-reliability-demo";
import { PublicReliabilityDemoPage } from "./PublicReliabilityDemoPage";

vi.mock("../services/publicReliabilityAgent", () => ({
  runPublicReliabilityAgent: vi.fn().mockResolvedValue({
    status: "fallback",
    error: "Live endpoint is intentionally mocked in the component test.",
  }),
}));

describe("PublicReliabilityDemoPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("puts the Reliability Engineer before signup", () => {
    const onSignup = vi.fn();
    const onSignIn = vi.fn();
    render(
      <PublicReliabilityDemoPage onSignup={onSignup} onSignIn={onSignIn} />,
    );

    expect(
      screen.getByRole("heading", {
        name: "Reliability Engineer",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /ask the reliability engineer/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send message/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/synthetic data/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
    expect(onSignIn).toHaveBeenCalledOnce();
    expect(onSignup).not.toHaveBeenCalled();
  });

  it("supports editable prompts and stopping generation without consuming usage", () => {
    render(<PublicReliabilityDemoPage onSignup={vi.fn()} onSignIn={vi.fn()} />);
    const composer = screen.getByRole("textbox", {
      name: /ask the reliability engineer/i,
    });
    fireEvent.change(composer, {
      target: { value: "Build a field evidence plan before the next repair." },
    });
    fireEvent.click(screen.getByRole("button", { name: /send message/i }));

    expect(
      screen.getAllByText("Build a field evidence plan before the next repair.")
        .length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/working through the reliability case/i),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    expect(screen.getByText(/generation stopped/i)).toBeInTheDocument();
    expect(window.localStorage.getItem(PUBLIC_DEMO_STORAGE_KEY)).toBeNull();
  });

  it("streams the governed analysis and records the completed public run", async () => {
    vi.useFakeTimers();
    render(<PublicReliabilityDemoPage onSignup={vi.fn()} onSignIn={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /send message/i }));
    for (let stage = 0; stage < 7; stage += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
    }

    expect(
      screen.getAllByText(/decision packet ready/i).length,
    ).toBeGreaterThan(0);
    expect(window.localStorage.getItem(PUBLIC_DEMO_STORAGE_KEY)).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /continue with your own data/i }),
    ).toBeInTheDocument();
  });

  it("restores the completed result and gates the next workflow", () => {
    recordPublicDemoRun(
      window.localStorage,
      "pump-seal",
      new Date("2026-08-06T00:00:00.000Z"),
    );
    const onSignup = vi.fn();

    render(
      <PublicReliabilityDemoPage onSignup={onSignup} onSignIn={vi.fn()} />,
    );

    expect(
      screen.getAllByText(/decision packet ready/i).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/not root cause yet/i)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /continue with your own data/i }),
    );
    expect(
      screen.getByRole("dialog", {
        name: /continue the engineering conversation/i,
      }),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /create secure workspace/i }),
    );
    expect(onSignup).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "evidence" }));
    expect(screen.getByText(/synthetic data summary/i)).toBeInTheDocument();
  });
});
