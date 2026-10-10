import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import App from "./App";
import { createHonestEmptyDecisionCase } from "./lib/decision-case-honesty";
import { getPublicDecisionCaseStorageKey } from "./lib/decision-case";
import { PUBLIC_ASK_INTENTS } from "./lib/public-ask-intents";
const capabilityAuth = vi.hoisted(() => ({
  user: null as { id: string } | null,
}));
vi.mock("./components/AuthProvider", async () => {
  const actual = await vi.importActual<
    typeof import("./components/AuthProvider")
  >("./components/AuthProvider");
  return {
    ...actual,
    useOptionalAuth: () => ({
      user: capabilityAuth.user,
      profile: null,
      session: null,
      loading: false,
    }),
  };
});

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
  capabilityAuth.user = null;
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

it.each(PUBLIC_ASK_INTENTS)(
  "actual app retains the $id example when auth arrives later",
  async (intent) => {
    window.localStorage.setItem("syncai-public-theme", "light");
    window.history.replaceState(null, "", `/capabilities/${intent.id}`);
    const app = render(<App />);
    await screen.findByRole("region", { name: "Example workspace" });
    capabilityAuth.user = { id: "test-reviewer" };
    app.rerender(<App />);
    await waitFor(() =>
      expect(
        screen.getByText(`${intent.label} · ${intent.module}`),
      ).toBeInTheDocument(),
    );
    expect(
      document.querySelector(".public-journey.bolt-public"),
    ).toHaveAttribute("data-theme", "dark");
    expect(screen.queryByRole("button", { name: /Use .* mode/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "New ask" }));
    await screen.findByTestId("first-paint-empty");
    expect(window.location.pathname).toBe("/workspace");
    app.unmount();
    render(<App />);
    await screen.findByTestId("first-paint-empty");
    expect(
      screen.queryByRole("region", { name: "Example workspace" }),
    ).toBeNull();
  },
);

it.each(PUBLIC_ASK_INTENTS)(
  "actual app keeps $id usable with blocked browser storage",
  async (intent) => {
    const denied = () => {
      throw new DOMException("Storage blocked", "SecurityError");
    };
    const descriptor = Object.getOwnPropertyDescriptor(
      window,
      "sessionStorage",
    );
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: { getItem: denied, setItem: denied, clear: () => {} },
    });
    try {
      window.history.replaceState(null, "", `/capabilities/${intent.id}`);
      render(<App />);
      await screen.findByRole("region", { name: "Example workspace" });
      expect(
        document.querySelector(".public-journey.bolt-public"),
      ).toHaveAttribute("data-theme", "dark");
      expect(
        await screen.findByText(/Browser storage is unavailable/),
      ).toBeInTheDocument();
    } finally {
      if (descriptor)
        Object.defineProperty(window, "sessionStorage", descriptor);
    }
  },
);

it("actual capability navigation preserves a chosen customer conversation across refresh and Back/Forward", async () => {
  const customer = createHonestEmptyDecisionCase(
    "Reliability Engineer",
    "oil-gas",
  );
  customer.id = "draft-customer-navigation";
  customer.title = "Synthetic customer decision";
  customer.messages = [
    {
      id: "user-1",
      role: "user",
      author: "You",
      text: "Synthetic customer evidence question",
      createdAt: customer.updatedAt,
    },
  ];
  window.sessionStorage.setItem(
    getPublicDecisionCaseStorageKey("oil-gas"),
    JSON.stringify([customer]),
  );
  window.history.replaceState(null, "", "/capabilities/compare");
  const app = render(<App />);
  await screen.findByRole("region", { name: "Example workspace" });
  fireEvent.click(screen.getByRole("button", { name: "Conversations" }));
  fireEvent.click(
    screen.getByRole("button", { name: /Synthetic customer decision/ }),
  );
  await waitFor(() =>
    expect(window.location.pathname).toBe(
      "/workspace/cases/draft-customer-navigation",
    ),
  );
  expect(
    screen.queryByRole("region", { name: "Example workspace" }),
  ).toBeNull();
  expect(
    screen.getByText("Synthetic customer evidence question"),
  ).toBeInTheDocument();
  await act(async () => {
    window.history.back();
  });
  await waitFor(() =>
    expect(window.location.pathname).toBe("/capabilities/compare"),
  );
  await screen.findByRole("heading", { name: "Compare the next intervention" });
  await act(async () => {
    window.history.forward();
  });
  await waitFor(() =>
    expect(window.location.pathname).toBe(
      "/workspace/cases/draft-customer-navigation",
    ),
  );
  await screen.findByText("Synthetic customer evidence question");
  app.unmount();
  render(<App />);
  await screen.findByText("Synthetic customer evidence question");
  expect(
    screen.queryByRole("region", { name: "Example workspace" }),
  ).toBeNull();
});
