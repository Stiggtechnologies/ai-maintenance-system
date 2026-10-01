/** Parse the human-facing bucket=count capture format without guessing. */
export function parseMonitoringDistribution(
  source: string,
): Record<string, number> {
  const distribution: Record<string, number> = {};
  for (const rawLine of source.split(/\r?\n|,/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([^:=]+)\s*[:=]\s*(\d+(?:\.\d+)?)$/.exec(line);
    if (!match) {
      throw new Error(
        `“${line}” is not a bucket=count entry (for example: normal=42).`,
      );
    }
    const bucket = match[1].trim();
    const count = Number(match[2]);
    if (!bucket || !Number.isFinite(count) || count < 0) {
      throw new Error("Every bucket requires a name and non-negative count.");
    }
    if (Object.hasOwn(distribution, bucket)) {
      throw new Error(`Bucket “${bucket}” appears more than once.`);
    }
    distribution[bucket] = count;
  }
  if (Object.keys(distribution).length < 2) {
    throw new Error("Enter at least two distribution buckets.");
  }
  if (Object.values(distribution).reduce((sum, count) => sum + count, 0) <= 0) {
    throw new Error("The distribution total must be greater than zero.");
  }
  return distribution;
}
