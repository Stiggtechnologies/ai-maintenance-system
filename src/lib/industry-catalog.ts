/**
 * Canonical, lightweight industry identities used across signup, onboarding,
 * and governed risk configuration. Domain packs and executable profiles bind
 * to these identities; they must not define competing UI taxonomies.
 */
export const INDUSTRY_CATALOG = [
  { code: "oil_sands", label: "Oil Sands", kind: "pack" },
  { code: "mining", label: "Mining", kind: "pack" },
  { code: "oil_gas", label: "Oil & Gas", kind: "pack" },
  { code: "petrochemical", label: "Petrochemical", kind: "pack" },
  { code: "power_generation", label: "Power Generation", kind: "pack" },
  {
    code: "battery_energy_storage",
    label: "Battery & Energy Storage",
    kind: "pack",
  },
  { code: "utilities", label: "Utilities", kind: "pack" },
  { code: "manufacturing", label: "Manufacturing", kind: "pack" },
  { code: "food_beverage", label: "Food & Beverage", kind: "pack" },
  { code: "pharmaceuticals", label: "Pharmaceuticals", kind: "pack" },
  { code: "healthcare", label: "Healthcare", kind: "pack" },
  {
    code: "transportation_logistics",
    label: "Transportation & Logistics",
    kind: "pack",
  },
  { code: "aviation", label: "Aviation", kind: "pack" },
  { code: "marine_shipping", label: "Marine Shipping", kind: "pack" },
  { code: "data_centers", label: "Data Centers", kind: "pack" },
  { code: "defense", label: "Defense", kind: "pack" },
  { code: "aerospace_launch", label: "Aerospace & Launch", kind: "pack" },
  {
    code: "buildings_infrastructure",
    label: "Buildings & Infrastructure",
    kind: "pack",
  },
  { code: "civil_infrastructure", label: "Civil Infrastructure", kind: "pack" },
  { code: "custom", label: "Custom / Other", kind: "custom" },
] as const;

export type IndustryCatalogEntry = (typeof INDUSTRY_CATALOG)[number];
export type IndustryCode = IndustryCatalogEntry["code"];
export type TemplateIndustryCode = Exclude<IndustryCode, "custom">;

const INDUSTRY_BY_CODE = new Map<string, IndustryCatalogEntry>(
  INDUSTRY_CATALOG.map((entry) => [entry.code, entry]),
);

/** Legacy UI and public-demo identifiers that have an exact catalog meaning. */
export const INDUSTRY_CODE_ALIASES: Readonly<Record<string, IndustryCode>> = {
  "oil-sands": "oil_sands",
  oilsands: "oil_sands",
  "oil-gas": "oil_gas",
  power: "power_generation",
  "power-generation": "power_generation",
  battery: "battery_energy_storage",
  batteries: "battery_energy_storage",
  "battery-energy-storage": "battery_energy_storage",
  "energy-storage": "battery_energy_storage",
  bess: "battery_energy_storage",
  pharma: "pharmaceuticals",
  hospital: "healthcare",
  hospitals: "healthcare",
  "clinical-engineering": "healthcare",
  "food-beverage": "food_beverage",
  "transportation-logistics": "transportation_logistics",
  marine: "marine_shipping",
  "marine-shipping": "marine_shipping",
  "data-centers": "data_centers",
  military: "defense",
  aerospace: "aerospace_launch",
  "aerospace-launch": "aerospace_launch",
  "buildings-infrastructure": "buildings_infrastructure",
  civil: "civil_infrastructure",
  infrastructure: "civil_infrastructure",
  "civil-infrastructure": "civil_infrastructure",
  other: "custom",
};

export function normalizeIndustryCode(industryCode: string): string {
  const normalized = industryCode.trim().toLowerCase();
  if (normalized.startsWith("custom:")) {
    return `custom:${industryCode.trim().slice("custom:".length).trim()}`;
  }
  return INDUSTRY_CODE_ALIASES[normalized] ?? normalized;
}

export function getIndustryCatalogEntry(
  industryCode: string,
): IndustryCatalogEntry | null {
  const normalized = normalizeIndustryCode(industryCode);
  if (normalized.startsWith("custom:")) {
    return INDUSTRY_BY_CODE.get("custom") ?? null;
  }
  return INDUSTRY_BY_CODE.get(normalized) ?? null;
}

export function getIndustryLabel(industryCode: string): string {
  const normalized = normalizeIndustryCode(industryCode);
  if (normalized.startsWith("custom:")) {
    const customLabel = normalized.slice("custom:".length).trim();
    return customLabel ? `${customLabel} (Custom)` : "Custom / Other";
  }
  return getIndustryCatalogEntry(normalized)?.label ?? industryCode;
}

export function toStoredIndustryCode(
  industryCode: string,
  customLabel: string,
): string {
  const normalizedIndustryCode = normalizeIndustryCode(industryCode);
  if (normalizedIndustryCode !== "custom") return normalizedIndustryCode;
  const normalizedLabel = customLabel.trim().replace(/\s+/g, " ");
  if (!normalizedLabel) return "custom";
  return `custom:${normalizedLabel.slice(0, 120)}`;
}

export const SIGNUP_INDUSTRY_OPTIONS = INDUSTRY_CATALOG.map((entry) => ({
  value: entry.code,
  label:
    entry.kind === "custom" ? "Other asset-intensive industry" : entry.label,
}));
