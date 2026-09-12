import {
  getDomainSpecialistMethod,
  getDomainSpecialistModule,
} from "./catalog.ts";
import type {
  DomainMetric,
  DomainSpecialistRequest,
  DomainSpecialistResult,
} from "./types.ts";

interface Evaluation {
  summary: string;
  metrics: DomainMetric[];
  findings: string[];
  gaps: string[];
  assumptions: string[];
  formulae: string[];
}

class InputError extends Error {}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new InputError(`${label} must be a finite number.`);
  }
  return value;
}

function positive(value: unknown, label: string): number {
  const result = finite(value, label);
  if (result <= 0) throw new InputError(`${label} must be greater than zero.`);
  return result;
}

function nonNegative(value: unknown, label: string): number {
  const result = finite(value, label);
  if (result < 0) throw new InputError(`${label} must not be negative.`);
  return result;
}

function positiveInteger(value: unknown, label: string): number {
  const result = positive(value, label);
  if (!Number.isInteger(result))
    throw new InputError(`${label} must be a positive integer.`);
  return result;
}

function requireUnique(values: string[], label: string): void {
  const duplicate = values.find(
    (value, index) => values.indexOf(value) !== index,
  );
  if (duplicate)
    throw new InputError(`${label} contains duplicate ID ${duplicate}.`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new InputError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function records(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InputError(`${label} must contain at least one record.`);
  }
  if (
    value.some(
      (item) => !item || typeof item !== "object" || Array.isArray(item),
    )
  ) {
    throw new InputError(`${label} contains a non-record value.`);
  }
  return value as Record<string, unknown>[];
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InputError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function bool(value: unknown): boolean {
  return value === true;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isoDate(value: unknown, label: string): Date {
  const parsed = new Date(text(value, label));
  if (Number.isNaN(parsed.getTime())) {
    throw new InputError(`${label} must be a valid ISO date.`);
  }
  return parsed;
}

function round(value: number, digits = 3): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function completeness(
  rows: Record<string, unknown>[],
  pass: (row: Record<string, unknown>) => boolean,
): { complete: number; total: number; share: number } {
  const complete = rows.filter(pass).length;
  return { complete, total: rows.length, share: complete / rows.length };
}

function coverageEvaluation(
  label: string,
  rows: Record<string, unknown>[],
  pass: (row: Record<string, unknown>) => boolean,
  identify: (row: Record<string, unknown>, index: number) => string,
  failure: string,
): Evaluation {
  if (rows.length === 0)
    throw new InputError(`${label} scope must contain at least one record.`);
  const result = completeness(rows, pass);
  const gaps = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !pass(row))
    .map(({ row, index }) => `${identify(row, index)}: ${failure}`);
  return {
    summary: `${result.complete} of ${result.total} ${label} records satisfy the supplied trace contract. Human authority review remains mandatory.`,
    metrics: [
      {
        key: "complete",
        label: "Complete records",
        value: result.complete,
        unit: "count",
      },
      {
        key: "total",
        label: "In-scope records",
        value: result.total,
        unit: "count",
      },
      {
        key: "coverage",
        label: "Trace coverage",
        value: round(100 * result.share, 1),
        unit: "%",
      },
    ],
    findings: gaps.length
      ? [`${gaps.length} record(s) require resolution.`]
      : ["No trace-contract gap was found in the supplied records."],
    gaps,
    assumptions: [],
    formulae: [
      "Trace coverage = complete in-scope records / all in-scope records.",
    ],
  };
}

function tailings(inputs: Record<string, unknown>): Evaluation {
  const resisting = positive(inputs.resistingForce, "Resisting force");
  const driving = positive(inputs.drivingForce, "Driving force");
  const minimum = positive(
    inputs.minimumFactorOfSafety,
    "Minimum factor of safety",
  );
  const loadCase = text(inputs.loadCase, "Load case");
  const instruments = records(
    inputs.instruments,
    "Instrumentation observations",
  );
  const factor = resisting / driving;
  const exceptions: string[] = [];
  for (const [index, item] of instruments.entries()) {
    const id =
      typeof item.id === "string" ? item.id : `instrument ${index + 1}`;
    const value = finite(item.value, `${id} value`);
    const trigger = finite(item.trigger, `${id} trigger`);
    const direction = text(item.direction, `${id} trigger direction`);
    if (!item.observedAt)
      exceptions.push(`${id}: observation timestamp is missing.`);
    if (direction === "higher_worse" && value >= trigger)
      exceptions.push(
        `${id}: value ${value} meets or exceeds trigger ${trigger}.`,
      );
    else if (direction === "lower_worse" && value <= trigger)
      exceptions.push(
        `${id}: value ${value} meets or falls below trigger ${trigger}.`,
      );
    else if (!["higher_worse", "lower_worse"].includes(direction))
      exceptions.push(
        `${id}: trigger direction must be higher_worse or lower_worse.`,
      );
  }
  const margin = factor - minimum;
  return {
    summary: `The supplied ${loadCase} force result produces a factor of safety of ${round(factor)} against the supplied criterion ${minimum}. This is an arithmetic screen, not a geotechnical safety determination.`,
    metrics: [
      {
        key: "factor_of_safety",
        label: "Factor of safety",
        value: round(factor),
        unit: "ratio",
      },
      {
        key: "criterion_margin",
        label: "Margin to supplied criterion",
        value: round(margin),
        unit: "ratio",
      },
      {
        key: "instrument_exceptions",
        label: "Instrumentation exceptions",
        value: exceptions.length,
        unit: "count",
      },
    ],
    findings: [
      margin >= 0
        ? "The force ratio is not below the supplied criterion."
        : "The force ratio is below the supplied criterion and requires immediate authority review.",
    ],
    gaps: exceptions,
    assumptions: [
      "Resisting and driving forces come from the same qualified model, section, units, and load case.",
    ],
    formulae: [
      "Factor of safety = resisting force / driving force.",
      "Criterion margin = calculated factor of safety - approved minimum.",
    ],
  };
}

function wellIntegrity(inputs: Record<string, unknown>): Evaluation {
  const required = positive(
    inputs.requiredIndependentBarriers,
    "Required independent barriers",
  );
  if (!Number.isInteger(required))
    throw new InputError("Required independent barriers must be an integer.");
  const barriers = records(inputs.barriers, "Barrier elements");
  const pressure = records(
    inputs.pressureObservations,
    "Pressure observations",
  );
  const phaseGroups = new Map<string, Set<string>>();
  const gaps: string[] = [];
  barriers.forEach((barrier, index) => {
    const phase = text(barrier.phase, `Barrier ${index + 1} phase`);
    const id = text(barrier.id, `Barrier ${index + 1} ID`);
    const group = text(barrier.independenceGroup, `${id} independence group`);
    if (!bool(barrier.verified)) {
      gaps.push(`${phase}/${id}: barrier is not verified.`);
      return;
    }
    const groups = phaseGroups.get(phase) ?? new Set<string>();
    groups.add(group);
    phaseGroups.set(phase, groups);
  });
  for (const [phase, groups] of phaseGroups) {
    if (groups.size < required)
      gaps.push(
        `${phase}: ${groups.size} verified independent barrier group(s), ${required} required.`,
      );
  }
  let minimumMargin = Number.POSITIVE_INFINITY;
  pressure.forEach((item, index) => {
    const id = typeof item.id === "string" ? item.id : `pressure ${index + 1}`;
    const observed = finite(item.observed, `${id} observed pressure`);
    const limit = positive(item.limit, `${id} approved pressure limit`);
    const margin = limit - observed;
    minimumMargin = Math.min(minimumMargin, margin);
    if (margin < 0)
      gaps.push(
        `${id}: observed pressure exceeds the supplied limit by ${round(-margin)} ${String(item.unit ?? "")}.`,
      );
  });
  return {
    summary: `${phaseGroups.size} well phase(s), ${barriers.length} barrier elements, and ${pressure.length} pressure envelope(s) were checked against supplied requirements.`,
    metrics: [
      {
        key: "phases",
        label: "Phases assessed",
        value: phaseGroups.size,
        unit: "count",
      },
      {
        key: "barrier_gaps",
        label: "Barrier/envelope gaps",
        value: gaps.length,
        unit: "count",
      },
      {
        key: "minimum_pressure_margin",
        label: "Minimum pressure margin",
        value: Number.isFinite(minimumMargin) ? round(minimumMargin) : null,
        unit: String(pressure[0]?.unit ?? "supplied unit"),
      },
    ],
    findings: gaps.length
      ? [
          "At least one supplied barrier or operating-envelope condition requires technical-authority disposition.",
        ]
      : [
          "No exception was found against the supplied barrier count and pressure limits.",
        ],
    gaps,
    assumptions: [
      "Barrier independence groups and approved pressure limits were assigned by the well-integrity authority.",
    ],
    formulae: [
      "Pressure margin = approved maximum pressure - observed pressure.",
    ],
  };
}

function rbi(inputs: Record<string, unknown>): Evaluation {
  const circuits = records(inputs.circuits, "Corrosion circuits");
  const matrix = object(inputs.riskMatrix, "RBI risk matrix");
  const fraction = finite(inputs.inspectionFraction, "Inspection fraction");
  if (!(fraction > 0 && fraction <= 1))
    throw new InputError(
      "Inspection fraction must be greater than 0 and no greater than 1.",
    );
  const metrics: DomainMetric[] = [];
  const findings: string[] = [];
  const gaps: string[] = [];
  let minimumLife = Number.POSITIVE_INFINITY;
  for (const [index, circuit] of circuits.entries()) {
    const id =
      typeof circuit.id === "string" ? circuit.id : `circuit ${index + 1}`;
    const previous = positive(
      circuit.previousThickness,
      `${id} previous thickness`,
    );
    const current = positive(
      circuit.currentThickness,
      `${id} current thickness`,
    );
    const years = positive(circuit.elapsedYears, `${id} elapsed years`);
    const minimum = positive(
      circuit.minimumThickness,
      `${id} minimum thickness`,
    );
    const rate = (previous - current) / years;
    const life = rate > 0 ? (current - minimum) / rate : null;
    if (life != null) minimumLife = Math.min(minimumLife, life);
    const matrixKey = `${String(circuit.probabilityCategory)}:${String(circuit.consequenceCategory)}`;
    const rank = matrix[matrixKey];
    if (typeof rank !== "string" || !rank)
      gaps.push(`${id}: approved risk matrix has no ${matrixKey} cell.`);
    if (current <= minimum)
      gaps.push(
        `${id}: current thickness is at or below the supplied minimum thickness.`,
      );
    if (rate <= 0)
      findings.push(
        `${id}: no positive metal-loss rate can be calculated from the two supplied measurements; remaining life is not calculated.`,
      );
    else
      findings.push(
        `${id}: corrosion rate ${round(rate)} thickness-unit/year, remaining-life screen ${round(life!)} years, candidate interval ${round(life! * fraction)} years, matrix rank ${String(rank ?? "missing")}.`,
      );
    metrics.push({
      key: `${id}_corrosion_rate`,
      label: `${id} corrosion rate`,
      value: round(rate),
      unit: "thickness/year",
    });
  }
  metrics.unshift({
    key: "minimum_remaining_life",
    label: "Minimum calculated remaining life",
    value: Number.isFinite(minimumLife) ? round(minimumLife) : null,
    unit: "years",
  });
  return {
    summary: `${circuits.length} corrosion circuit(s) were trended. Remaining life is calculated only where measured metal loss is positive.`,
    metrics,
    findings,
    gaps,
    assumptions: [
      "Thickness readings are comparable, correctly located, and use the same units.",
      "PoF and CoF categories were supplied by an approved RBI method rather than derived here.",
    ],
    formulae: [
      "Corrosion rate = (previous thickness - current thickness) / elapsed years.",
      "Remaining life = (current thickness - supplied minimum thickness) / positive corrosion rate.",
      "Candidate interval = remaining life × approved inspection fraction.",
    ],
  };
}

function stormDispatch(inputs: Record<string, unknown>): Evaluation {
  const incidents = records(inputs.incidents, "Storm incidents");
  const crews = records(inputs.crews, "Available crews").map((crew, index) => ({
    id: text(crew.id, `Crew ${index + 1} ID`),
    status: text(crew.status, `Crew ${index + 1} status`),
    skills: strings(crew.skills),
    remaining: positive(
      crew.availableHours,
      `Crew ${index + 1} available hours`,
    ),
  }));
  const travel = object(inputs.travelMinutes, "Travel-time matrix");
  const weights = object(inputs.priorityWeights, "Priority weights");
  const severityWeight = nonNegative(weights.severity, "Severity weight");
  const customerWeight = nonNegative(weights.customers, "Customer weight");
  const travelWeight = nonNegative(weights.travel, "Travel weight");
  const ordered = incidents
    .map((incident, index) => ({
      incident,
      id: text(incident.id, `Incident ${index + 1} ID`),
      priority:
        nonNegative(incident.severity, `Incident ${index + 1} severity`) *
          severityWeight +
        nonNegative(
          incident.customersAffected,
          `Incident ${index + 1} customers`,
        ) *
          customerWeight,
      hours: positive(incident.workHours, `Incident ${index + 1} work hours`),
      skills: strings(incident.requiredSkills),
    }))
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const assignments: string[] = [];
  const gaps: string[] = [];
  for (const item of ordered) {
    const eligible = crews
      .filter(
        (crew) =>
          crew.status === "available" &&
          crew.remaining >= item.hours &&
          item.skills.every((skill) => crew.skills.includes(skill)),
      )
      .map((crew) => ({
        crew,
        minutes:
          typeof travel[`${crew.id}:${item.id}`] === "number"
            ? nonNegative(travel[`${crew.id}:${item.id}`], "Travel time")
            : null,
      }))
      .filter(
        (
          candidate,
        ): candidate is { crew: (typeof crews)[number]; minutes: number } =>
          candidate.minutes != null,
      )
      .sort(
        (a, b) =>
          a.minutes * travelWeight - b.minutes * travelWeight ||
          a.crew.id.localeCompare(b.crew.id),
      );
    if (!eligible.length) {
      gaps.push(
        `${item.id}: no available crew satisfies skills, capacity, and travel-data constraints.`,
      );
      continue;
    }
    eligible[0].crew.remaining -= item.hours;
    assignments.push(
      `${item.id} → ${eligible[0].crew.id} (${eligible[0].minutes} min travel; priority score ${round(item.priority)})`,
    );
  }
  return {
    summary: `${assignments.length} of ${ordered.length} incident(s) received a constraint-feasible draft assignment.`,
    metrics: [
      {
        key: "assigned",
        label: "Draft assignments",
        value: assignments.length,
        unit: "count",
      },
      {
        key: "unassigned",
        label: "Unassigned incidents",
        value: gaps.length,
        unit: "count",
      },
    ],
    findings: assignments,
    gaps,
    assumptions: [
      "Incident severity, customer impact, skills, crew status, work duration, and travel matrix are current.",
      "Dispatch will re-check switching, hazards, fatigue, location, and mutual-aid constraints.",
    ],
    formulae: [
      "Priority score = severity × approved severity weight + customers affected × approved customer weight.",
      "Within each priority-ordered incident, choose the eligible crew with minimum supplied travel time × approved travel weight.",
    ],
  };
}

function lineBalancing(inputs: Record<string, unknown>): Evaluation {
  const available = positive(
    inputs.availableMinutes,
    "Available production time",
  );
  const requiredUnits = positive(inputs.requiredUnits, "Required units");
  const taskRows = records(inputs.tasks, "Work elements");
  const tasks = taskRows.map((row, index) => ({
    id: text(row.id, `Task ${index + 1} ID`),
    minutes: positive(row.minutes, `Task ${index + 1} minutes`),
    predecessors: strings(row.predecessors),
  }));
  requireUnique(
    tasks.map((task) => task.id),
    "Work elements",
  );
  const ids = new Set(tasks.map((task) => task.id));
  const unknown = tasks.flatMap((task) =>
    task.predecessors
      .filter((id) => !ids.has(id))
      .map((id) => `${task.id}: unknown predecessor ${id}.`),
  );
  if (unknown.length) throw new InputError(unknown.join(" "));
  const takt = available / requiredUnits;
  if (tasks.some((task) => task.minutes > takt)) {
    return {
      summary:
        "At least one indivisible work element exceeds takt; a feasible station balance cannot be produced without approved task redesign or parallelization.",
      metrics: [
        {
          key: "takt",
          label: "Takt time",
          value: round(takt),
          unit: "min/unit",
        },
      ],
      findings: [],
      gaps: tasks
        .filter((task) => task.minutes > takt)
        .map(
          (task) =>
            `${task.id}: ${task.minutes} min exceeds ${round(takt)} min takt.`,
        ),
      assumptions: [],
      formulae: ["Takt = available production minutes / required good units."],
    };
  }
  const remaining = new Map(tasks.map((task) => [task.id, task]));
  const assigned = new Set<string>();
  const stations: Array<{ tasks: string[]; load: number }> = [];
  while (remaining.size) {
    const station = { tasks: [] as string[], load: 0 };
    let progressed = true;
    while (progressed) {
      progressed = false;
      const eligible = [...remaining.values()]
        .filter((task) =>
          task.predecessors.every(
            (id) => assigned.has(id) || station.tasks.includes(id),
          ),
        )
        .filter((task) => station.load + task.minutes <= takt + 1e-9)
        .sort((a, b) => b.minutes - a.minutes || a.id.localeCompare(b.id));
      if (eligible.length) {
        const task = eligible[0];
        station.tasks.push(task.id);
        station.load += task.minutes;
        remaining.delete(task.id);
        progressed = true;
      }
    }
    if (!station.tasks.length)
      throw new InputError(
        "Task precedence contains a cycle or no eligible task fits the station.",
      );
    station.tasks.forEach((id) => assigned.add(id));
    stations.push(station);
  }
  const content = tasks.reduce((sum, task) => sum + task.minutes, 0);
  const theoretical = Math.ceil(content / takt);
  const efficiency = content / (stations.length * takt);
  const bottleneck = [...stations].sort((a, b) => b.load - a.load)[0];
  return {
    summary: `${tasks.length} work element(s) were allocated to ${stations.length} draft station(s) against ${round(takt)} minutes takt.`,
    metrics: [
      { key: "takt", label: "Takt time", value: round(takt), unit: "min/unit" },
      {
        key: "theoretical_stations",
        label: "Theoretical minimum stations",
        value: theoretical,
        unit: "count",
      },
      {
        key: "draft_stations",
        label: "Draft stations",
        value: stations.length,
        unit: "count",
      },
      {
        key: "balance_efficiency",
        label: "Balance efficiency",
        value: round(100 * efficiency, 1),
        unit: "%",
      },
      {
        key: "bottleneck_load",
        label: "Highest station load",
        value: round(bottleneck.load),
        unit: "min/unit",
      },
    ],
    findings: stations.map(
      (station, index) =>
        `Station ${index + 1}: ${station.tasks.join(" → ")} (${round(station.load)} min).`,
    ),
    gaps: [],
    assumptions: [
      "Task times are deterministic, comparable, and exclude only losses already removed from available production time.",
      "The predecessor graph and indivisibility of work elements are approved.",
    ],
    formulae: [
      "Takt = available production minutes / required good units.",
      "Theoretical minimum stations = ceil(total work content / takt).",
      "Balance efficiency = total work content / (draft stations × takt).",
    ],
  };
}

function robotHealth(inputs: Record<string, unknown>): Evaluation {
  const signalRows = records(inputs.signals, "Robot condition signals");
  let weighted = 0;
  let totalWeight = 0;
  const findings: string[] = [];
  for (const [index, signal] of signalRows.entries()) {
    const id =
      typeof signal.id === "string" ? signal.id : `signal ${index + 1}`;
    const observed = finite(signal.observed, `${id} observed value`);
    const healthy = finite(signal.healthy, `${id} healthy bound`);
    const critical = finite(signal.critical, `${id} critical bound`);
    const weight = positive(signal.weight, `${id} weight`);
    const direction = text(signal.direction, `${id} direction`);
    if (healthy === critical)
      throw new InputError(`${id} healthy and critical bounds must differ.`);
    let degradation: number;
    if (direction === "higher_worse")
      degradation = (observed - healthy) / (critical - healthy);
    else if (direction === "lower_worse")
      degradation = (healthy - observed) / (healthy - critical);
    else
      throw new InputError(
        `${id} direction must be higher_worse or lower_worse.`,
      );
    degradation = Math.max(0, Math.min(1, degradation));
    weighted += degradation * weight;
    totalWeight += weight;
    findings.push(
      `${id}: ${round(100 * degradation, 1)}% of supplied healthy-to-critical span.`,
    );
  }
  const degradation = weighted / totalWeight;
  return {
    summary: `The approved weighted signal model produces ${round(100 * degradation, 1)}% normalized degradation and ${round(100 * (1 - degradation), 1)}% health.`,
    metrics: [
      {
        key: "normalized_degradation",
        label: "Normalized degradation",
        value: round(100 * degradation, 1),
        unit: "%",
      },
      {
        key: "health",
        label: "Approved-model health",
        value: round(100 * (1 - degradation), 1),
        unit: "%",
      },
    ],
    findings,
    gaps: [],
    assumptions: [
      "Bounds, direction, and weights come from an approved robot/OEM-specific model and observations are operating-state comparable.",
    ],
    formulae: [
      "Signal degradation = clamped position between supplied healthy and critical bounds.",
      "Model degradation = Σ(signal degradation × approved weight) / Σ(approved weight).",
    ],
  };
}

function haccp(inputs: Record<string, unknown>): Evaluation {
  const rows = records(inputs.criticalControlPoints, "CCP observations");
  const gaps: string[] = [];
  let excursions = 0;
  rows.forEach((row, index) => {
    const id = typeof row.id === "string" ? row.id : `CCP ${index + 1}`;
    const value = finite(row.value, `${id} value`);
    const lower =
      typeof row.lowerLimit === "number"
        ? finite(row.lowerLimit, `${id} lower limit`)
        : null;
    const upper =
      typeof row.upperLimit === "number"
        ? finite(row.upperLimit, `${id} upper limit`)
        : null;
    if (lower == null && upper == null)
      gaps.push(`${id}: no approved critical limit supplied.`);
    const excursion =
      (lower != null && value < lower) || (upper != null && value > upper);
    if (excursion) {
      excursions += 1;
      if (
        typeof row.dispositionReference !== "string" ||
        !row.dispositionReference.trim()
      )
        gaps.push(
          `${id}: critical-limit excursion has no corrective-action/disposition reference.`,
        );
    }
  });
  return {
    summary: `${rows.length} CCP observation(s) were checked; ${excursions} supplied critical-limit excursion(s) were found.`,
    metrics: [
      {
        key: "ccp_observations",
        label: "CCP observations",
        value: rows.length,
        unit: "count",
      },
      {
        key: "excursions",
        label: "Critical-limit excursions",
        value: excursions,
        unit: "count",
      },
      {
        key: "unresolved",
        label: "Verification gaps",
        value: gaps.length,
        unit: "count",
      },
    ],
    findings: excursions
      ? [
          "Product/process disposition must follow the approved HACCP corrective-action procedure.",
        ]
      : ["No supplied observation falls outside its supplied critical limits."],
    gaps,
    assumptions: [
      "CCP identity and critical limits come from the current approved hazard plan.",
    ],
    formulae: [
      "An excursion exists when observed value is below a supplied lower limit or above a supplied upper limit.",
    ],
  };
}

function cip(inputs: Record<string, unknown>): Evaluation {
  const phases = records(inputs.phases, "CIP phases");
  const gaps: string[] = [];
  phases.forEach((phase, index) => {
    const id = typeof phase.id === "string" ? phase.id : `phase ${index + 1}`;
    const comparisons: Array<[string, unknown, unknown]> = [
      ["duration", phase.actualDuration, phase.minimumDuration],
      ["temperature", phase.actualTemperature, phase.minimumTemperature],
      ["concentration", phase.actualConcentration, phase.minimumConcentration],
      ["flow", phase.actualFlow, phase.minimumFlow],
    ];
    comparisons.forEach(([label, actualValue, minimumValue]) => {
      const actual = finite(actualValue, `${id} actual ${label}`);
      const minimum = finite(minimumValue, `${id} minimum ${label}`);
      if (actual < minimum)
        gaps.push(
          `${id}: actual ${label} ${actual} is below supplied minimum ${minimum}.`,
        );
    });
    if (
      finite(phase.sequence, `${id} sequence`) !==
      finite(phase.expectedSequence, `${id} expected sequence`)
    )
      gaps.push(`${id}: phase sequence does not match the approved recipe.`);
    if (!bool(phase.sensorsCalibrated))
      gaps.push(`${id}: measurement-chain calibration is not confirmed.`);
  });
  return {
    summary: `${phases.length} CIP phase(s) were checked against supplied recipe minima and sequence.`,
    metrics: [
      {
        key: "phases",
        label: "Phases checked",
        value: phases.length,
        unit: "count",
      },
      {
        key: "exceptions",
        label: "Cycle exceptions",
        value: gaps.length,
        unit: "count",
      },
    ],
    findings: gaps.length
      ? [
          "The supplied cycle does not satisfy every supplied validated-envelope check.",
        ]
      : [
          "Every supplied cycle parameter meets the supplied recipe minima and sequence.",
        ],
    gaps,
    assumptions: [
      "Required recipe parameters and sensor calibration status are current and product/equipment specific.",
    ],
    formulae: [
      "Each required phase passes only when actual duration, temperature, concentration, and flow meet supplied minima and sequence matches.",
    ],
  };
}

function coldChain(inputs: Record<string, unknown>): Evaluation {
  const segments = records(inputs.segments, "Time-temperature segments");
  const allowable = positive(
    inputs.allowableExcursionDose,
    "Allowable excursion dose",
  );
  const byLot = new Map<string, number>();
  segments.forEach((segment, index) => {
    const lot = text(segment.lot, `Segment ${index + 1} lot`);
    const temperature = finite(segment.temperature, `${lot} temperature`);
    const limit = finite(segment.limit, `${lot} limit`);
    const duration = positive(segment.durationMinutes, `${lot} duration`);
    byLot.set(
      lot,
      (byLot.get(lot) ?? 0) + Math.max(0, temperature - limit) * duration,
    );
  });
  const gaps = [...byLot]
    .filter(([, dose]) => dose > allowable)
    .map(
      ([lot, dose]) =>
        `${lot}: excursion dose ${round(dose)} exceeds supplied allowable dose ${allowable} °C·min.`,
    );
  return {
    summary: `${segments.length} time-temperature segment(s) across ${byLot.size} lot(s) were integrated against the supplied screening dose.`,
    metrics: [...byLot].map(([lot, dose]) => ({
      key: `dose_${lot}`,
      label: `${lot} excursion dose`,
      value: round(dose),
      unit: "°C·min",
    })),
    findings: gaps.length
      ? [
          "One or more lots require quality disposition using the approved product-specific model.",
        ]
      : ["No calculated screening dose exceeds the supplied allowable dose."],
    gaps,
    assumptions: [
      "Segments cover the complete excursion with calibrated sensors and lot linkage.",
      "The supplied allowable dose is product/packaging specific and approved; this linear screen is applicable.",
    ],
    formulae: [
      "Excursion dose per segment = max(0, observed temperature - supplied product limit) × duration minutes.",
      "Lot dose = sum of its segment doses.",
    ],
  };
}

function gxp(inputs: Record<string, unknown>): Evaluation {
  const rows = records(inputs.requirements, "Validation requirements").filter(
    (row) => row.inScope !== false,
  );
  return coverageEvaluation(
    "in-scope validation requirement",
    rows,
    (row) =>
      typeof row.testReference === "string" &&
      row.testReference.trim() !== "" &&
      (row.result === "passed" || row.deviationStatus === "approved") &&
      row.approved === true &&
      (row.changeControlState === "closed" ||
        row.changeControlState === "not_applicable"),
    (row, index) => String(row.id ?? `requirement ${index + 1}`),
    "missing approved test/result-or-deviation trace, approval, or closed change-control state",
  );
}

function batchRecord(inputs: Record<string, unknown>): Evaluation {
  const rows = records(inputs.recordItems, "Batch record items").filter(
    (row) => row.required !== false,
  );
  return coverageEvaluation(
    "required batch-record",
    rows,
    (row) =>
      row.present === true &&
      row.signed === true &&
      row.resultStatus === "accepted" &&
      row.genealogyComplete === true &&
      (row.deviationStatus == null || row.deviationStatus === "approved"),
    (row, index) => String(row.id ?? `item ${index + 1}`),
    "missing record/signature/genealogy, unaccepted result, or unresolved deviation",
  );
}

function* permutations<T>(items: T[]): Generator<T[]> {
  if (items.length <= 1) {
    yield items;
    return;
  }
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) yield [item, ...tail];
  }
}

function routeOptimization(inputs: Record<string, unknown>): Evaluation {
  const stopRows = records(inputs.stops, "Stops");
  if (stopRows.length > 8)
    throw new InputError("Exact route optimization is limited to 8 stops.");
  const stops = stopRows.map((row, index) => ({
    id: text(row.id, `Stop ${index + 1} ID`),
    demand: nonNegative(row.demand, `Stop ${index + 1} demand`),
    service: nonNegative(
      row.serviceMinutes ?? 0,
      `Stop ${index + 1} service minutes`,
    ),
    windowStart:
      typeof row.windowStartMinutes === "number"
        ? nonNegative(row.windowStartMinutes, "Window start")
        : null,
    windowEnd:
      typeof row.windowEndMinutes === "number"
        ? nonNegative(row.windowEndMinutes, "Window end")
        : null,
  }));
  requireUnique(
    stops.map((stop) => stop.id),
    "Stops",
  );
  for (const stop of stops) {
    if (
      stop.windowStart != null &&
      stop.windowEnd != null &&
      stop.windowEnd < stop.windowStart
    )
      throw new InputError(
        `${stop.id} window end must be no earlier than window start.`,
      );
  }
  const depots = records(inputs.depots, "Depots");
  if (depots.length > 10)
    throw new InputError("Exact route optimization is limited to 10 depots.");
  const depotIds = depots.map((depot, index) =>
    text(depot.id, `Depot ${index + 1} ID`),
  );
  requireUnique(depotIds, "Depots");
  const overlap = depotIds.find((id) => stops.some((stop) => stop.id === id));
  if (overlap)
    throw new InputError(
      `Depot and stop IDs must be distinct; found ${overlap}.`,
    );
  const costs = object(inputs.travelCosts, "Travel cost matrix");
  const minutes = object(inputs.travelMinutes, "Travel-time matrix");
  let best: {
    depot: string;
    route: string[];
    cost: number;
    elapsed: number;
  } | null = null;
  const totalDemand = stops.reduce((sum, stop) => sum + stop.demand, 0);
  const missingArcs = new Set<string>();
  for (const [index, depot] of depots.entries()) {
    const depotId = depotIds[index];
    const capacity = positive(depot.capacity, `${depotId} capacity`);
    const available = positive(
      depot.availableMinutes,
      `${depotId} available minutes`,
    );
    if (totalDemand > capacity) continue;
    for (const route of permutations(stops)) {
      let current = depotId;
      let travelCost = 0;
      let elapsed = 0;
      let feasible = true;
      for (const stop of route) {
        const key = `${current}:${stop.id}`;
        if (
          typeof costs[key] !== "number" ||
          typeof minutes[key] !== "number"
        ) {
          missingArcs.add(key);
          feasible = false;
          break;
        }
        const legCost = nonNegative(costs[key], `${key} travel cost`);
        const legMinutes = nonNegative(minutes[key], `${key} travel minutes`);
        travelCost += legCost;
        elapsed += legMinutes;
        if (stop.windowStart != null && elapsed < stop.windowStart)
          elapsed = stop.windowStart;
        if (stop.windowEnd != null && elapsed > stop.windowEnd) {
          feasible = false;
          break;
        }
        elapsed += stop.service;
        current = stop.id;
      }
      const returnKey = `${current}:${depotId}`;
      if (
        !feasible ||
        typeof costs[returnKey] !== "number" ||
        typeof minutes[returnKey] !== "number"
      ) {
        if (
          typeof costs[returnKey] !== "number" ||
          typeof minutes[returnKey] !== "number"
        )
          missingArcs.add(returnKey);
        continue;
      }
      const returnCost = nonNegative(
        costs[returnKey],
        `${returnKey} travel cost`,
      );
      const returnMinutes = nonNegative(
        minutes[returnKey],
        `${returnKey} travel minutes`,
      );
      travelCost += returnCost;
      elapsed += returnMinutes;
      if (elapsed > available) continue;
      const candidate = {
        depot: depotId,
        route: route.map((stop) => stop.id),
        cost: travelCost,
        elapsed,
      };
      const tie = `${candidate.depot}:${candidate.route.join(",")}`;
      const bestTie = best ? `${best.depot}:${best.route.join(",")}` : "";
      if (
        !best ||
        candidate.cost < best.cost ||
        (candidate.cost === best.cost && tie < bestTie)
      )
        best = candidate;
    }
  }
  const gaps = [...missingArcs].map(
    (arc) => `Travel cost or elapsed minutes missing for ${arc}.`,
  );
  if (!best)
    gaps.unshift(
      "No depot/route combination satisfies capacity, route-time, time-window, and supplied travel-cost constraints.",
    );
  return {
    summary: best
      ? `Exact bounded search selected depot ${best.depot} and route ${best.route.join(" → ")} with supplied travel cost ${round(best.cost)}.`
      : "No feasible exact route was found from the supplied bounded problem.",
    metrics: [
      {
        key: "travel_cost",
        label: "Selected travel cost",
        value: best ? round(best.cost) : null,
        unit: "supplied cost",
      },
      {
        key: "elapsed_minutes",
        label: "Route elapsed time",
        value: best ? round(best.elapsed) : null,
        unit: "min",
      },
      { key: "stops", label: "Stops", value: stops.length, unit: "count" },
    ],
    findings: best
      ? [`${best.depot} → ${best.route.join(" → ")} → ${best.depot}`]
      : [],
    gaps,
    assumptions: [
      "One vehicle serves all stops and returns to its depot; demand is additive; supplied directed costs, travel times, and time windows are authoritative.",
    ],
    formulae: [
      "Objective = minimum sum of supplied directed travel costs over all feasible stop permutations and depots.",
    ],
  };
}

function inspectionSchedule(inputs: Record<string, unknown>): Evaluation {
  const assets = records(inputs.assets, "Inspection obligations").map(
    (row, index) => {
      const last = isoDate(
        row.lastInspection,
        `Asset ${index + 1} last inspection`,
      );
      const interval = positive(
        row.intervalDays,
        `Asset ${index + 1} interval days`,
      );
      const due = new Date(last);
      due.setUTCDate(due.getUTCDate() + interval);
      return {
        id: text(row.id, `Asset ${index + 1} ID`),
        due,
        duration: positive(row.durationHours, `Asset ${index + 1} duration`),
        priority: finite(row.priority ?? 0, `Asset ${index + 1} priority`),
      };
    },
  );
  const daily = positive(
    inputs.dailyCapacityHours,
    "Daily inspection capacity",
  );
  const start = isoDate(inputs.planningStart, "Planning start");
  let day = new Date(start);
  let remaining = daily;
  const findings: string[] = [];
  const gaps: string[] = [];
  assets.sort(
    (a, b) =>
      a.due.getTime() - b.due.getTime() ||
      b.priority - a.priority ||
      a.id.localeCompare(b.id),
  );
  for (const asset of assets) {
    if (asset.duration > daily) {
      gaps.push(
        `${asset.id}: ${asset.duration} h duration exceeds ${daily} h daily capacity.`,
      );
      continue;
    }
    if (asset.duration > remaining) {
      day = new Date(day);
      day.setUTCDate(day.getUTCDate() + 1);
      remaining = daily;
    }
    const state = asset.due < start ? "OVERDUE" : "due";
    findings.push(
      `${asset.id}: ${state} ${asset.due.toISOString().slice(0, 10)}, draft slot ${day.toISOString().slice(0, 10)} (${asset.duration} h).`,
    );
    remaining -= asset.duration;
  }
  return {
    summary: `${findings.length} of ${assets.length} inspection obligation(s) received a capacity-feasible draft slot.`,
    metrics: [
      {
        key: "scheduled",
        label: "Draft scheduled",
        value: findings.length,
        unit: "count",
      },
      {
        key: "unscheduled",
        label: "Unscheduled",
        value: gaps.length,
        unit: "count",
      },
      {
        key: "overdue_at_start",
        label: "Overdue at horizon start",
        value: assets.filter((asset) => asset.due < start).length,
        unit: "count",
      },
    ],
    findings,
    gaps,
    assumptions: [
      "Intervals, last compliant inspection dates, duration, inspector capacity, and out-of-service requirements are approved and current.",
    ],
    formulae: [
      "Due date = last compliant inspection + approved interval days.",
      "Draft slots consume explicit daily qualified-inspector hours in due-date then priority order.",
    ],
  };
}

function airworthiness(inputs: Record<string, unknown>): Evaluation {
  const rows = records(
    inputs.instructions,
    "Airworthiness instructions",
  ).filter((row) => row.applicable === true);
  return coverageEvaluation(
    "applicable airworthiness instruction",
    rows,
    (row) =>
      row.revisionCurrent === true &&
      row.complianceState === "complied" &&
      row.methodApproved === true &&
      typeof row.evidenceReference === "string" &&
      row.evidenceReference.trim() !== "" &&
      (row.recurring !== true || row.nextDue != null),
    (row, index) => String(row.id ?? `instruction ${index + 1}`),
    "current revision, approved compliance method/state, evidence, or recurring due value is missing",
  );
}

function msg3(inputs: Record<string, unknown>): Evaluation {
  const rows = records(inputs.decisionRecords, "MSG-3 decision records");
  return coverageEvaluation(
    "MSG-3 decision",
    rows,
    (row) =>
      row.effectDefined === true &&
      typeof row.consequenceBranch === "string" &&
      row.consequenceBranch.trim() !== "" &&
      row.taskDefined === true &&
      row.applicabilityJustified === true &&
      row.effectivenessJustified === true &&
      typeof row.intervalBasis === "string" &&
      row.intervalBasis.trim() !== "" &&
      row.approved === true,
    (row, index) => String(row.id ?? `decision ${index + 1}`),
    "effect/consequence, task applicability/effectiveness, interval basis, or approval is incomplete",
  );
}

function lifeLimitedPart(inputs: Record<string, unknown>): Evaluation {
  const parts = records(inputs.parts, "Life-limited parts");
  const metrics: DomainMetric[] = [];
  const gaps: string[] = [];
  parts.forEach((part, index) => {
    const id = `${String(part.partNumber ?? `part-${index + 1}`)}/${String(part.serialNumber ?? "serial-missing")}`;
    if (!bool(part.backToBirthComplete) || !bool(part.configurationCurrent)) {
      gaps.push(
        `${id}: back-to-birth or current-configuration trace is incomplete; remaining life is blocked.`,
      );
      metrics.push({
        key: `remaining_${index}`,
        label: `${id} remaining life`,
        value: null,
        unit: String(part.unit ?? "unknown"),
      });
      return;
    }
    const limit = positive(part.approvedLimit, `${id} approved limit`);
    const usage = Array.isArray(part.authenticatedUsage)
      ? part.authenticatedUsage.reduce<number>(
          (sum, value) => sum + nonNegative(value, `${id} usage segment`),
          0,
        )
      : (() => {
          throw new InputError(`${id} authenticated usage must be an array.`);
        })();
    const remaining = limit - usage;
    metrics.push({
      key: `remaining_${index}`,
      label: `${id} remaining life`,
      value: round(remaining),
      unit: String(part.unit ?? "supplied unit"),
    });
    if (remaining < 0)
      gaps.push(
        `${id}: authenticated usage exceeds the supplied approved limit by ${round(-remaining)}.`,
      );
  });
  return {
    summary: `${parts.length} life-limited part(s) were checked; only complete back-to-birth/configuration traces produce a remainder.`,
    metrics,
    findings: gaps.length
      ? [
          "At least one part requires authorized records/airworthiness disposition.",
        ]
      : ["No supplied life counter exceeds its supplied current limit."],
    gaps,
    assumptions: [
      "All life segments are authenticated, non-overlapping, use the same approved unit, and the current limit applies to the installed configuration.",
    ],
    formulae: [
      "Remaining approved life = supplied current approved limit - sum of authenticated usage segments.",
    ],
  };
}

function classSurvey(inputs: Record<string, unknown>): Evaluation {
  const surveys = records(inputs.surveys, "Survey obligations").map(
    (row, index) => {
      const due = isoDate(
        row.lastCredited,
        `Survey ${index + 1} last credited`,
      );
      due.setUTCDate(
        due.getUTCDate() +
          positive(row.intervalDays, `Survey ${index + 1} interval`),
      );
      return {
        id: text(row.id, `Survey ${index + 1} ID`),
        due,
        duration: positive(row.durationHours, `Survey ${index + 1} duration`),
      };
    },
  );
  const windows = records(inputs.dockingWindows, "Docking windows").map(
    (row, index) => ({
      id: text(row.id, `Window ${index + 1} ID`),
      start: isoDate(row.start, `Window ${index + 1} start`),
      end: isoDate(row.end, `Window ${index + 1} end`),
      remaining: positive(row.capacityHours, `Window ${index + 1} capacity`),
    }),
  );
  const findings: string[] = [];
  const gaps: string[] = [];
  surveys.sort((a, b) => a.due.getTime() - b.due.getTime());
  for (const survey of surveys) {
    const candidates = windows
      .filter(
        (window) =>
          window.start <= survey.due &&
          window.end >= window.start &&
          window.remaining >= survey.duration,
      )
      .sort((a, b) => a.start.getTime() - b.start.getTime());
    if (!candidates.length)
      gaps.push(
        `${survey.id}: no supplied docking window before due date ${survey.due.toISOString().slice(0, 10)} has ${survey.duration} h capacity.`,
      );
    else {
      candidates[0].remaining -= survey.duration;
      findings.push(
        `${survey.id}: due ${survey.due.toISOString().slice(0, 10)}, draft window ${candidates[0].id}.`,
      );
    }
  }
  return {
    summary: `${findings.length} of ${surveys.length} survey obligation(s) fit a supplied pre-due docking window.`,
    metrics: [
      {
        key: "scheduled",
        label: "Draft scheduled",
        value: findings.length,
        unit: "count",
      },
      {
        key: "unscheduled",
        label: "Unscheduled",
        value: gaps.length,
        unit: "count",
      },
    ],
    findings,
    gaps,
    assumptions: [
      "The class society has credited the last survey and supplied interval/window rules are current.",
    ],
    formulae: [
      "Due date = last class-credited survey date + supplied approved interval.",
    ],
  };
}

function propulsion(inputs: Record<string, unknown>): Evaluation {
  const rows = records(inputs.observations, "Voyage observations");
  const deviations: number[] = [];
  const findings: string[] = [];
  rows.forEach((row, index) => {
    const id = typeof row.id === "string" ? row.id : `observation ${index + 1}`;
    const intensity =
      positive(row.energy, `${id} energy`) /
      positive(row.distanceNm, `${id} distance`);
    const baseline = positive(
      row.baselineEnergyPerNm,
      `${id} baseline intensity`,
    );
    const deviation = 100 * (intensity / baseline - 1);
    deviations.push(deviation);
    findings.push(
      `${id}: ${round(intensity)} energy/nm, ${round(deviation, 1)}% versus supplied matched baseline.`,
    );
  });
  const average =
    deviations.reduce((sum, value) => sum + value, 0) / deviations.length;
  return {
    summary: `${rows.length} matched voyage observation(s) average ${round(average, 1)}% deviation from their supplied baselines.`,
    metrics: [
      {
        key: "average_deviation",
        label: "Average baseline deviation",
        value: round(average, 1),
        unit: "%",
      },
    ],
    findings,
    gaps: [],
    assumptions: [
      "Each baseline is matched for speed, draft/load, weather/current, route, metering boundary, and fuel/energy units.",
    ],
    formulae: [
      "Observed intensity = energy / nautical miles.",
      "Baseline deviation = 100 × (observed intensity / matched baseline intensity - 1).",
    ],
  };
}

function voyage(inputs: Record<string, unknown>): Evaluation {
  const options = records(inputs.options, "Voyage options").filter(
    (option) => option.constraintsSatisfied === true,
  );
  const weights = object(inputs.weights, "Objective weights");
  const keys = ["cost", "durationHours", "energy", "emissions"] as const;
  const weightByKey: Record<string, number> = {
    cost: finite(weights.cost, "Cost weight"),
    durationHours: finite(weights.duration, "Duration weight"),
    energy: finite(weights.energy, "Energy weight"),
    emissions: finite(weights.emissions, "Emissions weight"),
  };
  if (
    Object.values(weightByKey).some((value) => value < 0) ||
    Object.values(weightByKey).every((value) => value === 0)
  )
    throw new InputError(
      "Voyage objective weights must be non-negative and at least one must be positive.",
    );
  if (!options.length)
    return {
      summary: "No voyage option satisfies the supplied hard constraints.",
      metrics: [],
      findings: [],
      gaps: [
        "All supplied voyage options violate at least one hard constraint.",
      ],
      assumptions: [],
      formulae: [],
    };
  const ranges = Object.fromEntries(
    keys.map((key) => {
      const values = options.map((option) =>
        finite(option[key], `${String(option.id)} ${key}`),
      );
      return [key, { min: Math.min(...values), max: Math.max(...values) }];
    }),
  );
  const ranked = options
    .map((option) => {
      const score = keys.reduce((sum, key) => {
        const value = finite(option[key], `${String(option.id)} ${key}`);
        const range = ranges[key] as { min: number; max: number };
        const normalized =
          range.max === range.min
            ? 0
            : (value - range.min) / (range.max - range.min);
        return sum + normalized * weightByKey[key];
      }, 0);
      return { id: text(option.id, "Voyage option ID"), score };
    })
    .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return {
    summary: `${ranked[0].id} has the lowest approved weighted normalized score among ${ranked.length} feasible option(s).`,
    metrics: [
      {
        key: "selected_score",
        label: "Selected normalized score",
        value: round(ranked[0].score),
        unit: "weighted score",
      },
    ],
    findings: ranked.map(
      (item, index) => `${index + 1}. ${item.id}: ${round(item.score)}`,
    ),
    gaps: [],
    assumptions: [
      "Hard-constraint flags, route options, forecasts, vessel limits, and approved objective weights are current.",
      "Min-max normalization is valid only for comparison within this supplied option set.",
    ],
    formulae: [
      "For each objective, normalized cost = (option - minimum feasible) / (maximum feasible - minimum feasible).",
      "Option score = Σ(normalized objective × approved weight); lower is preferred.",
    ],
  };
}

function thermal(inputs: Record<string, unknown>): Evaluation {
  const heat = positive(inputs.heatLoadKw, "Heat load");
  const cp = positive(inputs.airSpecificHeat, "Air specific heat");
  const density = positive(inputs.airDensity, "Air density");
  const delta = positive(
    inputs.allowedTemperatureRise,
    "Allowed temperature rise",
  );
  const measured = positive(inputs.measuredAirflow, "Measured airflow");
  const capacity = positive(
    inputs.availableCoolingKw,
    "Available cooling capacity",
  );
  const sensors = records(inputs.sensors, "Thermal observations");
  const massFlow = heat / (cp * delta);
  const volumeFlow = massFlow / density;
  const gaps: string[] = [];
  sensors.forEach((sensor, index) => {
    const id =
      typeof sensor.id === "string" ? sensor.id : `sensor ${index + 1}`;
    const value = finite(sensor.value, `${id} value`);
    const low = finite(sensor.lowerLimit, `${id} lower limit`);
    const high = finite(sensor.upperLimit, `${id} upper limit`);
    if (!bool(sensor.calibrated))
      gaps.push(`${id}: calibration is not confirmed.`);
    if (value < low || value > high)
      gaps.push(
        `${id}: observed ${value} is outside supplied envelope ${low}–${high}.`,
      );
  });
  if (measured < volumeFlow)
    gaps.push(
      `Measured airflow ${measured} m³/s is below calculated ${round(volumeFlow)} m³/s required by the supplied lumped heat balance.`,
    );
  if (capacity < heat)
    gaps.push(
      `Available cooling ${capacity} kW is below supplied IT heat load ${heat} kW in the assessed redundancy state.`,
    );
  return {
    summary: `The lumped heat balance requires ${round(volumeFlow)} m³/s airflow for ${heat} kW at ${delta} K supplied temperature rise.`,
    metrics: [
      {
        key: "required_mass_flow",
        label: "Required mass airflow",
        value: round(massFlow),
        unit: "kg/s",
      },
      {
        key: "required_volume_flow",
        label: "Required volumetric airflow",
        value: round(volumeFlow),
        unit: "m³/s",
      },
      {
        key: "airflow_margin",
        label: "Measured airflow margin",
        value: round(measured - volumeFlow),
        unit: "m³/s",
      },
      {
        key: "cooling_margin",
        label: "Available cooling margin",
        value: round(capacity - heat),
        unit: "kW",
      },
    ],
    findings: gaps.length
      ? [
          "The supplied balance or sensor envelope contains one or more exceptions.",
        ]
      : [
          "No exception was found against the supplied lumped heat balance and sensor envelopes.",
        ],
    gaps,
    assumptions: [
      "IT electrical load converts to heat inside the assessed boundary; cp, density, mixing, leakage, redundancy state, and ΔT are approved for this lumped model.",
    ],
    formulae: [
      "Required mass flow = heat load / (air specific heat × approved temperature rise).",
      "Required volumetric flow = mass flow / air density.",
    ],
  };
}

function missionReadiness(inputs: Record<string, unknown>): Evaluation {
  const missions = records(inputs.missions, "Mission requirements");
  const assets = records(inputs.assets, "Force elements");
  const gaps: string[] = [];
  const metrics: DomainMetric[] = [];
  missions.forEach((mission, index) => {
    const id = text(mission.id, `Mission ${index + 1} ID`);
    const required = positiveInteger(
      mission.requiredCount,
      `${id} required count`,
    );
    const capability = strings(mission.requiredCapabilities);
    const ready = assets.filter(
      (asset) =>
        capability.every((tag) => strings(asset.capabilities).includes(tag)) &&
        bool(asset.available) &&
        bool(asset.configurationReady) &&
        bool(asset.crewQualified) &&
        bool(asset.supplyReady) &&
        bool(asset.maintenanceWithinLimit),
    ).length;
    metrics.push({
      key: `coverage_${id}`,
      label: `${id} ready coverage`,
      value: round((100 * ready) / required, 1),
      unit: "% of requirement",
    });
    if (ready < required)
      gaps.push(
        `${id}: ${ready} fully ready qualifying asset(s), ${required} required.`,
      );
  });
  return {
    summary: `${missions.length} mission requirement(s) were evaluated against ${assets.length} supplied force element(s).`,
    metrics,
    findings: gaps.length
      ? ["At least one mission profile has a supplied readiness shortfall."]
      : [
          "Every supplied mission profile meets its supplied ready-asset count.",
        ],
    gaps,
    assumptions: [
      "Mission tags and all readiness dimensions are command-approved, current, and binary only where that definition is valid.",
    ],
    formulae: [
      "Mission-ready asset = capability match AND available AND configuration-ready AND crew-qualified AND supply-ready AND within maintenance limits.",
      "Coverage = fully ready qualifying assets / supplied required assets.",
    ],
  };
}

function milspec(inputs: Record<string, unknown>): Evaluation {
  const rows = records(inputs.configurationItems, "Configuration items");
  return coverageEvaluation(
    "configuration item",
    rows,
    (row) =>
      (row.installedRevision === row.approvedRevision ||
        row.deviationApproved === true) &&
      (row.obsolete !== true || row.replacementQualified === true),
    (row, index) => String(row.id ?? `CI ${index + 1}`),
    "installed baseline is not approved/deviated or obsolete item lacks qualified resolution",
  );
}

function classifiedDeployment(inputs: Record<string, unknown>): Evaluation {
  text(inputs.classification, "Classification");
  text(inputs.deploymentZone, "Deployment zone");
  const rows = records(inputs.controls, "Deployment controls").filter(
    (row) => row.required !== false,
  );
  return coverageEvaluation(
    "required deployment control",
    rows,
    (row) =>
      row.implemented === true &&
      row.tested === true &&
      row.approved === true &&
      typeof row.evidenceReference === "string" &&
      row.evidenceReference.trim() !== "",
    (row, index) => String(row.id ?? `control ${index + 1}`),
    "implementation, test, approval, or evidence is incomplete",
  );
}

function reuseLife(inputs: Record<string, unknown>): Evaluation {
  const items = records(inputs.items, "Reusable items");
  const metrics: DomainMetric[] = [];
  const gaps: string[] = [];
  items.forEach((item, itemIndex) => {
    const id = typeof item.id === "string" ? item.id : `item ${itemIndex + 1}`;
    if (!bool(item.historyAuthenticated) || !bool(item.configurationCurrent)) {
      gaps.push(`${id}: mission history or configuration trace is incomplete.`);
      return;
    }
    const counters = records(item.counters, `${id} counters`);
    counters.forEach((counter, counterIndex) => {
      const key = text(counter.key, `${id} counter ${counterIndex + 1}`);
      const limit = positive(counter.limit, `${id}/${key} limit`);
      const used = nonNegative(counter.used, `${id}/${key} used`);
      const remaining = limit - used;
      metrics.push({
        key: `${id}_${key}`,
        label: `${id} ${key} remaining`,
        value: round(remaining),
        unit: String(counter.unit ?? "supplied unit"),
      });
      if (remaining < 0)
        gaps.push(
          `${id}/${key}: usage exceeds supplied approved limit by ${round(-remaining)}.`,
        );
    });
  });
  return {
    summary: `${items.length} reusable item(s) were checked against supplied controlled life counters.`,
    metrics,
    findings: gaps.length
      ? [
          "At least one history/configuration/life-counter condition requires design-authority disposition.",
        ]
      : [
          "No supplied authenticated counter exceeds its supplied current approved limit.",
        ],
    gaps,
    assumptions: [
      "Counters are authenticated, non-overlapping, use the approved units, and current limits apply to the as-flown configuration.",
    ],
    formulae: [
      "Remaining counter life = supplied current approved limit - authenticated accumulated usage.",
    ],
  };
}

function rangeSafety(inputs: Record<string, unknown>): Evaluation {
  const rows = records(inputs.requirements, "Range-safety requirements").filter(
    (row) => row.applicable !== false,
  );
  return coverageEvaluation(
    "applicable range-safety requirement",
    rows,
    (row) =>
      typeof row.evidenceReference === "string" &&
      row.evidenceReference.trim() !== "" &&
      row.status === "satisfied" &&
      row.approved === true &&
      row.current === true,
    (row, index) => String(row.id ?? `requirement ${index + 1}`),
    "current approved evidence or satisfied state is missing",
  );
}

function propellant(inputs: Record<string, unknown>): Evaluation {
  const properties = records(inputs.properties, "Propellant properties");
  const exposures = records(inputs.exposures, "Propellant exposures");
  const gaps: string[] = [];
  const metrics: DomainMetric[] = [];
  properties.forEach((property, index) => {
    const id =
      typeof property.id === "string" ? property.id : `property ${index + 1}`;
    const observed = finite(property.observed, `${id} observed`);
    const lower =
      typeof property.lowerLimit === "number"
        ? finite(property.lowerLimit, `${id} lower`)
        : null;
    const upper =
      typeof property.upperLimit === "number"
        ? finite(property.upperLimit, `${id} upper`)
        : null;
    if (lower == null && upper == null)
      gaps.push(`${id}: no supplied approved property limit.`);
    if (lower != null && observed < lower)
      gaps.push(
        `${id}: observed ${observed} is below supplied lower limit ${lower}.`,
      );
    if (upper != null && observed > upper)
      gaps.push(
        `${id}: observed ${observed} is above supplied upper limit ${upper}.`,
      );
    if (!bool(property.methodApproved) || !bool(property.calibrated))
      gaps.push(`${id}: approved method or calibration is not confirmed.`);
    const nearest = Math.min(
      lower == null ? Number.POSITIVE_INFINITY : observed - lower,
      upper == null ? Number.POSITIVE_INFINITY : upper - observed,
    );
    metrics.push({
      key: `margin_${id}`,
      label: `${id} nearest limit margin`,
      value: Number.isFinite(nearest) ? round(nearest) : null,
      unit: String(property.unit ?? "supplied unit"),
    });
  });
  exposures.forEach((exposure, index) => {
    const id =
      typeof exposure.id === "string" ? exposure.id : `exposure ${index + 1}`;
    const accumulated = nonNegative(exposure.accumulated, `${id} accumulated`);
    const maximum = positive(exposure.maximum, `${id} maximum`);
    metrics.push({
      key: `remaining_${id}`,
      label: `${id} remaining allowance`,
      value: round(maximum - accumulated),
      unit: String(exposure.unit ?? "supplied unit"),
    });
    if (accumulated > maximum)
      gaps.push(
        `${id}: accumulated exposure exceeds supplied maximum by ${round(accumulated - maximum)}.`,
      );
  });
  return {
    summary: `${properties.length} measured property/properties and ${exposures.length} exposure counter(s) were checked against supplied material-specific limits.`,
    metrics,
    findings: gaps.length
      ? [
          "At least one property, exposure, or measurement-control condition requires materials-authority disposition.",
        ]
      : [
          "No supplied property or exposure counter exceeds its supplied approved limits.",
        ],
    gaps,
    assumptions: [
      "Samples are representative; methods, calibration, units, limits, material identity, and configuration are approved and current.",
    ],
    formulae: [
      "Property margin = distance to nearest supplied lower/upper limit.",
      "Remaining exposure allowance = supplied approved maximum - authenticated accumulated exposure.",
    ],
  };
}

function batteryThermal(inputs: Record<string, unknown>): Evaluation {
  const observations = records(inputs.observations, "Thermal observations");
  const controls = records(
    inputs.thermalControls,
    "Thermal-management controls",
  ).filter((row) => row.required !== false);
  const gaps: string[] = [];
  const metrics: DomainMetric[] = [];
  observations.forEach((observation, index) => {
    const id = String(observation.id ?? `observation ${index + 1}`);
    const observed = finite(observation.observed, `${id} observed temperature`);
    const lower =
      typeof observation.lowerLimit === "number"
        ? finite(observation.lowerLimit, `${id} lower limit`)
        : null;
    const upper =
      typeof observation.upperLimit === "number"
        ? finite(observation.upperLimit, `${id} upper limit`)
        : null;
    if (lower == null && upper == null)
      gaps.push(`${id}: no supplied approved thermal limit.`);
    if (lower != null && observed < lower)
      gaps.push(`${id}: observed value is below the supplied lower limit.`);
    if (upper != null && observed > upper)
      gaps.push(`${id}: observed value is above the supplied upper limit.`);
    if (!bool(observation.calibrated))
      gaps.push(`${id}: calibrated measurement is not confirmed.`);
    if (!observation.observedAt)
      gaps.push(`${id}: observation timestamp is missing.`);
    const margin = Math.min(
      lower == null ? Number.POSITIVE_INFINITY : observed - lower,
      upper == null ? Number.POSITIVE_INFINITY : upper - observed,
    );
    metrics.push({
      key: `thermal_margin_${id}`,
      label: `${id} nearest thermal-limit margin`,
      value: Number.isFinite(margin) ? round(margin) : null,
      unit: String(observation.unit ?? "supplied unit"),
    });
  });
  controls.forEach((control, index) => {
    const id = String(control.id ?? `control ${index + 1}`);
    const normal = control.available === true && control.testCurrent === true;
    const compensated =
      control.impairmentApproved === true &&
      typeof control.compensatingMeasure === "string" &&
      control.compensatingMeasure.trim() !== "";
    if (!normal && !compensated)
      gaps.push(
        `${id}: required thermal control is unavailable or unverified without an approved impairment and compensating measure.`,
      );
  });
  return {
    summary: `${observations.length} thermal observation(s) and ${controls.length} required thermal-control function(s) were screened against supplied criteria.`,
    metrics: [
      ...metrics,
      {
        key: "thermal_gaps",
        label: "Thermal evidence/control gaps",
        value: gaps.length,
        unit: "count",
      },
    ],
    findings: gaps.length
      ? [
          "At least one thermal envelope, measurement, or control condition requires authority disposition.",
        ]
      : [
          "No exception was found against the supplied thermal limits and control requirements.",
        ],
    gaps,
    assumptions: [
      "Limits, locations, units, calibration, timestamps, and controlled battery configuration are approved and mutually applicable.",
    ],
    formulae: [
      "Thermal margin = distance to the nearest supplied approved lower or upper limit.",
    ],
  };
}

function batteryHvSafety(inputs: Record<string, unknown>): Evaluation {
  const rows = records(inputs.controls, "High-voltage controls").filter(
    (row) => row.required !== false,
  );
  return coverageEvaluation(
    "required high-voltage control",
    rows,
    (row) => {
      const normal =
        row.implemented === true && row.tested === true && row.current === true;
      const impaired =
        row.impairmentApproved === true &&
        typeof row.compensatingMeasure === "string" &&
        row.compensatingMeasure.trim() !== "";
      return (
        (normal || impaired) &&
        typeof row.evidenceReference === "string" &&
        row.evidenceReference.trim() !== "" &&
        row.approved === true
      );
    },
    (row, index) => String(row.id ?? `control ${index + 1}`),
    "implementation, current test, evidence, approval, or governed impairment disposition is incomplete",
  );
}

function batteryDegradation(inputs: Record<string, unknown>): Evaluation {
  const units = records(inputs.units, "Battery unit observations");
  const metrics: DomainMetric[] = [];
  const gaps: string[] = [];
  units.forEach((unit, index) => {
    const id = String(unit.id ?? `unit ${index + 1}`);
    if (!bool(unit.compatibleMethod)) {
      gaps.push(
        `${id}: baseline and current observations are not confirmed comparable.`,
      );
      return;
    }
    const baselineCapacity = positive(
      unit.baselineCapacity,
      `${id} baseline capacity`,
    );
    const measuredCapacity = nonNegative(
      unit.measuredCapacity,
      `${id} measured capacity`,
    );
    const baselineResistance = positive(
      unit.baselineResistance,
      `${id} baseline resistance/impedance`,
    );
    const measuredResistance = nonNegative(
      unit.measuredResistance,
      `${id} measured resistance/impedance`,
    );
    const minimumRetention = finite(
      unit.minimumCapacityRetention,
      `${id} minimum capacity retention`,
    );
    const maximumResistanceChange = finite(
      unit.maximumResistanceChange,
      `${id} maximum resistance change`,
    );
    if (!(minimumRetention > 0 && minimumRetention <= 1))
      throw new InputError(
        `${id} minimum capacity retention must be greater than zero and no greater than one.`,
      );
    if (maximumResistanceChange < 0)
      throw new InputError(
        `${id} maximum resistance change must not be negative.`,
      );
    const retention = measuredCapacity / baselineCapacity;
    const resistanceChange =
      (measuredResistance - baselineResistance) / baselineResistance;
    metrics.push(
      {
        key: `capacity_retention_${id}`,
        label: `${id} measured capacity retention`,
        value: round(100 * retention, 1),
        unit: "%",
      },
      {
        key: `resistance_change_${id}`,
        label: `${id} measured resistance/impedance change`,
        value: round(100 * resistanceChange, 1),
        unit: "%",
      },
    );
    if (retention < minimumRetention)
      gaps.push(
        `${id}: capacity retention is below the supplied approved criterion.`,
      );
    if (resistanceChange > maximumResistanceChange)
      gaps.push(
        `${id}: resistance/impedance change exceeds the supplied approved criterion.`,
      );
  });
  return {
    summary: `${units.length} battery unit(s) were compared with compatible supplied baselines and asset-specific approved criteria.`,
    metrics,
    findings: gaps.length
      ? [
          "At least one comparability, capacity, or resistance/impedance condition requires authority disposition.",
        ]
      : [
          "No exception was found against the supplied compatible baselines and approved criteria.",
        ],
    gaps,
    assumptions: [
      "Temperature, SOC, duty, method, units, calibration, and controlled configuration are compatible as asserted by the evidence owner.",
    ],
    formulae: [
      "Capacity retention = measured capacity / compatible baseline capacity.",
      "Resistance/impedance change = (measured value - compatible baseline value) / compatible baseline value.",
    ],
  };
}

function batteryFireReadiness(inputs: Record<string, unknown>): Evaluation {
  const barriers = records(
    inputs.barriers,
    "Fire and propagation barriers",
  ).filter((row) => row.required !== false);
  const prerequisites = records(
    inputs.emergencyPrerequisites,
    "Emergency prerequisites",
  ).filter((row) => row.required !== false);
  const gaps: string[] = [];
  barriers.forEach((barrier, index) => {
    const id = String(barrier.id ?? `barrier ${index + 1}`);
    const normal = barrier.available === true && barrier.testCurrent === true;
    const impaired =
      barrier.impairmentApproved === true &&
      typeof barrier.compensatingMeasure === "string" &&
      barrier.compensatingMeasure.trim() !== "";
    if (
      (!normal && !impaired) ||
      typeof barrier.evidenceReference !== "string" ||
      !barrier.evidenceReference.trim()
    )
      gaps.push(
        `${id}: current evidenced barrier availability or governed impairment disposition is incomplete.`,
      );
  });
  prerequisites.forEach((item, index) => {
    const id = String(item.id ?? `prerequisite ${index + 1}`);
    if (
      item.current !== true ||
      item.exercised !== true ||
      item.approved !== true ||
      typeof item.evidenceReference !== "string" ||
      !item.evidenceReference.trim()
    )
      gaps.push(
        `${id}: current, exercised, evidenced, and approved emergency readiness is incomplete.`,
      );
  });
  return {
    summary: `${barriers.length} required fire/propagation barrier(s) and ${prerequisites.length} emergency prerequisite(s) were checked.`,
    metrics: [
      {
        key: "fire_readiness_gaps",
        label: "Fire/emergency readiness gaps",
        value: gaps.length,
        unit: "count",
      },
      {
        key: "requirements_checked",
        label: "Requirements checked",
        value: barriers.length + prerequisites.length,
        unit: "count",
      },
    ],
    findings: gaps.length
      ? [
          "At least one fire barrier, impairment, or emergency-readiness condition requires authority disposition.",
        ]
      : [
          "No trace-contract gap was found in the supplied fire and emergency-readiness records.",
        ],
    gaps,
    assumptions: [
      "The authority-defined barrier and emergency prerequisite scopes are complete for this chemistry, configuration, installation, and jurisdiction.",
    ],
    formulae: [
      "Readiness requires every in-scope barrier and emergency prerequisite to satisfy its governed trace contract.",
    ],
  };
}

function codeCompliance(inputs: Record<string, unknown>): Evaluation {
  const rows = records(inputs.requirements, "Code requirements").filter(
    (row) => row.applicable !== false,
  );
  return coverageEvaluation(
    "applicable code requirement",
    rows,
    (row) =>
      typeof row.evidenceReference === "string" &&
      row.evidenceReference.trim() !== "" &&
      row.inspected === true &&
      (row.deficiencyStatus == null || row.deficiencyStatus === "closed") &&
      row.authorityDisposition === "accepted",
    (row, index) => String(row.id ?? `requirement ${index + 1}`),
    "accepted evidence/inspection/deficiency disposition is incomplete",
  );
}

function fireLifeSafety(inputs: Record<string, unknown>): Evaluation {
  const systems = records(inputs.systems, "Fire/life-safety systems").filter(
    (row) => row.required !== false,
  );
  const zones = records(inputs.egressZones, "Egress zones");
  const gaps: string[] = [];
  systems.forEach((system, index) => {
    const id = String(system.id ?? `system ${index + 1}`);
    const normal = system.available === true && system.testCurrent === true;
    const compensated =
      system.impairmentApproved === true &&
      typeof system.compensatingMeasure === "string" &&
      system.compensatingMeasure.trim() !== "";
    if (!normal && !compensated)
      gaps.push(
        `${id}: required function is unavailable/test-overdue without approved impairment and compensating measure.`,
      );
  });
  zones.forEach((zone, index) => {
    const id = String(zone.id ?? `zone ${index + 1}`);
    if (
      nonNegative(zone.currentOccupants, `${id} current occupants`) >
      nonNegative(zone.designOccupants, `${id} design occupants`)
    )
      gaps.push(
        `${id}: supplied current occupants exceed supplied design occupants.`,
      );
    if (
      nonNegative(zone.availableExits, `${id} available exits`) <
      nonNegative(zone.requiredExits, `${id} required exits`)
    )
      gaps.push(
        `${id}: available exits are below the supplied approved requirement.`,
      );
    if (!bool(zone.accessibilityProvisionCurrent))
      gaps.push(`${id}: current accessibility provisions are not confirmed.`);
  });
  return {
    summary: `${systems.length} required fire/life-safety function(s) and ${zones.length} occupant/egress zone(s) were screened.`,
    metrics: [
      {
        key: "systems",
        label: "Required systems",
        value: systems.length,
        unit: "count",
      },
      {
        key: "zones",
        label: "Egress zones",
        value: zones.length,
        unit: "count",
      },
      {
        key: "exceptions",
        label: "Readiness exceptions",
        value: gaps.length,
        unit: "count",
      },
    ],
    findings: gaps.length
      ? [
          "At least one supplied life-safety readiness condition requires authority disposition.",
        ]
      : [
          "No exception was found against the supplied system, impairment, occupant, exit, and accessibility conditions.",
        ],
    gaps,
    assumptions: [
      "Required systems, tests, design occupancy, exit counts, impairments, and compensating measures are authority-approved and current.",
    ],
    formulae: [
      "A required system is screened ready only when available and test-current, or under an approved impairment with a named compensating measure.",
    ],
  };
}

function occupancy(inputs: Record<string, unknown>): Evaluation {
  const rows = records(
    inputs.prerequisites,
    "Certification prerequisites",
  ).filter((row) => row.required !== false);
  return coverageEvaluation(
    "required occupancy/accessibility prerequisite",
    rows,
    (row) =>
      typeof row.evidenceReference === "string" &&
      row.evidenceReference.trim() !== "" &&
      row.result === "accepted" &&
      row.blockingDeficiency !== true &&
      row.authorityAccepted === true &&
      row.expired !== true,
    (row, index) => String(row.id ?? `prerequisite ${index + 1}`),
    "accepted current evidence or authority clearance is incomplete, or a blocking deficiency remains",
  );
}

function occupantEnvironment(inputs: Record<string, unknown>): Evaluation {
  const observations = records(
    inputs.observations,
    "Occupied-zone observations",
  );
  let occupiedHours = 0;
  let hoursWithinEnvelope = 0;
  const gaps: string[] = [];
  observations.forEach((row, index) => {
    const id = text(row.id, `Observation ${index + 1} ID`);
    const hours = positive(row.occupiedHours, `${id} occupied hours`);
    occupiedHours += hours;
    const temperature = finite(row.temperatureC, `${id} temperature`);
    const temperatureMin = finite(
      row.temperatureMinC,
      `${id} minimum temperature`,
    );
    const temperatureMax = finite(
      row.temperatureMaxC,
      `${id} maximum temperature`,
    );
    const humidity = finite(row.relativeHumidityPct, `${id} relative humidity`);
    const humidityMin = finite(row.humidityMinPct, `${id} minimum humidity`);
    const humidityMax = finite(row.humidityMaxPct, `${id} maximum humidity`);
    const co2 = nonNegative(row.co2Ppm, `${id} CO₂`);
    const co2Max = positive(row.co2MaxPpm, `${id} maximum CO₂`);
    isoDate(row.observedAt, `${id} observation timestamp`);
    if (
      temperatureMin > temperatureMax ||
      humidityMin > humidityMax ||
      humidityMin < 0 ||
      humidityMax > 100
    ) {
      throw new InputError(`${id} contains an invalid supplied envelope.`);
    }
    const reasons: string[] = [];
    if (!bool(row.criteriaApproved))
      reasons.push("the supplied envelope is not authority-approved");
    if (!bool(row.calibrated))
      reasons.push("sensor calibration is not confirmed");
    if (temperature < temperatureMin || temperature > temperatureMax)
      reasons.push(
        `temperature ${temperature} °C is outside ${temperatureMin}–${temperatureMax} °C`,
      );
    if (humidity < humidityMin || humidity > humidityMax)
      reasons.push(
        `relative humidity ${humidity}% is outside ${humidityMin}–${humidityMax}%`,
      );
    if (co2 > co2Max)
      reasons.push(`CO₂ ${co2} ppm exceeds supplied maximum ${co2Max} ppm`);
    if (reasons.length) gaps.push(`${id}: ${reasons.join("; ")}.`);
    else hoursWithinEnvelope += hours;
  });
  return {
    summary: `${round(hoursWithinEnvelope, 1)} of ${round(occupiedHours, 1)} supplied occupied hours are within approved temperature, humidity, and CO₂ envelopes with confirmed calibration.`,
    metrics: [
      {
        key: "occupied_hours",
        label: "Occupied hours assessed",
        value: round(occupiedHours, 1),
        unit: "hours",
      },
      {
        key: "occupied_hours_within_envelope",
        label: "Occupied hours within envelope",
        value: round(hoursWithinEnvelope, 1),
        unit: "hours",
      },
      {
        key: "occupied_compliance",
        label: "Occupied-hour envelope coverage",
        value: round((100 * hoursWithinEnvelope) / occupiedHours, 1),
        unit: "%",
      },
    ],
    findings: gaps.length
      ? ["At least one occupied-zone observation requires investigation."]
      : ["No exception was found against the supplied approved envelopes."],
    gaps,
    assumptions: [
      "The supplied occupancy hours, zone mapping, criteria, units, calibration state, and measurement boundary are current and applicable.",
    ],
    formulae: [
      "Occupied-hour envelope coverage = compliant occupied hours / assessed occupied hours.",
    ],
  };
}

function basControlIntegrity(inputs: Record<string, unknown>): Evaluation {
  const points = records(inputs.controlPoints, "BAS control points").filter(
    (row) => row.required !== false,
  );
  return coverageEvaluation(
    "required BAS control point",
    points,
    (row) => {
      const command = finite(row.commandValue, "Command value");
      const feedback = finite(row.feedbackValue, "Feedback value");
      const tolerance = nonNegative(row.tolerance, "Supplied tolerance");
      return (
        Math.abs(command - feedback) <= tolerance &&
        row.alarmTestCurrent === true &&
        row.failSafeTestCurrent === true &&
        row.trendComplete === true &&
        (row.manualOverrideActive !== true || row.overrideApproved === true)
      );
    },
    (row, index) => String(row.id ?? `control point ${index + 1}`),
    "command/feedback agreement, alarm/fail-safe test, trend, or override control is incomplete",
  );
}

function energyWaterPerformance(inputs: Record<string, unknown>): Evaluation {
  const periods = records(inputs.periods, "Normalized performance periods");
  const gaps: string[] = [];
  let actualEnergy = 0;
  let baselineEnergy = 0;
  let actualWater = 0;
  let baselineWater = 0;
  let comparable = 0;
  periods.forEach((row, index) => {
    const id = text(row.id, `Period ${index + 1} ID`);
    const values = {
      actualEnergy: nonNegative(row.actualEnergyKwh, `${id} actual energy`),
      baselineEnergy: positive(row.baselineEnergyKwh, `${id} baseline energy`),
      actualWater: nonNegative(row.actualWaterM3, `${id} actual water`),
      baselineWater: positive(row.baselineWaterM3, `${id} baseline water`),
    };
    if (
      !bool(row.normalizationApproved) ||
      !bool(row.boundaryEquivalent) ||
      !bool(row.dataQualityAccepted)
    ) {
      gaps.push(
        `${id}: approved normalization, equivalent boundary, or accepted data quality is missing.`,
      );
      return;
    }
    comparable += 1;
    actualEnergy += values.actualEnergy;
    baselineEnergy += values.baselineEnergy;
    actualWater += values.actualWater;
    baselineWater += values.baselineWater;
  });
  if (!comparable)
    throw new InputError(
      "No supplied period has approved normalization, an equivalent boundary, and accepted data quality.",
    );
  const energyVariance = actualEnergy - baselineEnergy;
  const waterVariance = actualWater - baselineWater;
  return {
    summary: `${comparable} of ${periods.length} supplied period(s) are comparable with the approved normalized baseline. Variances are observations, not certified savings.`,
    metrics: [
      {
        key: "energy_variance",
        label: "Energy variance",
        value: round(energyVariance, 1),
        unit: "kWh",
      },
      {
        key: "energy_variance_pct",
        label: "Energy variance",
        value: round((100 * energyVariance) / baselineEnergy, 1),
        unit: "%",
      },
      {
        key: "water_variance",
        label: "Water variance",
        value: round(waterVariance, 1),
        unit: "m³",
      },
      {
        key: "water_variance_pct",
        label: "Water variance",
        value: round((100 * waterVariance) / baselineWater, 1),
        unit: "%",
      },
    ],
    findings: [
      energyVariance <= 0
        ? "Metered energy is not above the supplied normalized baseline."
        : "Metered energy is above the supplied normalized baseline.",
      waterVariance <= 0
        ? "Metered water is not above the supplied normalized baseline."
        : "Metered water is above the supplied normalized baseline.",
    ],
    gaps,
    assumptions: [
      "The approved baseline already accounts for relevant weather, occupancy, service level, schedule, meter, and boundary effects.",
    ],
    formulae: [
      "Variance = metered actual - approved normalized baseline.",
      "Variance percent = 100 × variance / approved normalized baseline.",
    ],
  };
}

function facilityRenewalPriority(inputs: Record<string, unknown>): Evaluation {
  const budget = positive(
    inputs.availableBudget,
    "Indicative available budget",
  );
  const weights = object(inputs.weights, "Approved priority weights");
  if (!bool(weights.approved))
    throw new InputError("Priority weights must be explicitly approved.");
  text(weights.approvalReference, "Priority weight approval reference");
  const factors = ["safety", "compliance", "service", "condition", "energy"];
  const factorWeights = Object.fromEntries(
    factors.map((factor) => [
      factor,
      nonNegative(weights[factor], `${factor} weight`),
    ]),
  );
  if (Object.values(factorWeights).every((value) => value === 0))
    throw new InputError(
      "At least one approved priority weight must be positive.",
    );
  const candidates = records(inputs.candidates, "Renewal candidates");
  requireUnique(
    candidates.map((row, index) => text(row.id, `Candidate ${index + 1} ID`)),
    "Renewal candidates",
  );
  const gaps: string[] = [];
  const rankable = candidates.flatMap((row, index) => {
    const id = text(row.id, `Candidate ${index + 1} ID`);
    const cost = positive(row.cost, `${id} cost`);
    if (!bool(row.evidenceReady)) {
      gaps.push(`${id}: evidence is not ready for portfolio comparison.`);
      return [];
    }
    const scores = Object.fromEntries(
      factors.map((factor) => {
        const score = finite(row[factor], `${id} ${factor} score`);
        if (score < 0 || score > 5)
          throw new InputError(
            `${id} ${factor} score must be between 0 and 5.`,
          );
        return [factor, score];
      }),
    );
    const benefit = factors.reduce(
      (sum, factor) => sum + scores[factor] * factorWeights[factor],
      0,
    );
    const mandatory = bool(row.mandatory);
    let due = Number.POSITIVE_INFINITY;
    if (mandatory) {
      if (!row.dueDate)
        gaps.push(`${id}: mandatory candidate has no supplied due date.`);
      else due = isoDate(row.dueDate, `${id} due date`).getTime();
    }
    return [{ id, cost, mandatory, due, benefit, priority: benefit / cost }];
  });
  if (!rankable.length)
    throw new InputError(
      "No supplied renewal candidate is evidence-ready for governed priority review.",
    );
  rankable.sort(
    (left, right) =>
      Number(right.mandatory) - Number(left.mandatory) ||
      (left.mandatory && right.mandatory ? left.due - right.due : 0) ||
      right.priority - left.priority ||
      left.id.localeCompare(right.id),
  );
  const mandatoryCost = rankable
    .filter((item) => item.mandatory)
    .reduce((sum, item) => sum + item.cost, 0);
  let planned = 0;
  const findings = rankable.map((item, index) => {
    const withinEnvelope = planned + item.cost <= budget;
    planned += item.cost;
    return `${index + 1}. ${item.id} · ${item.mandatory ? "MANDATORY — not economically deferrable" : `weighted benefit/cost ${round(item.priority, 6)}`} · ${withinEnvelope ? "inside" : "outside"} the indicative cumulative budget line.`;
  });
  if (mandatoryCost > budget)
    gaps.push(
      `Mandatory candidate cost exceeds the indicative budget by ${round(mandatoryCost - budget, 2)}; authority resolution is required and mandatory work is not deferred by this model.`,
    );
  return {
    summary: `${rankable.length} of ${candidates.length} renewal candidate(s) are evidence-ready for governed priority review; the planning envelope is not expenditure authorization.`,
    metrics: [
      {
        key: "indicative_budget",
        label: "Indicative planning envelope",
        value: round(budget, 2),
        unit: "supplied currency",
      },
      {
        key: "mandatory_cost",
        label: "Mandatory candidate cost",
        value: round(mandatoryCost, 2),
        unit: "supplied currency",
      },
      {
        key: "evidence_ready_candidates",
        label: "Evidence-ready candidates",
        value: rankable.length,
        unit: "count",
      },
    ],
    findings,
    gaps,
    assumptions: [
      "Mandatory classifications, due dates, factor scores, costs, dependencies, weights, and budget are current and approved for this comparison.",
    ],
    formulae: [
      "Weighted benefit = Σ(supplied 0–5 factor score × approved factor weight).",
      "Non-mandatory priority = weighted benefit / supplied cost; mandatory work remains outside economic trade-off.",
    ],
  };
}

const PATIENT_IDENTIFIER_KEYS = new Set([
  "patientid",
  "patientname",
  "patientidentifier",
  "mrn",
  "medicalrecordnumber",
  "healthcardnumber",
  "dateofbirth",
  "dob",
]);

function rejectPatientIdentifiers(value: unknown, path = "inputs"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectPatientIdentifiers(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (PATIENT_IDENTIFIER_KEYS.has(normalized)) {
      throw new InputError(`${path}.${key} is prohibited: healthcare specialist inputs must not contain patient identifiers.`);
    }
    rejectPatientIdentifiers(nested, `${path}.${key}`);
  }
}

function healthcareClinicalCriticality(inputs: Record<string, unknown>): Evaluation {
  rejectPatientIdentifiers(inputs);
  const devices = records(inputs.devices, "Clinical device scope");
  requireUnique(devices.map((row, i) => text(row.id, `Device ${i + 1} ID`)), "Clinical device scope");
  return coverageEvaluation(
    "clinical-criticality",
    devices,
    (row) => Boolean(row.id && row.clinicalFunction && row.consequenceCategory && row.approvedCriticality && bool(row.authorityApproved)),
    (row, i) => String(row.id ?? `device ${i + 1}`),
    "clinical function, consequence, approved criticality, or authority approval is missing.",
  );
}

function healthcareAvailability(inputs: Record<string, unknown>): Evaluation {
  rejectPatientIdentifiers(inputs);
  const devices = records(inputs.devices, "Device availability records");
  const ids = devices.map((row, i) => text(row.id, `Device ${i + 1} ID`));
  requireUnique(ids, "Device availability records");
  let available = 0;
  let required = 0;
  const gaps: string[] = [];
  devices.forEach((row, index) => {
    const id = ids[index];
    const a = nonNegative(row.availableTime, `${id} available time`);
    const r = positive(row.requiredTime, `${id} required time`);
    if (a > r) throw new InputError(`${id} available time must not exceed required time.`);
    available += a;
    required += r;
    if (!row.serviceState) gaps.push(`${id}: controlled service state is missing.`);
    if (!bool(row.impairmentApproved)) gaps.push(`${id}: impairment disposition is not approved.`);
    if (!bool(row.alternativeCoverageApproved)) gaps.push(`${id}: alternative coverage is not approved.`);
  });
  return {
    summary: `The supplied device population has ${round((available / required) * 100, 1)}% observed availability. This does not establish required clinical capacity or authorize substitution.`,
    metrics: [
      { key: "availability", label: "Observed availability", value: round((available / required) * 100, 1), unit: "%" },
      { key: "devices", label: "In-scope devices", value: devices.length, unit: "count" },
      { key: "control_gaps", label: "Disposition or coverage gaps", value: gaps.length, unit: "count" },
    ],
    findings: gaps.length ? ["Clinical authority review is required for unresolved coverage or impairment evidence."] : ["No coverage or impairment gap was found in the supplied records."],
    gaps,
    assumptions: ["The supplied population, observation window, time basis and clinical service-state definition are approved and comparable."],
    formulae: ["Observed availability = Σ supplied available time / Σ supplied required time."],
  };
}

function healthcareCalibration(inputs: Record<string, unknown>): Evaluation {
  rejectPatientIdentifiers(inputs);
  const instruments = records(inputs.instruments, "Calibration records");
  return coverageEvaluation(
    "calibration-assurance",
    instruments,
    (row) => Boolean(row.id && bool(row.calibrationCurrent) && row.traceableStandard && bool(row.toleranceApproved) && row.result && bool(row.dispositionApproved)),
    (row, i) => String(row.id ?? `instrument ${i + 1}`),
    "current calibration, traceable standard, approved tolerance, result, or disposition is missing.",
  );
}

function healthcareInfectionControl(inputs: Record<string, unknown>): Evaluation {
  rejectPatientIdentifiers(inputs);
  const devices = records(inputs.devices, "Reprocessing readiness records");
  return coverageEvaluation(
    "infection-control readiness",
    devices,
    (row) => Boolean(row.id && bool(row.classificationApproved) && bool(row.methodApproved) && bool(row.processEvidenceCurrent) && bool(row.exceptionsResolved) && bool(row.releaseApproved)),
    (row, i) => String(row.id ?? `device ${i + 1}`),
    "approved classification/method, current process evidence, exception disposition, or release approval is missing.",
  );
}

function healthcarePatientRisk(inputs: Record<string, unknown>): Evaluation {
  rejectPatientIdentifiers(inputs);
  const hazards = records(inputs.hazards, "Device-related hazard records");
  return coverageEvaluation(
    "patient-risk control",
    hazards,
    (row) => Boolean(row.id && bool(row.consequenceApproved) && bool(row.controlsImplemented) && bool(row.controlsTestCurrent) && bool(row.evidenceBound) && row.residualRisk && bool(row.riskAccepted)),
    (row, i) => String(row.id ?? `hazard ${i + 1}`),
    "approved consequence, implemented/current control, evidence, residual risk, or human acceptance is missing.",
  );
}

function healthcareTraceability(inputs: Record<string, unknown>): Evaluation {
  rejectPatientIdentifiers(inputs);
  const devices = records(inputs.devices, "Device trace records");
  requireUnique(devices.map((row, i) => text(row.id, `Device ${i + 1} ID`)), "Device trace records");
  return coverageEvaluation(
    "device lifecycle trace",
    devices,
    (row) => Boolean(row.id && row.model && row.serialOrUdi && row.location && row.owner && bool(row.configurationControlled) && bool(row.maintenanceLinked) && row.calibrationStatus && bool(row.safetyActionsResolved)),
    (row, i) => String(row.id ?? `device ${i + 1}`),
    "identity, model/serial, location, owner, controlled configuration, service/calibration link, or safety-action status is missing.",
  );
}

function civilStructuralCondition(inputs: Record<string, unknown>): Evaluation {
  const rows = records(inputs.components, "Structural condition records");
  return coverageEvaluation("structural-condition", rows,
    (row) => Boolean(row.id && row.observation && row.observedAt && row.qualifiedInspector && bool(row.severityApproved) && bool(row.configurationCurrent) && bool(row.dispositionApproved)),
    (row, i) => String(row.id ?? `component ${i + 1}`),
    "qualified current observation, approved severity/configuration, or disposition is missing.");
}

function processSafetyBarriers(inputs: Record<string, unknown>): Evaluation {
  const rows = records(inputs.scenarios, "Major-accident scenarios");
  return coverageEvaluation(
    "major-accident scenario barrier",
    rows,
    (row) =>
      Boolean(
        row.id &&
          bool(row.hazardStudyApproved) &&
          bool(row.performanceStandardApproved) &&
          bool(row.ownerAssigned) &&
          bool(row.verificationCurrent) &&
          bool(row.impairmentDispositionApproved) &&
          bool(row.independentlyReviewed),
      ),
    (row, i) => String(row.id ?? `scenario ${i + 1}`),
    "approved hazard/performance basis, owner, current verification, impairment disposition, or independent review is missing.",
  );
}

function pressureContainmentAssurance(
  inputs: Record<string, unknown>,
): Evaluation {
  const rows = records(inputs.boundaries, "Pressure boundaries");
  return coverageEvaluation(
    "pressure-containment boundary",
    rows,
    (row) =>
      Boolean(
        row.id &&
          bool(row.designBasisApproved) &&
          bool(row.inspectionCurrent) &&
          bool(row.anomalyDispositionApproved) &&
          bool(row.reliefProtectionVerified) &&
          bool(row.configurationCurrent) &&
          bool(row.independentlyReviewed),
      ),
    (row, i) => String(row.id ?? `boundary ${i + 1}`),
    "approved design basis, current inspection/configuration, anomaly disposition, relief verification, or independent review is missing.",
  );
}

function sisProofTestAssurance(inputs: Record<string, unknown>): Evaluation {
  const rows = records(inputs.functions, "Safety instrumented functions");
  return coverageEvaluation(
    "safety-instrumented-function",
    rows,
    (row) =>
      Boolean(
        row.id &&
          bool(row.silBasisApproved) &&
          bool(row.proofTestCurrent) &&
          bool(row.demandsReviewed) &&
          bool(row.bypassesControlled) &&
          bool(row.impairmentsDispositioned) &&
          bool(row.configurationCurrent) &&
          bool(row.independentlyReviewed),
      ),
    (row, i) => String(row.id ?? `SIF ${i + 1}`),
    "approved SIL/SRS basis, current proof test, demand review, bypass/impairment control, configuration, or independent review is missing.",
  );
}

function turnaroundReadiness(inputs: Record<string, unknown>): Evaluation {
  const rows = records(inputs.workPackages, "Turnaround work packages");
  return coverageEvaluation(
    "turnaround work-package readiness",
    rows,
    (row) =>
      Boolean(
        row.id &&
          bool(row.scopeApproved) &&
          bool(row.workPackReady) &&
          bool(row.materialsReady) &&
          bool(row.isolationPlanApproved) &&
          bool(row.resourcesConfirmed) &&
          bool(row.scheduleLogicApproved) &&
          bool(row.risksDispositioned) &&
          bool(row.releaseAuthorityNamed),
      ),
    (row, i) => String(row.id ?? `work package ${i + 1}`),
    "approved scope/work pack, materials, isolation plan, resources, schedule logic, risk disposition, or named release authority is missing.",
  );
}

function lossOfContainmentRisk(inputs: Record<string, unknown>): Evaluation {
  const rows = records(inputs.scenarios, "Loss-of-containment scenarios");
  const riskMatrix = object(inputs.riskMatrix, "Approved process-risk matrix");
  const findings: string[] = [];
  const gaps: string[] = [];
  for (const [index, row] of rows.entries()) {
    const id = text(row.id, `Scenario ${index + 1} ID`);
    const likelihood = text(
      row.likelihoodCategory,
      `${id} likelihood category`,
    );
    const consequence = text(
      row.consequenceCategory,
      `${id} consequence category`,
    );
    const matrixKey = `${likelihood}:${consequence}`;
    const rank = riskMatrix[matrixKey];
    if (typeof rank !== "string" || !rank.trim()) {
      gaps.push(`${id}: approved risk matrix has no ${matrixKey} cell.`);
      continue;
    }
    findings.push(`${id}: supplied categories map to ${rank.trim()}.`);
    if (!bool(row.barriersVerified))
      gaps.push(`${id}: credited barriers are not evidenced as verified.`);
    if (!bool(row.emergencyResponseReady))
      gaps.push(`${id}: emergency-response readiness is not evidenced.`);
    if (!bool(row.independentlyReviewed))
      gaps.push(`${id}: independent scenario review is missing.`);
  }
  return {
    summary: `${findings.length} of ${rows.length} loss-of-containment scenario(s) mapped through the supplied approved matrix; no consequence or frequency model was run.`,
    metrics: [
      {
        key: "mapped",
        label: "Matrix-mapped scenarios",
        value: findings.length,
        unit: "count",
      },
      {
        key: "control_gaps",
        label: "Barrier/response/review gaps",
        value: gaps.length,
        unit: "count",
      },
    ],
    findings,
    gaps,
    assumptions: [
      "Likelihood and consequence categories were assigned under the organization's approved method and remain applicable.",
    ],
    formulae: [
      "Risk rank = exact supplied matrix[likelihood category:consequence category] lookup.",
    ],
  };
}

function civilInspectionRating(inputs: Record<string, unknown>): Evaluation {
  const rows = records(inputs.inspections, "Inspection rating records");
  return coverageEvaluation("inspection-rating", rows,
    (row) => Boolean(row.id && row.assetId && row.rating != null && bool(row.scaleApproved) && bool(row.methodApproved) && bool(row.inspectorQualified) && bool(row.reviewed) && bool(row.criticalFollowUpControlled)),
    (row, i) => String(row.id ?? `inspection ${i + 1}`),
    "rating basis, qualified inspection/review, or critical-finding follow-up is missing.");
}

function civilDeterioration(inputs: Record<string, unknown>): Evaluation {
  const rows = records(inputs.series, "Deterioration series");
  const findings: string[] = [];
  const gaps: string[] = [];
  for (const [index, row] of rows.entries()) {
    const id = text(row.id, `Series ${index + 1} ID`);
    const current = finite(row.currentValue, `${id} current value`);
    const rate = finite(row.ratePerYear, `${id} approved rate`);
    const horizon = positive(row.horizonYears, `${id} horizon`);
    text(row.unit, `${id} unit`);
    if (!bool(row.modelApproved) || !bool(row.calibrationCurrent) || !bool(row.applicable)) {
      gaps.push(`${id}: model approval, calibration, or applicability is incomplete.`);
      continue;
    }
    findings.push(`${id}: supplied linear model projects ${round(current + rate * horizon)} ${row.unit} at ${horizon} year(s).`);
  }
  if (!findings.length) throw new InputError("No deterioration series has an approved, current and applicable model.");
  return { summary: `${findings.length} of ${rows.length} supplied deterioration series were projected within their approved model boundary.`, metrics: [{ key: "projected_series", label: "Projected series", value: findings.length, unit: "count" }, { key: "blocked_series", label: "Model-boundary gaps", value: gaps.length, unit: "count" }], findings, gaps, assumptions: ["The supplied linear rates, observation basis, calibration and horizon remain valid for the stated assets and exposures."], formulae: ["Projected value = supplied current value + supplied approved annual rate × supplied horizon."] };
}

function civilLoadRestriction(inputs: Record<string, unknown>): Evaluation {
  const rows = records(inputs.ratings, "Load rating records");
  const findings: string[] = [];
  const gaps: string[] = [];
  let below = 0;
  for (const [index, row] of rows.entries()) {
    const id = text(row.id, `Rating ${index + 1} ID`);
    const factor = finite(row.ratingFactor, `${id} rating factor`);
    const criterion = positive(row.approvedCriterion, `${id} approved criterion`);
    if (!bool(row.analysisCurrent) || !bool(row.authorityApproved)) gaps.push(`${id}: current qualified analysis or authority approval is missing.`);
    if (factor < criterion) { below += 1; findings.push(`${id}: supplied rating factor is ${round(factor - criterion)} below the supplied criterion.`); }
    else findings.push(`${id}: supplied rating factor is ${round(factor - criterion)} above the supplied criterion.`);
    if (bool(row.restrictionRequired) && !bool(row.restrictionImplemented)) gaps.push(`${id}: authority-required restriction is not evidenced as implemented.`);
  }
  return { summary: `${rows.length} qualified load-rating record(s) were screened against supplied criteria; no load rating was performed by SyncAI.`, metrics: [{ key: "ratings", label: "Rating records", value: rows.length, unit: "count" }, { key: "below_criterion", label: "Below supplied criterion", value: below, unit: "count" }, { key: "control_gaps", label: "Authority/control gaps", value: gaps.length, unit: "count" }], findings, gaps, assumptions: ["Rating factors and criteria come from the same current, qualified load case and approved analysis."], formulae: ["Criterion margin = supplied rating factor - supplied approved criterion."] };
}

function civilGeographicRisk(inputs: Record<string, unknown>): Evaluation {
  const rows = records(inputs.overlays, "Asset hazard overlays");
  return coverageEvaluation("geographic-hazard overlay", rows,
    (row) => Boolean(row.id && bool(row.assetGeometryControlled) && bool(row.crsMatched) && bool(row.layerApproved) && bool(row.metadataCurrent) && bool(row.resolutionAccepted) && bool(row.overlapMethodApproved) && bool(row.reviewed)),
    (row, i) => String(row.id ?? `overlay ${i + 1}`),
    "controlled geometry/CRS, approved current layer metadata/resolution/method, or review is missing.");
}

function civilRenewalPlanning(inputs: Record<string, unknown>): Evaluation {
  const budget = positive(inputs.budget, "Indicative planning envelope");
  const weights = records(inputs.weights, "Approved renewal weights");
  const factorWeights = new Map<string, number>();
  for (const [index, row] of weights.entries()) factorWeights.set(text(row.factor, `Weight ${index + 1} factor`), nonNegative(row.weight, `Weight ${index + 1}`));
  if (![...factorWeights.values()].some((value) => value > 0)) throw new InputError("At least one approved renewal weight must be positive.");
  const candidates = records(inputs.candidates, "Renewal candidates");
  const gaps: string[] = [];
  const ranked = candidates.flatMap((row, index) => {
    const id = text(row.id, `Candidate ${index + 1} ID`);
    const cost = positive(row.cost, `${id} cost`);
    if (!bool(row.evidenceReady)) { gaps.push(`${id}: evidence is not ready for comparison.`); return []; }
    const benefit = [...factorWeights].reduce((sum, [factor, weight]) => {
      const score = finite(row[factor], `${id} ${factor} score`);
      if (score < 0 || score > 5) throw new InputError(`${id} ${factor} score must be between 0 and 5.`);
      return sum + score * weight;
    }, 0);
    const mandatory = bool(row.mandatory);
    const due = mandatory ? isoDate(row.dueDate, `${id} due date`).getTime() : Number.POSITIVE_INFINITY;
    return [{ id, cost, mandatory, due, priority: benefit / cost }];
  });
  if (!ranked.length) throw new InputError("No renewal candidate is evidence-ready.");
  ranked.sort((a, b) => Number(b.mandatory) - Number(a.mandatory) || (a.mandatory && b.mandatory ? a.due - b.due : 0) || b.priority - a.priority || a.id.localeCompare(b.id));
  let cumulative = 0;
  const findings = ranked.map((row, index) => { cumulative += row.cost; return `${index + 1}. ${row.id} · ${row.mandatory ? "MANDATORY — not economically deferrable" : `weighted benefit/cost ${round(row.priority, 6)}`} · ${cumulative <= budget ? "inside" : "outside"} indicative envelope.`; });
  return { summary: `${ranked.length} evidence-ready renewal candidate(s) were ordered; the result is not expenditure or deferral authority.`, metrics: [{ key: "candidates", label: "Evidence-ready candidates", value: ranked.length, unit: "count" }, { key: "mandatory", label: "Mandatory candidates", value: ranked.filter((row) => row.mandatory).length, unit: "count" }, { key: "budget", label: "Indicative envelope", value: budget, unit: "supplied currency" }], findings, gaps, assumptions: ["Mandatory status, due dates, factor scores, weights, costs and dependencies are current and approved."], formulae: ["Non-mandatory priority = Σ(supplied factor score × approved weight) / supplied cost; mandatory candidates remain first."] };
}

const evaluators: Partial<
  Record<string, (inputs: Record<string, unknown>) => Evaluation>
> = {
  "tailings-geotechnical": tailings,
  "well-integrity": wellIntegrity,
  "rbi-corrosion-loop": rbi,
  "process-safety-barriers": processSafetyBarriers,
  "pressure-containment-assurance": pressureContainmentAssurance,
  "sis-proof-test-assurance": sisProofTestAssurance,
  "turnaround-readiness": turnaroundReadiness,
  "loss-of-containment-risk": lossOfContainmentRisk,
  "storm-crew-dispatch": stormDispatch,
  "line-balancing": lineBalancing,
  "robot-health": robotHealth,
  "haccp-verification": haccp,
  "cip-validation": cip,
  "cold-chain": coldChain,
  "gxp-validation": gxp,
  "batch-record": batchRecord,
  "route-depot-optimization": routeOptimization,
  "inspection-scheduling": inspectionSchedule,
  "airworthiness-compliance": airworthiness,
  "msg3-trace": msg3,
  "life-limited-part": lifeLimitedPart,
  "class-survey-scheduling": classSurvey,
  "propulsion-efficiency": propulsion,
  "voyage-optimization": voyage,
  "thermal-airflow": thermal,
  "mission-readiness": missionReadiness,
  "milspec-configuration": milspec,
  "classified-deployment": classifiedDeployment,
  "reuse-life": reuseLife,
  "range-safety": rangeSafety,
  "propellant-degradation": propellant,
  "battery-thermal-envelope": batteryThermal,
  "battery-hv-safety": batteryHvSafety,
  "battery-degradation": batteryDegradation,
  "battery-fire-readiness": batteryFireReadiness,
  "clinical-criticality": healthcareClinicalCriticality,
  "device-availability": healthcareAvailability,
  "calibration-assurance": healthcareCalibration,
  "infection-control-readiness": healthcareInfectionControl,
  "patient-risk": healthcarePatientRisk,
  "device-traceability": healthcareTraceability,
  "structural-condition": civilStructuralCondition,
  "inspection-rating": civilInspectionRating,
  "deterioration-forecast": civilDeterioration,
  "load-restriction": civilLoadRestriction,
  "geographic-risk": civilGeographicRisk,
  "renewal-planning": civilRenewalPlanning,
  "code-compliance": codeCompliance,
  "fire-life-safety": fireLifeSafety,
  "occupancy-accessibility": occupancy,
  "occupant-environment": occupantEnvironment,
  "bas-control-integrity": basControlIntegrity,
  "energy-water-performance": energyWaterPerformance,
  "facility-renewal-priority": facilityRenewalPriority,
};

function present(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

export function evaluateDomainSpecialist(
  request: DomainSpecialistRequest,
): DomainSpecialistResult {
  const module = getDomainSpecialistModule(request.moduleKey);
  const method = getDomainSpecialistMethod(
    request.moduleKey,
    request.methodKey,
  );
  const modelKey = `domain.${request.moduleKey}.${request.methodKey}`;
  const base = {
    moduleKey: request.moduleKey,
    methodKey: request.methodKey,
    modelKey,
    modelVersion: module?.version ?? "unknown",
    requiredApproverRole:
      method?.requiredApproverRole ?? "Authorized domain technical authority",
    requiredApproverRoleKey:
      module?.reviewerRoleKey ?? "domain_specialist_reviewer",
    authorityBoundary:
      "This output is a non-authoritative draft. It cannot certify compliance, approve a limit, release an asset/product/facility, dispatch resources, or authorize operation. The named human authority must verify evidence, applicability, method, assumptions, and consequence before action.",
    humanApprovalRequired: true as const,
    authoritative: false as const,
  };
  if (!module || !method) {
    return {
      ...base,
      status: "blocked",
      summary: "The requested specialist module or method is not registered.",
      metrics: [],
      findings: [],
      gaps: ["Use a method from the governed domain specialist registry."],
      assumptions: [],
      formulae: [],
    };
  }
  const missingInputs = method.requiredInputs
    .filter((input) => !present(request.inputs[input.key]))
    .map((input) => `Missing required input: ${input.label} (${input.key}).`);
  const evidenceByKey = new Map(
    request.evidence.map((item) => [item.key, item]),
  );
  const duplicateEvidence = request.evidence
    .map((item) => item.key)
    .filter((key, index, keys) => keys.indexOf(key) !== index)
    .map((key) => `Duplicate evidence binding: ${key}.`);
  const missingEvidence = method.requiredEvidence.flatMap((key) => {
    const reference = evidenceByKey.get(key);
    if (!reference?.sourceReference?.trim())
      return [`Missing required evidence reference: ${key}.`];
    if (!UUID.test(reference.evidenceItemId))
      return [`Missing canonical evidence binding: ${key}.`];
    return [];
  });
  const evaluator = evaluators[method.key];
  if (
    missingInputs.length ||
    missingEvidence.length ||
    duplicateEvidence.length ||
    !evaluator
  ) {
    return {
      ...base,
      status: "blocked",
      summary:
        "The specialist refused to calculate because required inputs, evidence provenance, or an executable evaluator is missing.",
      metrics: [],
      findings: [],
      gaps: [
        ...missingInputs,
        ...missingEvidence,
        ...duplicateEvidence,
        ...(evaluator
          ? []
          : ["No executable evaluator is registered for this method."]),
      ],
      assumptions: [],
      formulae: [],
    };
  }
  try {
    const evaluation = evaluator(request.inputs);
    return { ...base, status: "draft", ...evaluation };
  } catch (cause) {
    return {
      ...base,
      status: "blocked",
      summary:
        "The specialist refused to calculate because the supplied input contract is invalid.",
      metrics: [],
      findings: [],
      gaps: [
        cause instanceof Error ? cause.message : "Invalid specialist input.",
      ],
      assumptions: [],
      formulae: [],
    };
  }
}

export function registeredDomainEvaluatorKeys(): string[] {
  return Object.keys(evaluators).sort();
}
