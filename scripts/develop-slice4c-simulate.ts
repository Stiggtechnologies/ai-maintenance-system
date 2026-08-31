/**
 * Run the Slice 4C Monte Carlo kernel against a live case and print the
 * payload the recording door expects.
 *
 * WHY THIS EXISTS. The kernel is TypeScript (`src/lib/modelling/
 * integrated-risk.ts`) and the CI transcript is bash, so a smoke test that
 * hand-wrote a plausible result would prove the DOOR and prove nothing about
 * the simulation the product actually runs. This runs the real kernel over
 * the real `get_case_simulation_inputs` payload, so the transcript's P80 is
 * the product's P80.
 *
 * It deliberately does NOT import the browser service layer: that pulls in a
 * Supabase singleton configured from `import.meta.env`, which does not exist
 * here. Two `fetch` calls and the kernel are the whole dependency surface.
 *
 * Usage (scripts/ci-develop-slice4c-smoke.sh):
 *   npx tsx scripts/develop-slice4c-simulate.ts <apiUrl> <anonKey> <jwt> \
 *       <caseId> <iterations> [seed]
 *
 * It prints ONE line of JSON: the `p_result` object. It does not record
 * anything — the shell posts it, so the transcript shows the door's own
 * refusals against a genuine kernel result.
 */
import {
  simulateIntegratedRisk,
  type RiskImpact,
} from "../src/lib/modelling/integrated-risk";

const [apiUrl, anonKey, jwt, caseId, iterationsRaw, seedRaw] =
  process.argv.slice(2);

if (!apiUrl || !anonKey || !jwt || !caseId) {
  console.error(
    "usage: develop-slice4c-simulate.ts <apiUrl> <anonKey> <jwt> <caseId> [iterations] [seed]",
  );
  process.exit(2);
}

const iterations = Number(iterationsRaw ?? "2000");
// The seed is CHOSEN here and RECORDED by the door. Math.random is fine for
// choosing one — the seed is not itself a simulated quantity — and is never
// used inside the simulation, which draws every sample from mulberry32(seed).
const seed =
  seedRaw != null && seedRaw !== ""
    ? Number(seedRaw)
    : Math.floor(Math.random() * 4294967296) % 4294967296;

async function rpc(fn: string, args: unknown): Promise<unknown> {
  const res = await fetch(`${apiUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${fn} returned non-JSON: ${text.slice(0, 400)}`);
  }
}

interface Inputs {
  error?: string;
  activities: {
    id: string;
    key: string;
    label: string;
    duration: number | string;
    optimistic: number | string | null;
    pessimistic: number | string | null;
    predecessors: string[] | null;
  }[];
  risks:
    | {
        riskId: string;
        riskTitle: string;
        activityId: number;
        activityKey: string;
        probability: number | string;
        delayDaysOptimistic: number | string;
        delayDaysLikely: number | string;
        delayDaysPessimistic: number | string;
        costOptimistic: number | string | null;
        costLikely: number | string | null;
        costPessimistic: number | string | null;
      }[]
    | null;
  delayCostPerDay: number | string | null;
  costBase: number | string | null;
  currency: string | null;
  digest: { activityDigest: string; riskDigest: string; costDigest: string };
  logicSupport?: {
    supported: boolean;
    nonFinishToStartCount: number;
    laggedCount: number;
    unstatedLinkTypeCount: number;
    refusal: string | null;
    assumptionNote: string | null;
  };
  policy?: { maximumAttributedRisks?: number };
  gate: {
    permitted: boolean;
    failingClasses: string[];
    notDiagnosableClasses: string[];
    minimumScore: number;
    refusal: string | null;
  };
}

const num = (v: unknown): number | null =>
  v == null || v === "" ? null : Number(v);

async function main(): Promise<void> {
  const inputs = (await rpc("get_case_simulation_inputs", {
    p_case_id: caseId,
  })) as Inputs;
  if (inputs.error) {
    console.error(`get_case_simulation_inputs refused: ${inputs.error}`);
    process.exit(1);
  }

  const risks: RiskImpact[] = (inputs.risks ?? []).map((r) => ({
    riskId: r.riskId,
    riskTitle: r.riskTitle,
    activityId: String(r.activityId),
    probability: Number(r.probability),
    delayDaysOptimistic: Number(r.delayDaysOptimistic),
    delayDaysLikely: Number(r.delayDaysLikely),
    delayDaysPessimistic: Number(r.delayDaysPessimistic),
    costOptimistic: num(r.costOptimistic),
    costLikely: num(r.costLikely),
    costPessimistic: num(r.costPessimistic),
  }));

  const result = simulateIntegratedRisk({
    activities: (inputs.activities ?? []).map((a) => ({
      id: a.id,
      label: a.label,
      duration: Number(a.duration),
      optimistic: num(a.optimistic),
      pessimistic: num(a.pessimistic),
      predecessors: a.predecessors ?? [],
    })),
    risks,
    gate: inputs.gate,
    // The server's verdict on whether the case's logic is logic this kernel
    // models. Without it the transcript would prove the door and not the
    // refusal a user actually meets.
    logicSupport: inputs.logicSupport,
    maximumAttributedRisks: inputs.policy?.maximumAttributedRisks,
    iterations,
    seed,
    delayCostPerDay: num(inputs.delayCostPerDay),
    costBase: num(inputs.costBase),
    currency: inputs.currency,
  });

  if (!result.simulated) {
    // The kernel's own refusal, verbatim, so the transcript can assert on the
    // same sentence a user would see.
    // Printed on STDOUT as well so a shell transcript that captures the
    // command's output can assert on the refusal a user would see, rather
    // than only on the exit code.
    process.stdout.write(JSON.stringify({ refused: true, reason: result.reason }));
    console.error(`KERNEL REFUSED: ${result.reason}`);
    process.exit(3);
  }

  const payload = {
    seed: String(result.seed),
    iterations: String(result.iterations),
    sampleCount: String(result.sampleCount),
    kernelVersion: result.kernelVersion,
    activityDigest: inputs.digest.activityDigest,
    riskDigest: inputs.digest.riskDigest,
    deterministicHours: String(result.deterministicHours),
    p10Hours: String(result.p10Hours),
    p50Hours: String(result.p50Hours),
    p80Hours: String(result.p80Hours),
    p90Hours: String(result.p90Hours),
    probabilityOnPlan:
      result.probabilityOnPlan == null ? "" : String(result.probabilityOnPlan),
    currency: result.currency ?? "",
    costBase: result.costBase == null ? "" : String(result.costBase),
    costExposureP50:
      result.costExposureP50 == null ? "" : String(result.costExposureP50),
    costExposureP80:
      result.costExposureP80 == null ? "" : String(result.costExposureP80),
    delayCostPerDay:
      result.delayCostPerDay == null ? "" : String(result.delayCostPerDay),
    attribution: result.attribution,
    criticality: result.criticality,
  };
  process.stdout.write(JSON.stringify(payload));
}

void main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
