import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

interface RealtimeMessage {
  type: string;
  channel_name: string;
  payload: any;
  priority: string;
  created_at: string;
}

export function useRealtimeUpdates(channels: string[], onMessage?: (message: RealtimeMessage) => void) {
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<RealtimeMessage[]>([]);
  const subscriptionsRef = useRef<any[]>([]);

  useEffect(() => {
    if (!channels.length) return;

    const setupRealtimeSubscriptions = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      channels.forEach(channelName => {
        const channel = supabase
          .channel(`realtime:${channelName}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'realtime_messages',
              filter: `channel_id=eq.${channelName}`
            },
            (payload) => {
              const message = payload.new as RealtimeMessage;
              setMessages(prev => [...prev, message]);
              onMessage?.(message);
            }
          )
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              setConnected(true);
            }
          });

        subscriptionsRef.current.push(channel);
      });
    };

    setupRealtimeSubscriptions();

    return () => {
      subscriptionsRef.current.forEach(sub => {
        supabase.removeChannel(sub);
      });
      subscriptionsRef.current = [];
      setConnected(false);
    };
  }, [channels, onMessage]);

  return { connected, messages };
}

export function useWorkOrderUpdates(onUpdate?: (workOrder: any) => void) {
  useEffect(() => {
    const channel = supabase
      .channel('work-orders-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'work_orders' },
        (payload) => {
          onUpdate?.(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [onUpdate]);
}

export function useAssetHealthUpdates(onUpdate?: (health: any) => void) {
  useEffect(() => {
    const channel = supabase
      .channel('asset-health-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'asset_health_monitoring' },
        (payload) => {
          onUpdate?.(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [onUpdate]);
}

export function useAlertUpdates(onUpdate?: (alert: any) => void) {
  useEffect(() => {
    const channel = supabase
      .channel('alerts-changes')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'system_alerts' },
        (payload) => {
          onUpdate?.(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [onUpdate]);
}

export function useDecisionUpdates(onUpdate?: (decision: any) => void) {
  useEffect(() => {
    const channel = supabase
      .channel('decisions-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'autonomous_decisions' },
        (payload) => {
          onUpdate?.(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [onUpdate]);
}

export function useBroadcastChannel(channelName: string, onMessage: (payload: any) => void) {
  useEffect(() => {
    const channel = supabase.channel(channelName);

    channel.on('broadcast', { event: 'message' }, ({ payload }) => {
      onMessage(payload);
    });

    channel.subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelName, onMessage]);

  const broadcast = useCallback((payload: any) => {
    const channel = supabase.channel(channelName);
    channel.send({
      type: 'broadcast',
      event: 'message',
      payload
    });
  }, [channelName]);

  return { broadcast };
}
