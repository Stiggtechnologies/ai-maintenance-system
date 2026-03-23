import { useState, useEffect, useCallback } from 'react';
import * as dashboardServices from '../services/dashboardServices';

export function useExecutiveKPIs() {
  const [data, setData] = useState<dashboardServices.KPI[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const kpis = await dashboardServices.getExecutiveKPIs();
      setData(kpis);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

export function useTacticalKPIs() {
  const [data, setData] = useState<dashboardServices.KPI[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const kpis = await dashboardServices.getTacticalKPIs();
      setData(kpis);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

export function useWorkOrders(filters?: Parameters<typeof dashboardServices.getWorkOrders>[0]) {
  const [data, setData] = useState<dashboardServices.WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const workOrders = await dashboardServices.getWorkOrders(filters);
      setData(workOrders);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

export function useAssets(filters?: Parameters<typeof dashboardServices.getAssets>[0]) {
  const [data, setData] = useState<dashboardServices.Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const assets = await dashboardServices.getAssets(filters);
      setData(assets);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

export function useAlerts(filters?: Parameters<typeof dashboardServices.getAlerts>[0]) {
  const [data, setData] = useState<dashboardServices.Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const alerts = await dashboardServices.getAlerts(filters);
      setData(alerts);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

export function usePendingDecisions(limit: number = 10) {
  const [data, setData] = useState<dashboardServices.Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const decisions = await dashboardServices.getPendingDecisions(limit);
      setData(decisions);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

export function useWorkOrderStats() {
  const [data, setData] = useState<Awaited<ReturnType<typeof dashboardServices.getWorkOrderStats>>>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const stats = await dashboardServices.getWorkOrderStats();
      setData(stats);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

export function useAssetStats() {
  const [data, setData] = useState<Awaited<ReturnType<typeof dashboardServices.getAssetStats>>>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const stats = await dashboardServices.getAssetStats();
      setData(stats);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

export function useAlertStats() {
  const [data, setData] = useState<Awaited<ReturnType<typeof dashboardServices.getAlertStats>>>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const stats = await dashboardServices.getAlertStats();
      setData(stats);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

export function useAutonomousDecisionStats() {
  const [data, setData] = useState<Awaited<ReturnType<typeof dashboardServices.getAutonomousDecisionStats>>>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const stats = await dashboardServices.getAutonomousDecisionStats();
      setData(stats);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}

export function useMaintenanceMetrics() {
  const [data, setData] = useState<Awaited<ReturnType<typeof dashboardServices.getMaintenanceMetrics>>>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const metrics = await dashboardServices.getMaintenanceMetrics();
      setData(metrics);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}
