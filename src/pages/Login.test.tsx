import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Login } from "./Login";

vi.mock("../components/visual/OperationsLattice", () => ({
  OperationsLattice: () => null,
}));

describe("Login chrome", () => {
  it("uses teal primaries and an honest RIA link, not gold or a 48-hour offer", () => {
    render(<Login onSuccess={vi.fn()} onTabChange={vi.fn()} />);

    const submit = screen.getByRole("button", { name: "Access SyncAI" });
    expect(submit.className).toMatch(/\bbg-teal-400\b/);
    expect(submit.className).not.toMatch(/signal-gold/);

    const assessment = screen.getByRole("link", {
      name: /Reliability Intelligence Assessment/i,
    });
    expect(assessment).toHaveAttribute("href", "/setup");
    expect(assessment.getAttribute("href")).not.toMatch(/value-proof/);
    expect(screen.queryByText(/48-hour/i)).toBeNull();
    expect(screen.queryByText(/value proof/i)).toBeNull();
  });

  it("fails if Login source reintroduces gold or the retired offer", () => {
    const src = readFileSync("src/pages/Login.tsx", "utf8");
    expect(src).not.toMatch(/signal-gold/);
    expect(src).not.toMatch(/48-hour/);
    expect(src).not.toMatch(/value-proof-intake/);
    expect(src).toContain('href="/setup"');
  });
});
