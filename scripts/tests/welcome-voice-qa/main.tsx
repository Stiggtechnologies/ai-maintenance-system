// Visual fixture only: synthetic identities, no provider calls or microphone.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SyncAssistantWelcome } from "../../../src/components/SyncAssistantWelcome";
import { SyncRealtimeVoicePanel } from "../../../src/components/SyncRealtimeVoicePanel";
import type { useSyncRealtimeVoice } from "../../../src/hooks/useSyncRealtimeVoice";
import "./styles.css";
// Visual entrypoint intentionally has no production exports.
// eslint-disable-next-line react-refresh/only-export-components
function Fixture() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState("idle");
  const [welcomeOnly, setWelcomeOnly] = useState(false);
  const [scope, setScope] = useState("a");
  const [mode, setMode] = useState("conversation");
  const voice = {
    state,
    welcomeOnly,
    status:
      state === "live"
        ? "Fixture connected — no microphone or provider calls."
        : "Ready. Synthetic visual fixture.",
    model: "Canonical Realtime",
    muted: false,
    pushToTalk: false,
    lastEvent: "",
    start: async (welcome?: string) => {
      setWelcomeOnly(Boolean(welcome));
      setState("live");
    },
    stop: () => setState("idle"),
    stopWelcome: () => {
      if (welcomeOnly) {
        setState("idle");
        setWelcomeOnly(false);
      }
    },
    end: () => setState("idle"),
    toggleMute: () => {},
    togglePushToTalk: () => {},
  } as unknown as ReturnType<typeof useSyncRealtimeVoice>;
  return (
    <main className="min-h-screen bg-[#080d14] text-slate-100 p-6">
      <h1 className="text-xl mb-3">Sync assistant parity — visual fixture</h1>
      <p className="text-xs text-slate-400 mb-5">
        Synthetic user and tenant. Audio and network calls are simulated. Mode:{" "}
        {mode}
      </p>
      <SyncAssistantWelcome
        key={scope}
        userId={`fixture-${scope}`}
        organizationId={`org-${scope}`}
        fullName={scope === "a" ? "Orville Example" : "Alex Example"}
        enabled
        voice={voice}
        onOpen={() => setOpen(true)}
      />
      <div className="flex gap-4 my-5">
        <button
          onClick={() => {
            voice.stop();
            setScope(scope === "a" ? "b" : "a");
          }}
        >
          Switch synthetic tenant
        </button>
        <button
          onClick={() =>
            setMode(mode === "meeting" ? "conversation" : "meeting")
          }
        >
          Change conversation / meeting
        </button>
      </div>
      {open && (
        <div className="max-w-3xl border border-white/10 rounded-xl">
          <h2 className="p-4">Sync</h2>
          <SyncRealtimeVoicePanel voice={voice} />
          <textarea
            className="m-4 border border-white/10 rounded p-3"
            placeholder="Ask Sync"
          />
        </div>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
