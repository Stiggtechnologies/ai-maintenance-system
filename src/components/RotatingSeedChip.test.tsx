import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIRST_PAINT_QUESTIONS } from "../lib/first-paint-seeds";
import { RotatingSeedChip } from "./RotatingSeedChip";

function stubMatchMedia(reduced: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reduced : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

describe("RotatingSeedChip", () => {
  beforeEach(() => {
    stubMatchMedia(false);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is one chip and rotates copy in catalog order", () => {
    const onSelect = vi.fn();
    render(
      <RotatingSeedChip
        questions={FIRST_PAINT_QUESTIONS}
        intervalMs={6000}
        onSelect={onSelect}
      />,
    );

    const chips = screen.getAllByTestId("sample-seed-chip");
    expect(chips).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Try a sample" })).toBeNull();

    for (const [index, question] of FIRST_PAINT_QUESTIONS.entries()) {
      expect(screen.getByTestId("sample-seed-chip")).toHaveTextContent(question);
      expect(screen.getByTestId("sample-seed-chip")).toHaveAttribute(
        "data-seed-index",
        String(index),
      );
      if (index < FIRST_PAINT_QUESTIONS.length - 1) {
        act(() => {
          vi.advanceTimersByTime(6000);
        });
      }
    }

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.getByTestId("sample-seed-chip")).toHaveTextContent(
      FIRST_PAINT_QUESTIONS[0],
    );
  });

  it("pauses rotation on hover and focus", () => {
    render(
      <RotatingSeedChip
        questions={FIRST_PAINT_QUESTIONS}
        intervalMs={6000}
        onSelect={() => undefined}
      />,
    );
    const chip = screen.getByTestId("sample-seed-chip");
    fireEvent.mouseEnter(chip);
    act(() => {
      vi.advanceTimersByTime(18000);
    });
    expect(chip).toHaveTextContent(FIRST_PAINT_QUESTIONS[0]);

    fireEvent.mouseLeave(chip);
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(chip).toHaveTextContent(FIRST_PAINT_QUESTIONS[1]);

    fireEvent.focus(chip);
    act(() => {
      vi.advanceTimersByTime(18000);
    });
    expect(chip).toHaveTextContent(FIRST_PAINT_QUESTIONS[1]);
  });

  it("keeps question 1 static when reduced motion is preferred", () => {
    stubMatchMedia(true);
    render(
      <RotatingSeedChip
        questions={FIRST_PAINT_QUESTIONS}
        intervalMs={6000}
        onSelect={() => undefined}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(24000);
    });
    expect(screen.getByTestId("sample-seed-chip")).toHaveTextContent(
      FIRST_PAINT_QUESTIONS[0],
    );
    expect(screen.getByTestId("sample-seed-chip")).toHaveAttribute(
      "data-seed-index",
      "0",
    );
  });

  it("reports the visible question index on tap", () => {
    const onSelect = vi.fn();
    render(
      <RotatingSeedChip
        questions={FIRST_PAINT_QUESTIONS}
        intervalMs={6000}
        onSelect={onSelect}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(12000);
    });
    fireEvent.click(screen.getByTestId("sample-seed-chip"));
    expect(onSelect).toHaveBeenCalledWith(2);
  });
});
