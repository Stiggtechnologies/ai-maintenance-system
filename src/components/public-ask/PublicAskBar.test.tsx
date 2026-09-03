import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ASK_PLACEHOLDER, PublicAskBar } from "./PublicAskBar";

describe("PublicAskBar", () => {
  it("shows the Bolt cluster and disables controls that have no product yet", () => {
    render(
      <PublicAskBar
        value=""
        placeholder={ASK_PLACEHOLDER}
        textareaRef={createRef<HTMLTextAreaElement>()}
        onChange={vi.fn()}
        onSend={vi.fn()}
        sendDisabled
        caseExists={false}
        dictationSupported={false}
        dictationListening={false}
        dictationTitle="This browser has no speech recognition"
        onToggleDictation={vi.fn()}
        photoInputRef={createRef<HTMLInputElement>()}
      />,
    );
    expect(screen.getByPlaceholderText(ASK_PLACEHOLDER)).toBeTruthy();
    expect(screen.getByLabelText("Search")).toBeDisabled();
    expect(screen.getByLabelText("Attach a photo")).toBeDisabled();
    expect(screen.getByLabelText("Attach a file")).toBeDisabled();
    expect(screen.getByLabelText("Web search")).toBeDisabled();
    expect(screen.getByLabelText("Link")).toBeDisabled();
    expect(screen.getByLabelText("Dictate a message")).toBeDisabled();
    const tools = document.querySelector(".bolt-ask-tools");
    expect(
      [...(tools?.querySelectorAll("button") ?? [])].map((item) =>
        item.getAttribute("aria-label"),
      ),
    ).toEqual([
      "Search",
      "Attach a photo",
      "Attach a file",
      "Web search",
      "Link",
      "Dictate a message",
    ]);
    expect(tools?.contains(screen.getByTestId("bolt-ask-send"))).toBe(false);
    expect(screen.getByTitle("Send message")).toBeDisabled();
  });
});
