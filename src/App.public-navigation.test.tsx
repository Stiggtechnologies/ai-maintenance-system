import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";

vi.mock("./lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  },
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

it("the actual app follows client evaluation → signup → canonical signin and retains context after remount", async () => {
  window.history.replaceState(
    null,
    "",
    "/get-started?industry=mining&utm_source=partner",
  );
  const app = render(<App />);
  fireEvent.change(await screen.findByTestId("inverted-ask"), {
    target: {
      value:
        "Synthetic acceptance: review conveyor evidence before approving work",
    },
  });
  fireEvent.click(
    screen.getByRole("button", { name: /Coordinate field work/ }),
  );
  fireEvent.click(screen.getByTestId("inverted-continue"));
  fireEvent.click(screen.getByTestId("inverted-save-continue"));
  fireEvent.click(
    screen.getByRole("link", { name: "create an evaluation workspace" }),
  );
  expect(
    await screen.findByRole("heading", {
      name: "Create a private evaluation workspace",
    }),
  ).toBeInTheDocument();
  expect(new URLSearchParams(window.location.search).get("view")).toBe(
    "signup",
  );
  for (const name of ["Assistant", "First decision"]) {
    const link = screen.getByRole("link", { name });
    expect(link.getAttribute("href")).toContain("industry=mining");
    expect(link.getAttribute("href")).toContain("utm_source=partner");
  }
  const returnTo = new URLSearchParams(window.location.search).get("returnTo");
  fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
  await screen.findByRole("textbox", { name: /work email/i });
  expect(window.location.pathname).toBe("/signin");
  expect(new URLSearchParams(window.location.search).get("returnTo")).toBe(
    returnTo,
  );
  app.unmount();
  render(<App />);
  expect(
    await screen.findByRole("textbox", { name: /work email/i }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", {
      name: "Create a private evaluation workspace",
    }),
  ).not.toBeInTheDocument();
});
