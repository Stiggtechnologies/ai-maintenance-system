import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KnowledgeCitation } from "./KnowledgeCitation";
const state = vi.hoisted(() => ({
  auth: {
    user: { id: "viewer" },
    profile: { organization_id: "tenant-a", role: "viewer" },
  } as {
    user: { id: string } | null;
    profile: { organization_id: string; role: string };
  },
  rpc: vi.fn(),
}));
vi.mock("./AuthProvider", () => ({ useOptionalAuth: () => state.auth }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc: state.rpc } }));
const title = "KB document aaaaaaaaaaaaaaaa";
const source = {
  citationLabel: title,
  sourceId: "synthetic-inspection",
  title: "Synthetic inspection title",
  contentRevision: 4,
};
beforeEach(() => {
  state.auth = {
    user: { id: "viewer" },
    profile: { organization_id: "tenant-a", role: "viewer" },
  };
  state.rpc.mockReset();
});
describe("human citation source inspection", () => {
  it("resolves the generated label and renders the source as text", async () => {
    state.rpc.mockResolvedValue({ data: [source], error: null });
    render(<KnowledgeCitation title={title} pageRange="p.1" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Inspect cited source" }),
    );
    expect(
      await screen.findByText(/Source record: synthetic-inspection/),
    ).toBeVisible();
    expect(state.rpc).toHaveBeenCalledWith("resolve_kb_citation", {
      p_label: title,
    });
  });
  it("shows truthful unavailability when the server dependency is missing", async () => {
    state.rpc.mockResolvedValue({
      data: null,
      error: { message: "missing function" },
    });
    render(<KnowledgeCitation title={title} pageRange="p.1" />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "unavailable in this environment",
    );
  });
  it("refuses ambiguous mappings", async () => {
    state.rpc.mockResolvedValue({ data: [source, source], error: null });
    render(<KnowledgeCitation title={title} pageRange="p.1" />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByRole("alert")).toHaveTextContent("ambiguous");
  });
  it("hides resolved data immediately on identity changes and ignores a late response", async () => {
    let finish!: (value: unknown) => void;
    state.rpc.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const { rerender } = render(
      <KnowledgeCitation title={title} pageRange="p.1" />,
    );
    fireEvent.click(screen.getByRole("button"));
    state.auth = { ...state.auth, user: { id: "other-viewer" } };
    rerender(<KnowledgeCitation title={title} pageRange="p.1" />);
    await act(async () => {
      finish({ data: [source], error: null });
    });
    expect(screen.queryByText(/Source record:/)).toBeNull();
  });
  it("does not call a protected resolver for an anonymous viewer", () => {
    state.auth.user = null;
    render(<KnowledgeCitation title={title} pageRange="p.1" />);
    expect(screen.getByText(/Sign in to inspect/)).toBeVisible();
    expect(screen.queryByRole("button")).toBeNull();
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
