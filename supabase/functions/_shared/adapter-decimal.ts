// Exact source decimal arithmetic shared by SAP stock and G/L adapters.
export interface ExactDecimal {
  coefficient: bigint;
  scale: number;
}

export function signedAmount(value: unknown, label: string): ExactDecimal {
  if (typeof value === "number" && !Number.isSafeInteger(value)) {
    throw new Error(
      `${label} must be supplied as an exact decimal string or safe integer.`,
    );
  }
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^-?\d+(?:\.\d+)?$/.test(raw.trim())) {
    throw new Error(`${label} must be an exact finite decimal.`);
  }
  const normalized = raw.trim();
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ""] = unsigned.split(".");
  if (whole.length + fraction.length > 50 || fraction.length > 18) {
    throw new Error(`${label} exceeds the supported exact-decimal envelope.`);
  }
  const coefficient = BigInt(`${negative ? "-" : ""}${whole}${fraction}`);
  return { coefficient, scale: fraction.length };
}

export function addDecimal(
  left: ExactDecimal,
  right: ExactDecimal,
): ExactDecimal {
  const scale = Math.max(left.scale, right.scale);
  return {
    coefficient:
      left.coefficient * 10n ** BigInt(scale - left.scale) +
      right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  };
}

export function decimalText(value: ExactDecimal): string {
  const negative = value.coefficient < 0n;
  const absolute = (negative ? -value.coefficient : value.coefficient)
    .toString()
    .padStart(value.scale + 1, "0");
  const whole = value.scale ? absolute.slice(0, -value.scale) : absolute;
  const fraction = value.scale
    ? absolute.slice(-value.scale).replace(/0+$/, "")
    : "";
  const rendered = fraction ? `${whole}.${fraction}` : whole;
  return `${negative && value.coefficient !== 0n ? "-" : ""}${rendered}`;
}
