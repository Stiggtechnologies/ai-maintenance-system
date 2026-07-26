import type {
  AssetClassTemplate,
  ComponentTemplate,
  CustomerAssetTwinInstance,
  OemModelOverlay,
} from "./types";

export interface CompiledAssetTwin {
  schemaVersion: string;
  compiledAt: string;
  asset: CustomerAssetTwinInstance;
  template: AssetClassTemplate;
  provenance: {
    assetClassCode: string;
    overlay?: { manufacturer: string; model: string; schemaVersion: string };
    customerOverrideKeys: string[];
  };
}

function mergeComponent(
  component: ComponentTemplate,
  overlay?: Partial<ComponentTemplate>,
): ComponentTemplate {
  if (!overlay) return structuredClone(component);
  return {
    ...component,
    ...overlay,
    functions: overlay.functions ?? component.functions,
    telemetryConcepts: overlay.telemetryConcepts ?? component.telemetryConcepts,
    inspectionZones: overlay.inspectionZones ?? component.inspectionZones,
    failureModes: overlay.failureModes ?? component.failureModes,
  };
}

export function compileAssetTwin(
  template: AssetClassTemplate,
  asset: CustomerAssetTwinInstance,
  overlay?: OemModelOverlay,
  now = new Date(),
): CompiledAssetTwin {
  if (asset.assetClassCode !== template.code) {
    throw new Error(`Asset class ${asset.assetClassCode} does not match template ${template.code}`);
  }
  if (overlay && overlay.assetClassCode !== template.code) {
    throw new Error(`Overlay ${overlay.model} does not apply to ${template.code}`);
  }
  if (overlay && asset.manufacturer && overlay.manufacturer !== asset.manufacturer) {
    throw new Error(`Overlay manufacturer ${overlay.manufacturer} does not match ${asset.manufacturer}`);
  }
  if (overlay && asset.model && overlay.model !== asset.model && !overlay.aliases?.includes(asset.model)) {
    throw new Error(`Overlay model ${overlay.model} does not match ${asset.model}`);
  }

  const components = template.components.map((component) =>
    mergeComponent(component, overlay?.componentOverrides[component.code]),
  );

  const telemetryMap = { ...asset.telemetryMap };
  for (const [canonical, aliases] of Object.entries(overlay?.telemetryAliases ?? {})) {
    if (!telemetryMap[canonical] && aliases.length === 1) telemetryMap[canonical] = aliases[0];
  }

  return {
    schemaVersion: template.schemaVersion,
    compiledAt: now.toISOString(),
    asset: {
      ...asset,
      telemetryMap,
      customerOverrides: structuredClone(asset.customerOverrides),
    },
    template: {
      ...structuredClone(template),
      components,
    },
    provenance: {
      assetClassCode: template.code,
      overlay: overlay
        ? {
            manufacturer: overlay.manufacturer,
            model: overlay.model,
            schemaVersion: overlay.schemaVersion,
          }
        : undefined,
      customerOverrideKeys: Object.keys(asset.customerOverrides).sort(),
    },
  };
}
