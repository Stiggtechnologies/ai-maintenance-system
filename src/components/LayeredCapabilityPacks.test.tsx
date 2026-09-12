import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LayeredCapabilityPacks } from "./LayeredCapabilityPacks";

const getWorkspace = vi.fn();
const resolveStack = vi.fn();
const authorLayer = vi.fn();
const decideOverride = vi.fn();
const adoptLayer = vi.fn();

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({ profile: { id: "executive-2", role: "executive" } }),
}));

vi.mock("../services/layeredCapabilityPacks", async () => {
  const actual = await vi.importActual<
    typeof import("../services/layeredCapabilityPacks")
  >("../services/layeredCapabilityPacks");
  return {
    ...actual,
    getCapabilityPackWorkspace: () => getWorkspace(),
    resolveCapabilityPackStack: (...args: unknown[]) => resolveStack(...args),
    authorCapabilityPackLayer: (...args: unknown[]) => authorLayer(...args),
    decideCapabilityPackOverride: (...args: unknown[]) => decideOverride(...args),
    adoptCapabilityPackLayer: (...args: unknown[]) => adoptLayer(...args),
  };
});

const workspace = {
  layers: [
    {
      id: "core-1",
      layer_kind: "universal_core",
      scope_key: "universal",
      title: "SyncAI governed core",
      configuration: {
        human_approval_required: true,
        review_cadence_days: 30,
      },
      evidence_basis: "Approved product governance and assurance contract.",
      override_diff: [],
      override_approval_id: null,
      approval_status: null,
      status: "adopted",
      version: 1,
      created_by: "author-1",
      adopted_by: "executive-2",
      adopted_at: "2026-09-12T00:00:00Z",
    },
    {
      id: "site-draft",
      layer_kind: "site",
      scope_key: "site:site-1",
      title: "North Plant local pack",
      configuration: { review_cadence_days: 21 },
      evidence_basis: "Local review evidence pending executive disposition.",
      override_diff: [
        { key: "review_cadence_days", inherited: 30, proposed: 21 },
      ],
      override_approval_id: "approval-1",
      approval_status: "required",
      status: "draft",
      version: 1,
      created_by: "author-1",
      adopted_by: null,
      adopted_at: null,
    },
  ],
  sites: [{ id: "site-1", name: "North Plant" }],
  assets: [
    {
      id: "asset-1",
      name: "Pump P-101",
      site_id: "site-1",
      asset_class: "pump",
    },
  ],
  organization_nodes: [
    {
      id: "bu-1",
      name: "Operations",
      org_level: "business_unit",
      jurisdiction: "Alberta",
    },
  ],
  controls: {
    precedence:
      "universal core → sector → jurisdiction → enterprise → business unit → site → asset",
    override:
      "Changing an inherited value requires exact-diff approval by a different authorized human.",
    execution:
      "Pack resolution is configuration guidance only and grants no operational authority.",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  getWorkspace.mockResolvedValue(workspace);
  resolveStack.mockResolvedValue({
    context: {
      industry_code: "mining",
      jurisdiction: "Alberta",
      organization_node_id: null,
      site_id: "site-1",
      asset_id: "asset-1",
    },
    stack: [
      {
        id: "core-1",
        layer: "universal_core",
        scope_key: "universal",
        title: "SyncAI governed core",
        version: 1,
        configuration: { human_approval_required: true },
        evidence_basis: "Approved product governance contract.",
        override_count: 0,
        adopted_at: "2026-09-12T00:00:00Z",
      },
    ],
    effective_configuration: { human_approval_required: true },
    value_sources: {
      human_approval_required: {
        layer_id: "core-1",
        layer: "universal_core",
        title: "SyncAI governed core",
        value: true,
      },
    },
    missing_layers: [
      "sector",
      "jurisdiction",
      "enterprise",
      "business_unit",
      "site",
      "asset",
    ],
    authority: "Configuration guidance only. No operational authority.",
  });
  authorLayer.mockResolvedValue({ layer_id: "sector-1", status: "draft" });
  decideOverride.mockResolvedValue({ status: "approved" });
  adoptLayer.mockResolvedValue({ status: "adopted" });
});

describe("LayeredCapabilityPacks", () => {
  it("shows the full precedence, exact override and non-execution controls", async () => {
    render(<LayeredCapabilityPacks />);
    expect(await screen.findByText("SyncAI governed core")).toBeInTheDocument();
    expect(screen.getByTestId("pack-stack-authority")).toHaveTextContent(
      /universal core → sector → jurisdiction → enterprise → business unit → site → asset/i,
    );
    expect(screen.getByTestId("pack-stack-authority")).toHaveTextContent(
      /different authorized human/i,
    );
    expect(screen.getByTestId("pack-stack-authority")).toHaveTextContent(
      /no operational authority/i,
    );
  });

  it("resolves effective values and names their source layer", async () => {
    render(<LayeredCapabilityPacks />);
    await screen.findByText("SyncAI governed core");
    fireEvent.change(screen.getByLabelText("Asset to resolve"), {
      target: { value: "asset-1" },
    });
    fireEvent.click(screen.getByText("Resolve stack"));
    expect(await screen.findByTestId("resolved-pack-stack")).toHaveTextContent(
      /human_approval_required/i,
    );
    expect(screen.getByTestId("resolved-pack-stack")).toHaveTextContent(
      /supplied by universal core/i,
    );
    expect(resolveStack).toHaveBeenCalledWith({ assetId: "asset-1" });
  });

  it("authors a scoped configuration without exposing raw JSON", async () => {
    render(<LayeredCapabilityPacks />);
    await screen.findByText("SyncAI governed core");
    fireEvent.change(screen.getByLabelText("Pack layer"), {
      target: { value: "sector" },
    });
    fireEvent.change(screen.getByLabelText("Layer title"), {
      target: { value: "Mining reliability pack" },
    });
    fireEvent.change(screen.getByLabelText("Industry code"), {
      target: { value: "mining" },
    });
    fireEvent.change(screen.getByLabelText("Configuration key 1"), {
      target: { value: "inspection_basis" },
    });
    fireEvent.change(screen.getByLabelText("Configuration value 1"), {
      target: { value: "operating_hours" },
    });
    fireEvent.change(screen.getByLabelText("Layer evidence basis"), {
      target: {
        value: "Reviewed mining maintenance standard and customer duty evidence.",
      },
    });
    fireEvent.click(screen.getByText("Save controlled draft"));
    await waitFor(() =>
      expect(authorLayer).toHaveBeenCalledWith(
        expect.objectContaining({
          layerKind: "sector",
          industryCode: "mining",
          configuration: { inspection_basis: "operating_hours" },
        }),
      ),
    );
  });

  it("shows the exact changed value and requires review before adoption", async () => {
    render(<LayeredCapabilityPacks />);
    await screen.findByText("North Plant local pack");
    expect(screen.getByText(/30 → 21/i)).toBeInTheDocument();
    expect(screen.queryByText("Adopt layer")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Review exact override"));
    fireEvent.change(screen.getByLabelText("Human review note"), {
      target: {
        value: "Independent executive review found the local change acceptable.",
      },
    });
    fireEvent.click(screen.getByText("Approve exact override"));
    await waitFor(() =>
      expect(decideOverride).toHaveBeenCalledWith(
        "site-draft",
        "approved",
        "Independent executive review found the local change acceptable.",
      ),
    );
  });
});
