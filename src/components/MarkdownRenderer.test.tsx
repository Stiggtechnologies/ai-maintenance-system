import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownRenderer } from "./MarkdownRenderer";

describe("MarkdownRenderer", () => {
  it("renders plain text content", () => {
    render(<MarkdownRenderer content="Hello world" />);
    expect(screen.getByText(/Hello world/)).toBeInTheDocument();
  });

  it("renders bold text", () => {
    const { container } = render(<MarkdownRenderer content="**bold text**" />);
    const strong = container.querySelector("strong");
    expect(strong).toBeInTheDocument();
    expect(strong?.textContent).toBe("bold text");
  });

  it("escapes HTML to prevent XSS", () => {
    const malicious = '<script>alert("xss")</script>';
    const { container } = render(<MarkdownRenderer content={malicious} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>");
  });

  it("renders list items", () => {
    const { container } = render(<MarkdownRenderer content="- item one" />);
    const li = container.querySelector("li");
    expect(li).toBeInTheDocument();
    expect(li?.textContent).toBe("item one");
    expect(li).toHaveClass("marker:text-slate-500");
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

    expect(
      screen.getByRole("heading", { name: "Decision", level: 2 }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(screen.getByText("False indication")).toBeInTheDocument();

    const tableRegion = screen.getByRole("region", { name: "Response table" });
    expect(tableRegion).toHaveClass("overflow-x-auto");
    expect(container.querySelector("table")).toHaveClass("min-w-full");
    expect(container.querySelector("th")).toHaveClass("min-w-40");
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
