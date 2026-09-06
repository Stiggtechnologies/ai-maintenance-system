import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PublicProductHeader } from "./PublicProductHeader";

const SRC = readFileSync("src/components/PublicProductHeader.tsx", "utf8");

describe("PublicProductHeader", () => {
  it("uses the comet wordmark and the job title, not a pulse icon", () => {
    render(<PublicProductHeader active="proof" />);
    expect(screen.getByRole("img", { name: "SyncAI" })).toHaveAttribute(
      "src",
      "/brand/wordmark-ink.png",
    );
    expect(screen.getByLabelText("SyncAI Reliability Engineer")).toBeTruthy();
    expect(screen.getByTestId("brand-job-title")).toHaveTextContent(
      "Reliability Engineer",
    );
    expect(SRC).toMatch(/flex-col/);
    expect(SRC).not.toMatch(/Activity/);
    expect(SRC).not.toMatch(/Zap/);
  });

  it("keeps Reliability Engineer as a job title, not a second nav logo", () => {
    render(<PublicProductHeader active="copilot" />);
    expect(screen.getAllByText("Reliability Engineer")).toHaveLength(1);
    expect(
      screen.queryByRole("link", { name: /^Reliability Engineer$/ }),
    ).toBeNull();
    expect(screen.queryByText("Chat")).toBeNull();
    expect(screen.queryByText("Work")).toBeNull();
  });

  it("never points the brand or product CTAs at a /demo URL", () => {
    render(<PublicProductHeader active="copilot" />);
    const links = screen.getAllByRole("link");
    for (const link of links) {
      expect(link.getAttribute("href") ?? "").not.toMatch(/\/demo/);
    }
    expect(SRC).not.toMatch(/\/demo/);
    expect(screen.getByLabelText("SyncAI Reliability Engineer")).toHaveAttribute(
      "href",
      "/workspace",
    );
  });

  it("hides Sign in when showSignIn is false", () => {
    render(<PublicProductHeader active="copilot" showSignIn={false} />);
    expect(screen.queryByLabelText("Sign in")).toBeNull();
  });

  it("shows Sign in by default", () => {
    render(<PublicProductHeader active="copilot" />);
    expect(screen.getByLabelText("Sign in")).toHaveAttribute("href", "/signin");
  });
});
