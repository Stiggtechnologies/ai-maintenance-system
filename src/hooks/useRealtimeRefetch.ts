/**
 * useRealtimeRefetch — live operating picture over Supabase Realtime.
 *
 * Subscribes to RLS-enforced postgres_changes on the given tables and calls
 * `refetch` (debounced) whenever any row changes, so pages update without a
 * manual refresh. Returns whether the stream is currently connected, which
 * pages surface as a LIVE indicator.
 */
import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

export function useRealtimeRefetch(
  tables: string[],
  refetch: () => void,
  debounceMs = 1200,
): { live: boolean } {
  const [live, setLive] = useState(false);
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  const key = tables.join(",");

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase.channel(`live:${key}`);

    for (const table of key.split(",")) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => refetchRef.current(), debounceMs);
        },
      );
    }

    // The socket can join while the server still rejects the row stream
    // (e.g. outdated local realtime images) — only claim LIVE when the
    // postgres_changes binding is actually accepted.
    channel.on("system", {}, (payload: { message?: string }) => {
      if (payload.message?.includes("Unable to subscribe")) setLive(false);
    });

    channel.subscribe((status) => {
      setLive(status === "SUBSCRIBED");
    });

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
      setLive(false);
    };
  }, [key, debounceMs]);

  return { live };
}
