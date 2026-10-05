import { supabase } from "../lib/supabase";

export interface AssetOperationalMonitor {
  asset: {
    id: string;
    tag: string | null;
    name: string;
    criticality: string | null;
    status: string | null;
  };
  windowDays: number;
  windowStart: string;
  condition: {
    summary: {
      readings: number;
      sensors: number;
      goodReadings: number;
      suspectOrBadReadings: number;
      openAlerts: number;
      alarmAlerts: number;
      latestReadingAt: string | null;
    };
    readings: Array<{
      id: number;
      sensorId: string;
      sensor: string;
      signalType: string | null;
      value: number;
      unit: string | null;
      quality: string;
      takenAt: string;
      sourceSystem: string | null;
    }>;
    alerts: Array<{
      id: string;
      sensor: string;
      severity: "warning" | "alarm";
      triggeredValue: number;
      limitValue: number;
      unit: string | null;
      triggeredAt: string;
      clearedAt: string | null;
      acknowledgedAt: string | null;
      workOrderId: string | null;
    }>;
    basis: string;
  };
  work: {
    summary: {
      orders: number;
      openOrders: number;
      completedOrders: number;
      correctiveOrders: number;
      safetyFlagged: number;
      latestActivityAt: string | null;
    };
    orders: Array<{
      id: string;
      number: string | null;
      title: string;
      status: string;
      priority: string;
      workType: string | null;
      safetyFlag: boolean;
      productionImpact: string | null;
      createdAt: string;
      completedAt: string | null;
    }>;
    basis: string;
  };
  production: {
    summary: {
      runningHours: number;
      downHours: number;
      stateRows: number;
      productionRecords: number;
      productionUnits: number | null;
      unitOfMeasure: string | null;
      demonstratedRate: number | null;
      estimatedUnitsLost: number | null;
      measurementState: "demonstrated_rate" | "not_measurable";
      measurementRefusal: string | null;
      latestStateAt: string | null;
      latestProductionAt: string | null;
    };
    states: Array<{
      id: number;
      state: string;
      loadPct: number | null;
      startedAt: string;
      endedAt: string | null;
      reasonCode: string | null;
      sourceSystem: string | null;
    }>;
    basis: string;
    authority: string;
  };
  risk: {
    summary: {
      emergingRisks: number;
      warningIndicators: number;
      criticalIndicators: number;
      latestSignalAt: string | null;
    };
    risks: Array<{
      id: string;
      title: string;
      objectiveAtRisk: string | null;
      status: string;
      level: string | null;
      score: number | null;
      velocity: number | null;
      decisionAction: string | null;
      reviewDate: string | null;
      updatedAt: string;
      indicators: Array<{
        id: string;
        name: string;
        state: "warning" | "critical";
        value: number | null;
        unit: string | null;
        observedAt: string | null;
        sourceSystem: string;
      }>;
    }>;
    basis: string;
  };
  authority: {
    readOnly: true;
    mayCreateWork: false;
    mayChangeWork: false;
    mayApprove: false;
    mayAcceptRisk: false;
    mayCommitSpend: false;
    mayChangeOperatingLimits: false;
    mayReturnToService: false;
  };
}

export async function loadAssetOperationalMonitor(
  assetId: string,
  windowDays = 90,
): Promise<AssetOperationalMonitor> {
  const { data, error } = await supabase.rpc("get_asset_operational_monitor", {
    p_asset_id: assetId,
    p_window_days: windowDays,
  });
  if (error) throw new Error(error.message);
  const payload = data as AssetOperationalMonitor & { error?: string };
  if (payload?.error) throw new Error(payload.error);
  return payload;
}
