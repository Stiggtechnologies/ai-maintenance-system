export interface BayesianBinomialInput {
  priorAlpha: number;
  priorBeta: number;
  events: number;
  opportunities: number;
  credibleZ?: number;
}

export interface BayesianBinomialResult {
  posteriorAlpha: number;
  posteriorBeta: number;
  mean: number;
  standardDeviation: number;
  interval: { lower: number; upper: number; approximation: string };
  method: string;
}

function finiteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
}

export function runBayesianBinomial(
  input: BayesianBinomialInput,
): BayesianBinomialResult {
  finiteNonNegative(input.events, "events");
  finiteNonNegative(input.opportunities, "opportunities");
  if (
    !Number.isInteger(input.events) ||
    !Number.isInteger(input.opportunities)
  ) {
    throw new Error("events and opportunities must be whole counts");
  }
  if (input.events > input.opportunities) {
    throw new Error("events cannot exceed opportunities");
  }
  if (!Number.isFinite(input.priorAlpha) || input.priorAlpha <= 0) {
    throw new Error("priorAlpha must be greater than zero");
  }
  if (!Number.isFinite(input.priorBeta) || input.priorBeta <= 0) {
    throw new Error("priorBeta must be greater than zero");
  }
  const posteriorAlpha = input.priorAlpha + input.events;
  const posteriorBeta = input.priorBeta + input.opportunities - input.events;
  const total = posteriorAlpha + posteriorBeta;
  const mean = posteriorAlpha / total;
  const variance =
    (posteriorAlpha * posteriorBeta) / (total * total * (total + 1));
  const standardDeviation = Math.sqrt(variance);
  const z = input.credibleZ ?? 1.96;
  if (!Number.isFinite(z) || z <= 0) {
    throw new Error("credibleZ must be greater than zero");
  }
  return {
    posteriorAlpha,
    posteriorBeta,
    mean,
    standardDeviation,
    interval: {
      lower: Math.max(0, mean - z * standardDeviation),
      upper: Math.min(1, mean + z * standardDeviation),
      approximation:
        "Normal approximation to the Beta posterior; retain the supplied prior and sample as evidence.",
    },
    method: "Beta-binomial Bayesian update",
  };
}

export interface EventTreeBranch {
  key: string;
  probability: number;
  consequence?: number;
  branches?: EventTreeBranch[];
}

export interface EventTreeInput {
  initiatingProbability: number;
  branches: EventTreeBranch[];
}

export interface EventTreeLeaf {
  path: string[];
  conditionalProbability: number;
  initiatingProbability: number;
  consequence: number;
  expectedConsequence: number;
}

function validateProbability(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between zero and one`);
  }
}

function eventTreeLeaves(
  branches: EventTreeBranch[],
  path: string[],
  conditionalProbability: number,
  initiatingProbability: number,
): EventTreeLeaf[] {
  if (branches.length === 0)
    throw new Error("event-tree branches are required");
  const mass = branches.reduce((sum, branch) => sum + branch.probability, 0);
  if (Math.abs(mass - 1) > 1e-9) {
    throw new Error(
      `event-tree branch probabilities must sum to one; received ${mass}`,
    );
  }
  return branches.flatMap((branch) => {
    if (!branch.key.trim())
      throw new Error("event-tree branch keys are required");
    validateProbability(branch.probability, `probability for ${branch.key}`);
    const nextProbability = conditionalProbability * branch.probability;
    const nextPath = [...path, branch.key];
    if (branch.branches?.length) {
      return eventTreeLeaves(
        branch.branches,
        nextPath,
        nextProbability,
        initiatingProbability,
      );
    }
    finiteNonNegative(branch.consequence ?? 0, `consequence for ${branch.key}`);
    const consequence = branch.consequence ?? 0;
    return [
      {
        path: nextPath,
        conditionalProbability: nextProbability,
        initiatingProbability: initiatingProbability * nextProbability,
        consequence,
        expectedConsequence:
          initiatingProbability * nextProbability * consequence,
      },
    ];
  });
}

export function runEventTree(input: EventTreeInput): {
  leaves: EventTreeLeaf[];
  conditionalProbabilityMass: number;
  initiatingProbabilityMass: number;
  expectedConsequence: number;
  method: string;
} {
  validateProbability(input.initiatingProbability, "initiatingProbability");
  const leaves = eventTreeLeaves(
    input.branches,
    [],
    1,
    input.initiatingProbability,
  );
  return {
    leaves,
    conditionalProbabilityMass: leaves.reduce(
      (sum, leaf) => sum + leaf.conditionalProbability,
      0,
    ),
    initiatingProbabilityMass: leaves.reduce(
      (sum, leaf) => sum + leaf.initiatingProbability,
      0,
    ),
    expectedConsequence: leaves.reduce(
      (sum, leaf) => sum + leaf.expectedConsequence,
      0,
    ),
    method:
      "Deterministic event tree; branch probabilities are validated at every node.",
  };
}

export interface StressRiskInput {
  riskId: string;
  exposure: number;
  dependencyGroup?: string;
  correlation?: number;
}

function deduplicateStressRisks(risks: StressRiskInput[]): StressRiskInput[] {
  const unique = new Map<string, StressRiskInput>();
  for (const risk of risks) {
    if (!risk.riskId.trim()) throw new Error("stress risks require an ID");
    if (
      !Number.isFinite(risk.exposure) ||
      risk.exposure < 0 ||
      risk.exposure > 100
    ) {
      throw new Error("stress exposure must be between zero and 100");
    }
    if (
      risk.correlation !== undefined &&
      (!Number.isFinite(risk.correlation) ||
        risk.correlation < 0 ||
        risk.correlation > 1)
    ) {
      throw new Error("stress correlation must be between zero and one");
    }
    const current = unique.get(risk.riskId);
    if (!current || risk.exposure > current.exposure)
      unique.set(risk.riskId, risk);
  }
  return [...unique.values()];
}

function stressPosition(risks: StressRiskInput[]): {
  independentExposure: number;
  correlationUplift: number;
  combinedExposure: number;
} {
  const independentExposure =
    (1 -
      risks.reduce(
        (remaining, risk) => remaining * (1 - risk.exposure / 100),
        1,
      )) *
    100;
  let correlationUplift = 0;
  for (let left = 0; left < risks.length; left += 1) {
    for (let right = left + 1; right < risks.length; right += 1) {
      const a = risks[left];
      const b = risks[right];
      if (a.dependencyGroup && a.dependencyGroup === b.dependencyGroup) {
        const correlation = Math.max(
          a.correlation ?? 0.5,
          b.correlation ?? 0.5,
        );
        correlationUplift +=
          Math.min(a.exposure, b.exposure) * correlation * 0.1;
      }
    }
  }
  return {
    independentExposure,
    correlationUplift,
    combinedExposure: Math.min(100, independentExposure + correlationUplift),
  };
}

export function calculateStressExposure(
  risks: StressRiskInput[],
  capacityLimit: number,
  reverseStressThreshold = capacityLimit,
): {
  uniqueRiskCount: number;
  independentExposure: number;
  correlationUplift: number;
  combinedExposure: number;
  capacityLimit: number;
  capacityRatio: number | null;
  withinCapacity: boolean;
  reverseStressRiskIds: string[];
  methodology: string;
} {
  if (
    !Number.isFinite(capacityLimit) ||
    capacityLimit < 0 ||
    capacityLimit > 100
  ) {
    throw new Error("capacityLimit must be between zero and 100");
  }
  if (
    !Number.isFinite(reverseStressThreshold) ||
    reverseStressThreshold < 0 ||
    reverseStressThreshold > 100
  ) {
    throw new Error("reverseStressThreshold must be between zero and 100");
  }
  const unique = deduplicateStressRisks(risks);
  const position = stressPosition(unique);
  const ordered = [...unique].sort((a, b) => b.exposure - a.exposure);
  const reverseStressRiskIds: string[] = [];
  for (const risk of ordered) {
    reverseStressRiskIds.push(risk.riskId);
    const subset = unique.filter((candidate) =>
      reverseStressRiskIds.includes(candidate.riskId),
    );
    if (stressPosition(subset).combinedExposure >= reverseStressThreshold)
      break;
  }
  if (position.combinedExposure < reverseStressThreshold) {
    reverseStressRiskIds.length = 0;
  }
  return {
    uniqueRiskCount: unique.length,
    ...position,
    capacityLimit,
    capacityRatio:
      capacityLimit > 0 ? position.combinedExposure / capacityLimit : null,
    withinCapacity: position.combinedExposure <= capacityLimit,
    reverseStressRiskIds,
    methodology:
      "Risk IDs are deduplicated, independent exposure uses complement aggregation, and each shared dependency pair contributes one bounded correlation uplift.",
  };
}

export interface TreatmentPathNode {
  id: string;
  durationDays: number;
  dependencies: string[];
}

export function evaluateTreatmentCriticalPath(nodes: TreatmentPathNode[]): {
  durationDays: number;
  criticalPath: string[];
  sequence: Array<{
    id: string;
    earliestStart: number;
    earliestFinish: number;
  }>;
} {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  if (byId.size !== nodes.length)
    throw new Error("treatment action IDs must be unique");
  for (const node of nodes) {
    if (!node.id.trim()) throw new Error("treatment action IDs are required");
    finiteNonNegative(node.durationDays, `duration for ${node.id}`);
    for (const dependency of node.dependencies) {
      if (!byId.has(dependency)) {
        throw new Error(`unknown treatment dependency ${dependency}`);
      }
    }
  }
  const pending = new Set(nodes.map((node) => node.id));
  const finish = new Map<string, number>();
  const predecessor = new Map<string, string | null>();
  const sequence: Array<{
    id: string;
    earliestStart: number;
    earliestFinish: number;
  }> = [];
  while (pending.size) {
    const ready = [...pending].filter((id) =>
      (byId.get(id)?.dependencies ?? []).every((dependency) =>
        finish.has(dependency),
      ),
    );
    if (!ready.length)
      throw new Error("treatment dependencies contain a cycle");
    for (const id of ready) {
      const node = byId.get(id)!;
      const controllingDependency = [...node.dependencies].sort(
        (a, b) => (finish.get(b) ?? 0) - (finish.get(a) ?? 0),
      )[0];
      const earliestStart = controllingDependency
        ? (finish.get(controllingDependency) ?? 0)
        : 0;
      const earliestFinish = earliestStart + node.durationDays;
      finish.set(id, earliestFinish);
      predecessor.set(id, controllingDependency ?? null);
      sequence.push({ id, earliestStart, earliestFinish });
      pending.delete(id);
    }
  }
  const finalNode = [...finish.entries()].sort((a, b) => b[1] - a[1])[0];
  const criticalPath: string[] = [];
  let cursor: string | null = finalNode?.[0] ?? null;
  while (cursor) {
    criticalPath.unshift(cursor);
    cursor = predecessor.get(cursor) ?? null;
  }
  return {
    durationDays: finalNode?.[1] ?? 0,
    criticalPath,
    sequence,
  };
}

export interface RiskCultureMetrics {
  overdueActionRate: number;
  optimisticEstimateMissRate: number;
  controlOverrideRate: number;
  badNewsDelayRate: number;
}

export interface RiskCultureSignal {
  key: string;
  severity: "watch" | "material";
  observation: string;
  evidenceOnly: true;
}

export function analyzeRiskCulture(
  metrics: RiskCultureMetrics,
): RiskCultureSignal[] {
  const definitions: Array<{
    key: string;
    value: number;
    threshold: number;
    observation: string;
  }> = [
    {
      key: "overdue_actions",
      value: metrics.overdueActionRate,
      threshold: 0.2,
      observation: "A material share of governed risk actions is overdue.",
    },
    {
      key: "optimism_bias",
      value: metrics.optimisticEstimateMissRate,
      threshold: 0.2,
      observation:
        "Recorded estimates are repeatedly more optimistic than outcomes.",
    },
    {
      key: "control_override",
      value: metrics.controlOverrideRate,
      threshold: 0.1,
      observation:
        "Controls are being overridden often enough to require review.",
    },
    {
      key: "reporting_delay",
      value: metrics.badNewsDelayRate,
      threshold: 0.1,
      observation:
        "Adverse evidence is not consistently recorded in time for decisions.",
    },
  ];
  for (const definition of definitions) {
    if (
      !Number.isFinite(definition.value) ||
      definition.value < 0 ||
      definition.value > 1
    ) {
      throw new Error("risk-culture rates must be between zero and one");
    }
  }
  return definitions
    .filter((definition) => definition.value >= definition.threshold)
    .map((definition) => ({
      key: definition.key,
      severity:
        definition.value >= definition.threshold * 2 ? "material" : "watch",
      observation: definition.observation,
      evidenceOnly: true as const,
    }));
}
