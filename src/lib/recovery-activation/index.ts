export type RecoveryActivationEntity =
  | "site"
  | "asset"
  | "work_order"
  | "material"
  | "material_stock"
  | "craft_capacity"
  | "operating_state"
  | "production_record";

export interface RecoveryActivationField {
  key: string;
  label: string;
  required?: boolean;
  aliases: string[];
}

export interface RecoveryActivationEntityDefinition {
  id: RecoveryActivationEntity;
  label: string;
  description: string;
  fields: RecoveryActivationField[];
}

const field = (
  key: string,
  label: string,
  required: boolean,
  aliases: string[],
): RecoveryActivationField => ({ key, label, required, aliases });

export const RECOVERY_ACTIVATION_ENTITIES: RecoveryActivationEntityDefinition[] =
  [
    {
      id: "site",
      label: "Sites",
      description:
        "Tenant locations that own assets, stock, crews and production.",
      fields: [
        field("external_id", "Stable source ID", true, [
          "site id",
          "site code",
          "location id",
        ]),
        field("name", "Site name", true, [
          "site",
          "site name",
          "location name",
        ]),
        field("code", "Site code", false, ["code", "location code"]),
        field("location", "Location", false, ["location", "address", "region"]),
      ],
    },
    {
      id: "asset",
      label: "Assets",
      description: "Canonical tenant assets linked to a known site.",
      fields: [
        field("external_id", "Stable source ID", true, [
          "equipment id",
          "asset id",
          "equipment code",
        ]),
        field("name", "Asset name", true, [
          "equipment name",
          "asset name",
          "description",
        ]),
        field("site_external_id", "Site source ID", true, [
          "site id",
          "site code",
          "location id",
        ]),
        field("tag", "Tag", false, ["asset tag", "equipment tag", "tag"]),
        field("asset_class", "Asset class", false, [
          "asset type",
          "equipment type",
          "class",
        ]),
        field("criticality", "Criticality", false, [
          "criticality",
          "criticality code",
        ]),
        field("status", "Status", false, [
          "asset status",
          "equipment status",
          "status",
        ]),
        field("area", "Area", false, ["area", "plant area"]),
        field("system", "System", false, ["system", "functional location"]),
        field("manufacturer", "Manufacturer", false, ["manufacturer", "make"]),
        field("model", "Model", false, ["model", "model number"]),
        field("serial_number", "Serial number", false, [
          "serial",
          "serial number",
        ]),
      ],
    },
    {
      id: "work_order",
      label: "Work orders",
      description:
        "Open and historical CMMS/EAM work against canonical assets.",
      fields: [
        field("external_id", "Stable source ID", true, [
          "work order id",
          "wo id",
          "order id",
        ]),
        field("title", "Title", true, [
          "description",
          "work order description",
          "short text",
        ]),
        field("asset_external_id", "Asset source ID", true, [
          "equipment id",
          "asset id",
          "equipment code",
        ]),
        field("wo_number", "Work-order number", false, [
          "work order",
          "wo number",
          "order number",
        ]),
        field("status", "Status", false, ["status", "system status"]),
        field("priority", "Priority", false, ["priority", "priority code"]),
        field("work_type", "Work type", false, [
          "work type",
          "order type",
          "maintenance type",
        ]),
        field("planned_hours", "Planned hours", false, [
          "planned hours",
          "estimated hours",
          "duration hours",
        ]),
        field("created_at", "Created at", false, [
          "created at",
          "created date",
          "raised at",
        ]),
        field("completed_at", "Completed at", false, [
          "completed at",
          "completion date",
          "closed at",
        ]),
        field("failure_mode", "Raw failure label", false, [
          "failure mode",
          "problem code",
          "failure code",
        ]),
        field("downtime_hours", "Downtime hours", false, [
          "downtime hours",
          "down hours",
        ]),
      ],
    },
    {
      id: "material",
      label: "Materials",
      description: "The tenant MRO catalogue; no stock quantity is inferred.",
      fields: [
        field("external_id", "Stable source ID", true, [
          "material id",
          "part id",
          "item id",
        ]),
        field("material_code", "Material code", true, [
          "material code",
          "part number",
          "item number",
        ]),
        field("description", "Description", true, [
          "description",
          "material description",
          "part description",
        ]),
        field("unit_of_measure", "Unit of measure", true, [
          "uom",
          "unit",
          "unit of measure",
        ]),
        field("category", "Category", false, [
          "category",
          "material group",
          "commodity",
        ]),
        field("unit_cost_usd", "Unit cost (USD)", false, [
          "unit cost",
          "cost",
          "standard price",
        ]),
        field("lead_time_days", "Lead time days", false, [
          "lead time",
          "lead time days",
        ]),
        field("criticality", "Criticality", false, [
          "criticality",
          "spare criticality",
        ]),
        field("basis", "Evidence basis", true, [
          "basis",
          "source",
          "catalogue source",
        ]),
      ],
    },
    {
      id: "material_stock",
      label: "Material stock",
      description: "Site-level on-hand, reserved and ordered quantities.",
      fields: [
        field("external_id", "Stable source ID", true, [
          "stock id",
          "inventory id",
          "record id",
        ]),
        field("material_external_id", "Material source ID", true, [
          "material id",
          "part id",
          "item id",
        ]),
        field("site_external_id", "Site source ID", true, [
          "site id",
          "site code",
          "location id",
        ]),
        field("qty_on_hand", "Quantity on hand", true, [
          "on hand",
          "qty on hand",
          "available quantity",
        ]),
        field("qty_reserved", "Quantity reserved", false, [
          "reserved",
          "qty reserved",
        ]),
        field("qty_on_order", "Quantity on order", false, [
          "on order",
          "qty on order",
        ]),
        field("last_counted_at", "Last counted at", false, [
          "last counted",
          "count date",
          "updated at",
        ]),
      ],
    },
    {
      id: "craft_capacity",
      label: "Crew capacity",
      description:
        "Operator-supplied deliverable craft hours, with stated basis.",
      fields: [
        field("external_id", "Stable source ID", true, [
          "capacity id",
          "crew id",
          "record id",
        ]),
        field("site_external_id", "Site source ID", true, [
          "site id",
          "site code",
          "location id",
        ]),
        field("craft", "Craft", true, ["craft", "trade", "discipline"]),
        field("weekly_hours", "Deliverable weekly hours", true, [
          "weekly hours",
          "available hours",
          "capacity hours",
        ]),
        field("effective_from", "Effective from", true, [
          "effective from",
          "effective date",
          "week start",
        ]),
        field("basis", "Capacity basis", true, [
          "basis",
          "capacity basis",
          "source",
        ]),
      ],
    },
    {
      id: "operating_state",
      label: "Operating state",
      description: "Time-bounded asset state used to identify real downtime.",
      fields: [
        field("external_id", "Stable source ID", true, [
          "state id",
          "event id",
          "record id",
        ]),
        field("asset_external_id", "Asset source ID", true, [
          "equipment id",
          "asset id",
          "equipment code",
        ]),
        field("state", "State", true, [
          "state",
          "operating state",
          "equipment state",
        ]),
        field("started_at", "Started at", true, [
          "started at",
          "start time",
          "from",
        ]),
        field("ended_at", "Ended at", false, ["ended at", "end time", "to"]),
        field("load_pct", "Load percent", false, [
          "load percent",
          "load pct",
          "utilization",
        ]),
        field("reason_code", "Reason code", false, [
          "reason",
          "reason code",
          "downtime code",
        ]),
      ],
    },
    {
      id: "production_record",
      label: "Production",
      description:
        "Measured asset- or site-level production with explicit units.",
      fields: [
        field("external_id", "Stable source ID", true, [
          "production id",
          "record id",
          "period id",
        ]),
        field("site_external_id", "Site source ID", false, [
          "site id",
          "site code",
          "location id",
        ]),
        field("asset_external_id", "Asset source ID", false, [
          "equipment id",
          "asset id",
          "equipment code",
        ]),
        field("period_start", "Period start", true, [
          "period start",
          "start time",
          "from",
        ]),
        field("period_end", "Period end", true, [
          "period end",
          "end time",
          "to",
        ]),
        field("units_produced", "Units produced", true, [
          "units produced",
          "quantity",
          "production",
        ]),
        field("unit_of_measure", "Unit of measure", true, [
          "uom",
          "unit",
          "unit of measure",
        ]),
      ],
    },
  ];

function normalizedHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

export function getRecoveryActivationEntity(
  entity: RecoveryActivationEntity,
): RecoveryActivationEntityDefinition {
  const definition = RECOVERY_ACTIVATION_ENTITIES.find(
    (item) => item.id === entity,
  );
  if (!definition)
    throw new Error(`Unsupported Recovery activation entity: ${entity}`);
  return definition;
}

export function autoMapRecoveryHeaders(
  entity: RecoveryActivationEntity,
  headers: string[],
): Record<string, string> {
  const normalized = new Map(
    headers.map((header) => [normalizedHeader(header), header]),
  );
  const mapping: Record<string, string> = {};
  for (const target of getRecoveryActivationEntity(entity).fields) {
    const candidates = [target.key, target.label, ...target.aliases].map(
      normalizedHeader,
    );
    const match = candidates
      .map((candidate) => normalized.get(candidate))
      .find(Boolean);
    if (match) mapping[target.key] = match;
  }
  return mapping;
}

export function applyRecoveryMapping(
  source: Record<string, unknown>,
  mapping: Record<string, string>,
  valueMaps: Record<string, Record<string, string>> = {},
  constants: Record<string, unknown> = {},
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [target, sourceField] of Object.entries(mapping)) {
    const value = source[sourceField];
    if (value === undefined || value === null || value === "") continue;
    const vocabulary = valueMaps[target];
    mapped[target] = vocabulary?.[String(value)] ?? value;
  }
  for (const [target, value] of Object.entries(constants)) {
    if (value !== undefined && value !== null && value !== "")
      mapped[target] = value;
  }
  return mapped;
}

export function extractRecoveryRows(
  payload: unknown,
  sourceArrayPath = "",
): Array<Record<string, unknown>> {
  let value = payload;
  for (const segment of sourceArrayPath
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(
        `Configured JSON array path "${sourceArrayPath}" does not exist.`,
      );
    }
    value = (value as Record<string, unknown>)[segment];
  }
  if (!Array.isArray(value)) {
    throw new Error(
      `Configured JSON array path "${sourceArrayPath || "(root)"}" is not a JSON array.`,
    );
  }
  if (
    value.some((row) => !row || typeof row !== "object" || Array.isArray(row))
  ) {
    throw new Error("Every source row must be a JSON object.");
  }
  return value as Array<Record<string, unknown>>;
}

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".local")
  )
    return true;
  if (lower === "::1" || lower === "0.0.0.0") return true;
  const octets = lower.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return false;
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    octets[0] === 0 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function isAllowedRecoveryEndpoint(
  endpoint: string,
  allowedHosts: string[],
): { allowed: boolean; hostname: string | null; reason?: string } {
  try {
    const url = new URL(endpoint);
    const hostname = url.hostname.toLowerCase();
    const allowlist = new Set(
      allowedHosts.map((host) => host.trim().toLowerCase()).filter(Boolean),
    );
    if (url.protocol !== "https:")
      return {
        allowed: false,
        hostname,
        reason: "Only HTTPS endpoints are allowed.",
      };
    if (url.username || url.password)
      return {
        allowed: false,
        hostname,
        reason: "Credentials cannot appear in the endpoint URL.",
      };
    if (url.port && url.port !== "443")
      return {
        allowed: false,
        hostname,
        reason: "Only the standard HTTPS port is allowed.",
      };
    if (isPrivateHostname(hostname))
      return {
        allowed: false,
        hostname,
        reason: "Private or local network endpoints are blocked.",
      };
    if (!allowlist.has(hostname))
      return {
        allowed: false,
        hostname,
        reason: "Endpoint hostname is not in the deployment allowlist.",
      };
    return { allowed: true, hostname };
  } catch {
    return {
      allowed: false,
      hostname: null,
      reason: "Endpoint is not a valid URL.",
    };
  }
}
