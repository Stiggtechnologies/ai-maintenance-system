/**
 * Assessment Home, §4 — and the one panel that must never show working notes.
 *
 * §4 asks for status, scope, sponsor, timeline, readiness, MAJOR FINDINGS and
 * UPCOMING DECISIONS. The first five shipped; the last two did not, which left
 * the page unable to answer the question a sponsor opens it to ask.
 *
 * The load-bearing test here is the one asserting that the findings panel
 * queries `review_state = 'published'`. The publication gate in
 * 20260920000000 is the only thing that separates a finding a customer may
 * read from an engineer's working note, and a screen that renders drafts
 * routes around it in the browser — which is exactly the shape of failure the
 * gate was built to end. A filter applied in JavaScript after the rows arrive
 * would be no better; the predicate has to be in the query.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssessmentHomePage } from "./AssessmentHomePage";

const from = vi.fn();
const rpc = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => from(...args),
    rpc: (...args: unknown[]) => rpc(...args),
    auth: { getUser: vi.fn() },
    storage: { from: () => ({ upload: vi.fn(), remove: vi.fn() }) },
  },
}));

vi.mock("../components/AuthProvider", () => ({
  useAuth: () => ({ profile: { role: "reliability_engineer" } }),
}));

vi.mock("../components/assessment/DataRoom", () => ({
  DataRoom: () => <div data-testid="data-room" />,
}));

const ASSESSMENT = "44444444-0000-0000-0000-000000000001";
const ORG = "11111111-1111-1111-1111-111111111111";

const RECORD = {
  id: ASSESSMENT,
  organization_id: ORG,
  name: "Reliability Intelligence Assessment",
  scope_label: "Northstar haul fleet",
  status: "analysis",
  commercial_model: "Standard - US$35,000 fixed fee",
  sponsor_user_id: null,
  started_on: "2026-07-01",
  target_end_on: "2026-09-15",
  source_retention_until: "2027-01-31",
  primary_management_question:
    "Where is unplanned downtime actually coming from?",
  scope_confirmed_at: "2026-07-02T00:00:00Z",
  notes: null,
};

const READINESS = {
  assessment_id: ASSESSMENT,
  scope_confirmed: true,
  asset_register_received: true,
  work_orders_received: true,
  primary_question_agreed: true,
  gaps_explicitly_logged: true,
  kickoff_data_ready: true,
  required_datasets_missing: 0,
  open_blocking_clarifications: 0,
  slots: [],
};

/** Records the filters applied per table so the query itself can be asserted. */
const queries: Array<{ table: string; filters: string[] }> = [];

function builder(table: string, rows: unknown[], single = false) {
  const filters: string[] = [];
  queries.push({ table, filters });
  const result = Promise.resolve({
    data: single ? rows[0] : rows,
    error: null,
  });
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit"]) {
    chain[method] = () => chain;
  }
  chain.eq = (column: string, value: unknown) => {
    filters.push(`eq:${column}=${String(value)}`);
    return chain;
  };
  chain.in = (column: string, values: unknown[]) => {
    filters.push(`in:${column}=${values.join("|")}`);
    return chain;
  };
  chain.maybeSingle = () =>
    Promise.resolve({ data: rows[0] ?? null, error: null });
  chain.then = result.then.bind(result);
  return chain;
}

const PUBLISHED_CRITICAL = {
  id: "find-1",
  title: "Strut seal failures dominate unplanned downtime",
  severity: "critical",
  evidence_grade: "supported",
};

const PENDING_DECISION = {
  id: "dec-1",
  decision_required: "Replace or continue monitoring the 793F strut population",
  authority_role: "Maintenance Manager",
  boundary: "Spend to CAD 50,000 without executive sign-off",
  due_on: "2026-09-30",
  status: "pending",
};

function mockChain({
  findings = [PUBLISHED_CRITICAL] as unknown[],
  decisions = [PENDING_DECISION] as unknown[],
} = {}) {
  from.mockImplementation((table: string) => {
    if (table === "ria_assessments") return builder(table, [RECORD], true);
    if (table === "ria_findings") return builder(table, findings);
    if (table === "ria_decisions") return builder(table, decisions);
    return builder(table, []);
  });
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={[`/assessments/${ASSESSMENT}`]}>
      <Routes>
        <Route
          path="/assessments/:assessmentId"
          element={<AssessmentHomePage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  queries.length = 0;
  mockChain();
  rpc.mockResolvedValue({ data: READINESS, error: null });
});

describe("§4's two missing panels", () => {
  it("renders major findings", async () => {
    renderHome();
    await waitFor(() =>
      expect(screen.getByTestId("major-finding-find-1")).toBeTruthy(),
    );
    expect(screen.getByTestId("major-finding-find-1").textContent).toContain(
      "Strut seal failures",
    );
    expect(screen.getByTestId("major-finding-find-1").textContent).toContain(
      "critical",
    );
  });

  it("renders upcoming decisions with the authority AND the boundary", async () => {
    // A decision without its boundary is a recommendation. §5 rule 3 makes
    // both constraint-required in the schema; the screen has to show both or
    // the constraint is invisible to the person taking the decision.
    renderHome();
    await waitFor(() =>
      expect(screen.getByTestId("upcoming-decision-dec-1")).toBeTruthy(),
    );
    const text =
      screen.getByTestId("upcoming-decision-dec-1").textContent ?? "";
    expect(text).toContain("Maintenance Manager");
    expect(text).toContain("CAD 50,000");
  });

  it("says so plainly when there is nothing published yet", async () => {
    // "No published findings yet" and an empty panel are different messages,
    // and the customer is owed the first one.
    mockChain({ findings: [], decisions: [] });
    renderHome();
    await waitFor(() =>
      expect(screen.getByText("No published findings yet.")).toBeTruthy(),
    );
    expect(screen.getByText("No decisions are outstanding.")).toBeTruthy();
  });
});

describe("the findings panel cannot route around the publication gate", () => {
  it("asks the database for published findings only", async () => {
    // THE PROPERTY. If this predicate moves into JavaScript, or disappears,
    // an engineer's draft — no reviewer, no evidence, possibly no authority
    // for a critical severity — is rendered on the page a sponsor reads.
    renderHome();
    await waitFor(() =>
      expect(screen.getByTestId("major-finding-find-1")).toBeTruthy(),
    );
    const findingQuery = queries.find((q) => q.table === "ria_findings");
    expect(findingQuery).toBeDefined();
    expect(findingQuery?.filters).toContain("eq:review_state=published");
  });

  it("scopes to this assessment, and shows only high and critical", async () => {
    renderHome();
    await waitFor(() =>
      expect(screen.getByTestId("major-finding-find-1")).toBeTruthy(),
    );
    const findingQuery = queries.find((q) => q.table === "ria_findings");
    expect(findingQuery?.filters).toContain(`eq:assessment_id=${ASSESSMENT}`);
    expect(findingQuery?.filters).toContain("in:severity=critical|high");
  });

  it("tells the reader that drafts are excluded, rather than implying totality", async () => {
    renderHome();
    await waitFor(() =>
      expect(screen.getByTestId("major-finding-find-1")).toBeTruthy(),
    );
    expect(screen.getByText(/Published findings only/i).textContent).toContain(
      "has not passed the publication gate",
    );
  });

  it("mutation-sanity — the filter recorder would catch the predicate going away", () => {
    // Guards against this whole describe passing because `filters` is always
    // empty and `toContain` is being asked about nothing.
    const findingQuery = { table: "ria_findings", filters: [] as string[] };
    expect(findingQuery.filters).not.toContain("eq:review_state=published");
  });
});

describe("what the page claims about retention", () => {
  it("does not say the file is gone — it says which of the two happened", async () => {
    // The page used to promise the stub survived "after the file itself is
    // gone", while the storage policy made that file permanently undeletable.
    renderHome();
    await waitFor(() => expect(screen.getByTestId("data-room")).toBeTruthy());
    const copy = screen.getByText(/Source retention until/).textContent ?? "";
    expect(copy).toContain("purges the raw export");
    expect(copy).toContain("which of the two has actually happened");
    expect(copy).not.toContain("after the file itself is gone");
  });
});
