import { createRef, type ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ASK_PLACEHOLDER, PublicAskBar } from "./PublicAskBar";

function props(
  overrides: Partial<ComponentProps<typeof PublicAskBar>> = {},
): ComponentProps<typeof PublicAskBar> {
  return {
    value: "",
    placeholder: ASK_PLACEHOLDER,
    textareaRef: createRef<HTMLTextAreaElement>(),
    onChange: vi.fn(),
    onSend: vi.fn(),
    sendDisabled: true,
    dictationSupported: false,
    dictationListening: false,
    dictationTitle: "This browser has no speech recognition",
    onToggleDictation: vi.fn(),
    photoInputRef: createRef<HTMLInputElement>(),
    fileInputRef: createRef<HTMLInputElement>(),
    ...overrides,
  };
}

describe("PublicAskBar", () => {
  it("shows only genuine, immediately usable public actions", () => {
    render(<PublicAskBar {...props()} />);
    expect(screen.getByPlaceholderText(ASK_PLACEHOLDER)).toBeTruthy();
    expect(screen.getByLabelText("Attach a photo")).toBeEnabled();
    expect(screen.getByLabelText("Attach a data file")).toBeEnabled();
    expect(screen.queryByLabelText("Search")).toBeNull();
    expect(screen.queryByLabelText("Web search")).toBeNull();
    expect(screen.queryByLabelText("Link")).toBeNull();
    expect(screen.queryByLabelText("Dictate a message")).toBeNull();
    const tools = document.querySelector(".bolt-ask-tools");
    expect(
      [...(tools?.querySelectorAll("button") ?? [])].map((item) =>
        item.getAttribute("aria-label"),
      ),
    ).toEqual(["Attach a photo", "Attach a data file"]);
    expect(tools?.contains(screen.getByTestId("bolt-ask-send"))).toBe(false);
    expect(screen.getByTitle("Send message")).toBeDisabled();
  });

  it("moves the same working actions into the narrow overflow", () => {
    render(<PublicAskBar {...props()} />);
    fireEvent.click(screen.getByTestId("bolt-ask-overflow"));
    const menu = document.querySelector(".bolt-ask-overflow-menu");
    expect(menu).toBeTruthy();
    expect(
      [...(menu?.querySelectorAll("button") ?? [])].map((item) => ({
        label: item.getAttribute("aria-label"),
        disabled: (item as HTMLButtonElement).disabled,
      })),
    ).toEqual([
      { label: "Attach a photo", disabled: false },
      { label: "Attach a data file", disabled: false },
    ]);
  });

  it("opens the real photo and data-file inputs", () => {
    const photo = document.createElement("input");
    const file = document.createElement("input");
    const photoClick = vi.spyOn(photo, "click");
    const fileClick = vi.spyOn(file, "click");
    render(
      <PublicAskBar
        {...props({
          photoInputRef: { current: photo },
          fileInputRef: { current: file },
        })}
      />,
    );
    fireEvent.click(screen.getByLabelText("Attach a photo"));
    fireEvent.click(screen.getByLabelText("Attach a data file"));
    expect(photoClick).toHaveBeenCalledOnce();
    expect(fileClick).toHaveBeenCalledOnce();
  });

  it("shows working browser dictation only when the browser supports it", () => {
    const onToggleDictation = vi.fn();
    render(
      <PublicAskBar
        {...props({ dictationSupported: true, onToggleDictation })}
      />,
    );
    fireEvent.click(screen.getByLabelText("Dictate a message"));
    expect(onToggleDictation).toHaveBeenCalledOnce();
  });
});
