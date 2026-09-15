import { useCallback, useEffect, useRef, useState } from "react";
import {
  buildRealtimeScreenContextUpdate,
  collectUnhandledFunctionCalls,
  normalizeSyncNavigationPath,
  parseRealtimeToolArguments,
  requestSyncRealtimeSession,
  syncRealtimeContextKey,
  type RealtimeFunctionCall,
  type SyncRealtimeContext,
  type SyncVoiceQueryResult,
} from "../lib/speech/syncRealtimeClient";

export type SyncRealtimeVoiceState =
  "idle" | "connecting" | "live" | "ending" | "error";

interface UseSyncRealtimeVoiceOptions {
  context: SyncRealtimeContext;
  disabled?: boolean;
  onAskSync: (question: string) => Promise<SyncVoiceQueryResult>;
  onNavigate: (path: string) => void | Promise<void>;
  onInspectPage?: (
    path: string,
    label: string,
  ) => Promise<SyncVoiceQueryResult>;
  onActiveChange?: (active: boolean) => void;
}

const CLOSE_TIMEOUT_MS = 15_000;
const ROUTE_CONTEXT_TIMEOUT_MS = 5_000;

function waitForIce(connection: RTCPeerConnection): Promise<void> {
  if (connection.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      connection.removeEventListener("icegatheringstatechange", onChange);
      reject(new Error("Timed out while preparing the voice connection."));
    }, 10_000);
    function onChange() {
      if (connection.iceGatheringState !== "complete") return;
      window.clearTimeout(timeout);
      connection.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    }
    connection.addEventListener("icegatheringstatechange", onChange);
    onChange();
  });
}

function readableConnectionError(error: unknown): string {
  if (!(error instanceof Error)) return "Could not start the voice session.";
  switch (error.message) {
    case "voice_not_configured":
      return "OpenAI Realtime is not configured on the Sync server.";
    case "sync_realtime_voice_disabled":
      return "Realtime voice is not enabled for this organization.";
    case "org_daily_quota_exceeded":
      return "Your organization’s daily AI allowance has been reached.";
    case "quota_check_unavailable":
      return "Sync could not verify the AI spend guardrail, so voice was refused safely.";
    case "unauthorized":
      return "Your Sync session expired. Sign in again to use voice.";
    default:
      return error.message || "Could not start the voice session.";
  }
}

function boundedToolOutput(result: SyncVoiceQueryResult): string {
  return JSON.stringify({
    ...result,
    answer: result.answer?.slice(0, 8_000),
    error: result.error?.slice(0, 1_000),
  });
}

export function useSyncRealtimeVoice({
  context,
  disabled = false,
  onAskSync,
  onNavigate,
  onInspectPage,
  onActiveChange,
}: UseSyncRealtimeVoiceOptions) {
  const [state, setState] = useState<SyncRealtimeVoiceState>("idle");
  const [status, setStatus] = useState(
    "Start a secure live conversation when you are ready.",
  );
  const [muted, setMuted] = useState(false);
  const [pushToTalk, setPushToTalk] = useState(false);
  const [pressingToTalk, setPressingToTalk] = useState(false);
  const [model, setModel] = useState("");
  const [lastEvent, setLastEvent] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);
  const connectionRef = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<RTCDataChannel | null>(null);
  const microphoneRef = useRef<MediaStream | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const handledCallsRef = useRef(new Set<string>());
  const lastContextUpdateRef = useRef("");
  const stateRef = useRef<SyncRealtimeVoiceState>(state);
  const pushToTalkRef = useRef(pushToTalk);
  const contextRef = useRef(context);
  const onAskSyncRef = useRef(onAskSync);
  const onNavigateRef = useRef(onNavigate);
  const onInspectPageRef = useRef(onInspectPage);
  const onActiveChangeRef = useRef(onActiveChange);

  stateRef.current = state;
  pushToTalkRef.current = pushToTalk;
  contextRef.current = context;
  onAskSyncRef.current = onAskSync;
  onNavigateRef.current = onNavigate;
  onInspectPageRef.current = onInspectPage;
  onActiveChangeRef.current = onActiveChange;

  const changeState = useCallback((next: SyncRealtimeVoiceState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const sendLatestScreenContext = useCallback(() => {
    const channel = channelRef.current;
    if (!channel || channel.readyState !== "open") return false;
    const nextKey = syncRealtimeContextKey(contextRef.current);
    if (nextKey === lastContextUpdateRef.current) return true;
    try {
      channel.send(
        JSON.stringify(buildRealtimeScreenContextUpdate(contextRef.current)),
      );
    } catch {
      return false;
    }
    lastContextUpdateRef.current = nextKey;
    setLastEvent("screen context updated");
    return true;
  }, []);

  const waitForRouteContext = useCallback(async (path: string) => {
    const deadline = Date.now() + ROUTE_CONTEXT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (contextRef.current.route === path) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 60));
        return true;
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
    }
    return false;
  }, []);

  const cleanup = useCallback(
    (next: SyncRealtimeVoiceState = "idle") => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      const channel = channelRef.current;
      const connection = connectionRef.current;
      const microphone = microphoneRef.current;
      channelRef.current = null;
      connectionRef.current = null;
      microphoneRef.current = null;
      channel?.close();
      connection?.close();
      microphone?.getTracks().forEach((track) => track.stop());
      if (audioRef.current) audioRef.current.srcObject = null;
      handledCallsRef.current.clear();
      lastContextUpdateRef.current = "";
      setMuted(false);
      setPressingToTalk(false);
      changeState(next);
      onActiveChangeRef.current?.(false);
    },
    [changeState],
  );

  useEffect(() => () => cleanup("idle"), [cleanup]);

  useEffect(() => {
    if (state !== "live") return;
    sendLatestScreenContext();
  }, [
    context.entity?.displayName,
    context.entity?.id,
    context.entity?.type,
    context.mode,
    context.pageTitle,
    context.route,
    sendLatestScreenContext,
    state,
  ]);

  const executeTool = useCallback(
    async (call: RealtimeFunctionCall) => {
      const args = parseRealtimeToolArguments(call);
      if (!args) return { ok: false, error: "Invalid command arguments." };
      if (call.name === "ask_sync") {
        const question =
          typeof args.question === "string"
            ? args.question.trim().slice(0, 4_000)
            : "";
        if (!question) {
          return {
            ok: false,
            error: "A complete question for Sync is required.",
          };
        }
        setStatus("Sync is checking the governed operating context…");
        const result = await onAskSyncRef.current(question);
        setStatus(
          result.ok
            ? result.pendingApproval
              ? "Sync answered. A proposed action is waiting for your confirmation on screen."
              : "Sync answered. Keep talking."
            : result.error || "Sync could not complete that request.",
        );
        return result;
      }
      if (call.name === "open_sync_page") {
        const path = normalizeSyncNavigationPath(args.path);
        if (!path) {
          return {
            ok: false,
            error: "That is not a safe Sync application path.",
          };
        }
        const label =
          typeof args.label === "string" && args.label.trim()
            ? args.label.trim().slice(0, 120)
            : path;
        setStatus(`Opening ${label}…`);
        await onNavigateRef.current(path);
        const screenContextUpdated = await waitForRouteContext(path);
        if (screenContextUpdated) sendLatestScreenContext();

        if (screenContextUpdated && onInspectPageRef.current) {
          setStatus(`${label} opened. Sync is reviewing the visible page…`);
          const review = await onInspectPageRef.current(path, label);
          setStatus(
            review.ok
              ? `${label} opened and reviewed. Keep talking.`
              : `${label} opened, but its current contents could not be summarized.`,
          );
          return review.ok
            ? {
                ...review,
                path,
                label,
                readOnlyNavigation: true,
                screenContextUpdated: true,
              }
            : {
                ok: true,
                answer: `${label} is open, but Sync could not safely summarize the visible page${review.error ? `: ${review.error}` : "."}`,
                path,
                label,
                readOnlyNavigation: true,
                screenContextUpdated: true,
              };
        }

        setStatus(
          screenContextUpdated
            ? `${label} opened. Keep talking.`
            : `${label} opened, but the voice context has not caught up yet.`,
        );
        return {
          ok: true,
          answer: screenContextUpdated
            ? `${label} is open.`
            : `${label} is open, but its visible context is not ready yet.`,
          path,
          label,
          readOnlyNavigation: true,
          screenContextUpdated,
        };
      }
      return { ok: false, error: `Unsupported voice command ${call.name}.` };
    },
    [sendLatestScreenContext, waitForRouteContext],
  );

  const handleProviderEvent = useCallback(
    async (event: unknown) => {
      if (!event || typeof event !== "object") return;
      const providerEvent = event as {
        type?: string;
        error?: { message?: string };
        session?: { id?: string };
      };
      if (
        providerEvent.type === "session.started" ||
        providerEvent.type === "session.created"
      ) {
        changeState("live");
        const ptt = pushToTalkRef.current;
        microphoneRef.current?.getAudioTracks().forEach((track) => {
          track.enabled = !ptt;
        });
        setMuted(ptt);
        setStatus(
          ptt
            ? "Connected. Hold Space to speak; release to mute."
            : "Connected. Speak naturally—you can interrupt Sync.",
        );
        setLastEvent("live voice ready");
        return;
      }
      if (providerEvent.type === "session.closed") {
        setStatus("Conversation ended and microphone released.");
        cleanup("idle");
        return;
      }
      if (providerEvent.type === "error") {
        setStatus(
          providerEvent.error?.message ||
            "The voice provider reported an error.",
        );
        cleanup("error");
        return;
      }
      if (providerEvent.type === "input_audio_buffer.speech_started") {
        setStatus("Listening…");
      } else if (providerEvent.type === "response.audio.delta") {
        setStatus("Sync is speaking—you can interrupt at any time.");
      }
      if (providerEvent.type === "response.done") {
        const calls = collectUnhandledFunctionCalls(
          event,
          handledCallsRef.current,
        );
        for (const call of calls) {
          let result: SyncVoiceQueryResult;
          try {
            result = await executeTool(call);
          } catch (error) {
            result = {
              ok: false,
              error:
                error instanceof Error
                  ? error.message
                  : "The Sync voice command failed.",
            };
          }
          const channel = channelRef.current;
          if (!channel || channel.readyState !== "open") return;
          channel.send(
            JSON.stringify({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: call.call_id,
                output: boundedToolOutput(result),
              },
            }),
          );
        }
        if (calls.length > 0 && channelRef.current?.readyState === "open") {
          channelRef.current.send(JSON.stringify({ type: "response.create" }));
          setLastEvent(
            `${calls.length} governed command${calls.length === 1 ? "" : "s"}`,
          );
        } else {
          setStatus("Listening. Ask a follow-up whenever you like.");
        }
      } else if (providerEvent.type) {
        setLastEvent(providerEvent.type.replaceAll(".", " · "));
      }
    },
    [changeState, cleanup, executeTool],
  );

  const start = useCallback(async () => {
    if (
      disabled ||
      stateRef.current === "connecting" ||
      stateRef.current === "live"
    ) {
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      changeState("error");
      setStatus("This browser does not support live microphone conversations.");
      return;
    }

    changeState("connecting");
    onActiveChangeRef.current?.(true);
    setStatus("Requesting microphone and creating a secure session…");
    setLastEvent("");
    setModel("");

    try {
      const connection = new RTCPeerConnection();
      connectionRef.current = connection;
      connection.addEventListener("track", ({ streams, track }) => {
        if (!audioRef.current) return;
        audioRef.current.srcObject = streams[0] ?? new MediaStream([track]);
        void audioRef.current.play().catch(() => undefined);
      });
      connection.addEventListener("connectionstatechange", () => {
        if (connectionRef.current !== connection) return;
        if (
          connection.connectionState === "failed" ||
          connection.connectionState === "disconnected"
        ) {
          setStatus("Voice connection was interrupted.");
          cleanup("error");
        } else if (connection.connectionState === "connected") {
          changeState("live");
          setStatus("Connected. Speak naturally—you can interrupt Sync.");
        }
      });

      const microphone = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      microphoneRef.current = microphone;
      microphone
        .getAudioTracks()
        .forEach((track) => connection.addTrack(track, microphone));

      const channel = connection.createDataChannel("oai-events");
      channelRef.current = channel;
      channel.addEventListener("open", () => {
        sendLatestScreenContext();
        setLastEvent("governed tools ready");
      });
      channel.addEventListener("message", ({ data }) => {
        try {
          void handleProviderEvent(JSON.parse(String(data)));
        } catch {
          setLastEvent("provider event");
        }
      });
      channel.addEventListener("close", () => {
        if (
          connectionRef.current === connection &&
          stateRef.current !== "ending"
        ) {
          setStatus("Voice session disconnected.");
          cleanup("idle");
        }
      });

      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      await waitForIce(connection);
      const sdp = connection.localDescription?.sdp;
      if (!sdp) throw new Error("The browser did not create a voice offer.");

      const sessionContext = contextRef.current;
      lastContextUpdateRef.current = syncRealtimeContextKey(sessionContext);
      const session = await requestSyncRealtimeSession(sdp, sessionContext);
      await connection.setRemoteDescription({
        type: "answer",
        sdp: session.transport.sdp,
      });
      setModel(session.model);
      setStatus("Voice channel negotiated. Waiting for Sync…");
    } catch (error) {
      const message = readableConnectionError(error);
      cleanup("error");
      setStatus(message);
    }
  }, [
    changeState,
    cleanup,
    disabled,
    handleProviderEvent,
    sendLatestScreenContext,
  ]);

  const end = useCallback(() => {
    const channel = channelRef.current;
    if (!channel || channel.readyState !== "open") {
      cleanup("idle");
      setStatus("Conversation ended and microphone released.");
      return;
    }
    changeState("ending");
    setStatus("Ending the conversation…");
    channel.send(JSON.stringify({ type: "session.close" }));
    closeTimerRef.current = window.setTimeout(() => {
      cleanup("idle");
      setStatus("Conversation ended and microphone released.");
    }, CLOSE_TIMEOUT_MS);
  }, [changeState, cleanup]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    microphoneRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
    setStatus(
      next
        ? "Microphone muted. Sync can finish speaking."
        : "Microphone live. Speak naturally.",
    );
  }, [muted]);

  const togglePushToTalk = useCallback(() => {
    const next = !pushToTalkRef.current;
    pushToTalkRef.current = next;
    setPushToTalk(next);
    if (stateRef.current === "live") {
      microphoneRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = !next;
      });
      setMuted(next);
      setPressingToTalk(false);
      setStatus(
        next
          ? "Push to talk ready. Hold Space to speak."
          : "Open microphone mode. Speak naturally.",
      );
    }
  }, []);

  useEffect(() => {
    if (state !== "live" || !pushToTalk) return;
    const setMicrophone = (enabled: boolean) => {
      microphoneRef.current?.getAudioTracks().forEach((track) => {
        track.enabled = enabled;
      });
      setMuted(!enabled);
      setPressingToTalk(enabled);
      setStatus(
        enabled
          ? "Listening… release Space to mute."
          : "Push to talk ready. Hold Space to speak.",
      );
    };
    const keyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.code !== "Space" ||
        event.repeat ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA"
      ) {
        return;
      }
      event.preventDefault();
      setMicrophone(true);
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      event.preventDefault();
      setMicrophone(false);
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, [pushToTalk, state]);

  return {
    state,
    status,
    muted,
    pushToTalk,
    pressingToTalk,
    model,
    lastEvent,
    audioRef,
    start,
    end,
    toggleMute,
    togglePushToTalk,
  };
}
