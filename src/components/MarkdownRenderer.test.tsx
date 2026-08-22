import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownRenderer } from "./MarkdownRenderer";

describe("MarkdownRenderer", () => {
  it("renders plain, bold and escaped HTML safely", () => {
    const malicious = '<script>alert("xss")</script> **bold text**';
    const { container } = render(<MarkdownRenderer content={malicious} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>");
    expect(container.querySelector("strong")?.textContent).toBe("bold text");
  });

  it("renders engineering headings and comparison tables semantically", () => {
    const content = [
      "## Decision",
      "",
      "Do **not** change the trip setpoint.",
      "",
      "| Status | Evidence |",
      "| --- | --- |",
      "| Fact | Seven trips |",
      "| Hypothesis | False indication |",
    ].join("\n");
    const { container } = render(<MarkdownRenderer content={content} />);
    expect(screen.getByRole("heading", { name: "Decision", level: 2 })).toBeInTheDocument();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Response table" })).toHaveClass("overflow-x-auto");
  });

  it("renders only real supplied source labels as provenance chips", () => {
    render(
      <MarkdownRenderer
        content="Asset Register Accuracy is 0% [L1], while [L99] is not a real source."
        evidence={[
          {
            id: "L1",
            sourceType: "kpi",
            sourceId: "L1",
            title: "Asset Register Accuracy",
            excerpt: "0% [breach]",
            applicationUrl: "/kpis",
          },
        ]}
      />,
    );
    const source = screen.getByText("L1");
    expect(source.closest("a")).toHaveAttribute("href", "/kpis");
    expect(source.closest("a")).toHaveAttribute(
      "title",
      "Asset Register Accuracy — 0% [breach]",
    );
    expect(screen.getByText(/\[L99\]/)).toBeInTheDocument();
  });

  it("renders safe markdown links and refuses unsafe schemes", () => {
    const { container } = render(
      <MarkdownRenderer content="[Docs](https://example.com) [bad](javascript:alert(1))" />,
    );
    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute(
      "href",
      "https://example.com/",
    );
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it("renders task lists and preserves basic nested indentation", () => {
    const { container } = render(
      <MarkdownRenderer content={"- [x] Verified\n  - [ ] Follow-up"} />,
    );
    expect(screen.getByRole("checkbox", { name: "Completed" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Not completed" })).not.toBeChecked();
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("gives long-form paragraphs a readable measure and line height", () => {
    const { container } = render(
      <MarkdownRenderer content="A decision-relevant engineering paragraph." />,
    );
    const paragraph = container.querySelector("p");
    expect(paragraph).toHaveClass("max-w-[78ch]");
    expect(paragraph).toHaveClass("leading-[1.72]");
  });
});
