/**
 * guard-anomaly-v1
 *
 * Statistical screening of seeded or simulated telemetry, plus an explicitly
 * synthetic access event. This is not an equipment limit and not a claim
 * about a live plant. Z-score uses the sample standard deviation of earlier
 * good readings. A limit breach uses only the sensor's stored alarm_limit.
 * Direct plant execution is not a result this detector can produce.
 */

export const GUARD_ANOMALY_RULE = "guard-anomaly-v1";
export const MIN_BASELINE_SAMPLES = 8;
export const DEFAULT_Z_THRESHOLD = 3;
export const MAX_FINDINGS_PER_SCAN = 20;

export interface GuardReading {
  sensorId: string;
  assetId: string | null;
  sensorName: string;
  assetName: string | null;
  value: number;
  takenAt: string;
  quality: "good" | "suspect" | "bad" | "substituted";
}

export interface GuardSensorLimit {
  sensorId: string;
  alarmLimit: number | null;
  limitDirection: "above" | "below";
}

export interface GuardAnomalyFinding {
  sourceFindingId: string;
  sensorId: string | null;
  assetId: string | null;
  title: string;
  issue: string;
  action: string;
  evidenceType: "telemetry_anomaly" | "synthetic_security_event";
  evidence: string;
  urgency: "advisory" | "action";
  plantExecution: "disabled";
}

export interface GuardAnomalyInput {
  readings: GuardReading[];
  limits: GuardSensorLimit[];
  /** UTC day stamp used so the same sensor is not raised twice in one day. */
  day: string;
  zThreshold?: number;
  includeSynthetic?: boolean;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStdev(values: number[]): number {
  const mu = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - mu) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

export function detectGuardAnomalies(
  input: GuardAnomalyInput,
): GuardAnomalyFinding[] {
  const zThreshold = input.zThreshold ?? DEFAULT_Z_THRESHOLD;
  if (!Number.isFinite(zThreshold) || zThreshold < 2 || zThreshold > 6) {
    throw new Error("z_threshold_out_of_range");
  }
  const limits = new Map(input.limits.map((limit) => [limit.sensorId, limit]));
  const bySensor = new Map<string, GuardReading[]>();
  for (const reading of input.readings) {
    if (reading.quality !== "good" || !Number.isFinite(reading.value)) continue;
    const rows = bySensor.get(reading.sensorId) ?? [];
    rows.push(reading);
    bySensor.set(reading.sensorId, rows);
  }

  const findings: GuardAnomalyFinding[] = [];
  for (const [sensorId, rows] of bySensor) {
    if (findings.length >= MAX_FINDINGS_PER_SCAN) break;
    const ordered = [...rows].sort((a, b) => a.takenAt.localeCompare(b.takenAt));
    const latest = ordered[ordered.length - 1];
    const baseline = ordered.slice(0, -1).map((row) => row.value);
    const limit = limits.get(sensorId);
    const direction = limit?.limitDirection ?? "above";
    const limitBreach =
      limit?.alarmLimit != null &&
      (direction === "below"
        ? latest.value <= limit.alarmLimit
        : latest.value >= limit.alarmLimit);
    const zReady = baseline.length >= MIN_BASELINE_SAMPLES;
    const sigma = zReady ? sampleStdev(baseline) : 0;
    const mu = zReady ? mean(baseline) : null;
    const zBreach =
      zReady && sigma > 0 && mu != null && Math.abs(latest.value - mu) / sigma >= zThreshold;
    if (!limitBreach && !zBreach) continue;
    const name = latest.sensorName;
    const where = latest.assetName ? ` on ${latest.assetName}` : "";
    const parts = [
      limitBreach
        ? `latest ${latest.value} crossed the stored alarm_limit ${limit?.alarmLimit} (${direction})`
        : null,
      zBreach && mu != null
        ? `latest ${latest.value} is ${((latest.value - mu) / sigma).toFixed(2)} sample standard deviations from the prior mean ${mu.toFixed(2)} (n=${baseline.length})`
        : null,
    ].filter(Boolean);
    findings.push({
      sourceFindingId: `syncai-guard:sensor:${sensorId}:${input.day}`,
      sensorId,
      assetId: latest.assetId,
      title: `Review anomalous ${name}${where}`,
      issue: `${name}${where}: ${parts.join("; ")}. Rule ${GUARD_ANOMALY_RULE}. This is a screening finding from recorded readings, not a diagnosed failure and not a plant command.`,
      action:
        "Have a named approver review the evidence and decide whether maintenance follow-up is warranted. Do not command plant equipment from this finding.",
      evidenceType: "telemetry_anomaly",
      evidence: parts.join("; "),
      urgency: limitBreach ? "action" : "advisory",
      plantExecution: "disabled",
    });
  }

  if (input.includeSynthetic !== false && findings.length < MAX_FINDINGS_PER_SCAN) {
    findings.push({
      sourceFindingId: `syncai-guard:synthetic:auth-burst:${input.day}`,
      sensorId: null,
      assetId: null,
      title: "Review synthetic authentication-failure burst",
      issue:
        "Synthetic security event for this organization: repeated failed authentications against the seeded historian read path. Not a live plant incident and not customer telemetry.",
      action:
        "Have a named approver confirm whether the seeded access trail needs follow-up. Do not command plant equipment.",
      evidenceType: "synthetic_security_event",
      evidence:
        "Synthetic series of failed sign-in attempts. Generated by SyncAI Guard so the approval loop can be exercised without a live security feed.",
      urgency: "advisory",
      plantExecution: "disabled",
    });
  }

  return findings.slice(0, MAX_FINDINGS_PER_SCAN);
}
