# Meet Sync — Jared Rhodenizer stack on app.syncai.ca

**2026-09-06 — Founder unlock (Orville Davis).** Prior “do not vendor AGPL”
lock overridden. Notices and AGPL implications:
[`third_party/jaredrhod/NOTICE.md`](../../third_party/jaredrhod/NOTICE.md).

Reference: [jaredrhod.com](https://jaredrhod.com) “Get a Jarvis (2 steps)” —
continuous listen, natural voice, durable memory, face. Sync tone stays
Reliability Engineer. Recommend is not authorize. No plant execute.

## What landed

| Demo bar          | Meet Sync path                                                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Continuous listen | Default booth mode. Hold-to-talk is optional.                                                                                                       |
| Natural voice     | Signed-in `sync-tts` (OpenAI Speech via existing `OPENAI_API_KEY`). Browser `speechSynthesis` fallback only. Optional `ELEVENLABS_API_KEY` overlay. |
| Durable memory    | Obsidian-style markdown vault in `localStorage` + IndexedDB, per signed-in user. Not `sessionStorage` only.                                         |
| Face              | Visualizer envelope from `ai-visualizer/core.js`, Sync-branded canvas.                                                                              |
| Hands             | Optional webcam overlay. No plant execute.                                                                                                          |

Signed-in only. Wired through `AppShell` → `PresenceWelcome` →
`PresenceBoothConversation`. Answers still go through
`askBoothConversation` → `ai-agent-processor` ReliabilityAgent
(`requiresApproval: true`).

## How Orville tries it on app.syncai.ca

1. Merge this PR (or use the Vercel preview). Production also needs
   `sync-tts` deployed by the existing `deploy-migrations` allowlist after
   merge.
2. Confirm the edge secret is set:

   ```bash
   supabase secrets set OPENAI_API_KEY=sk-...
   # optional:
   supabase secrets set SYNC_TTS_VOICE=onyx
   supabase secrets set ELEVENLABS_API_KEY=...
   supabase secrets set ELEVENLABS_VOICE_ID=...
   ```

3. Sign in at https://app.syncai.ca. Stay unmuted on the presence strip.
4. Reload once. Welcome should speak (cloud voice when `sync-tts` is
   configured; honesty line says **configured cloud voice**, never “premium”).
5. Click **Meet Sync**. Allow the microphone. Speak a short maintenance
   question, pause — it should send without holding a button. Sync replies
   and listens again.
6. Speak while Sync is talking — TTS stops (barge-in).
7. Reload the tab. Prior turns should still be in the booth (vault, not a
   fresh `sessionStorage` only).
8. Optional: check **Hold to talk** for press-and-hold. Optional: **Hands**
   for webcam gestures (pinch-send only when there is text; never plant
   execute).
9. Mute still silences speech and pauses auto-listen. CopilotDock Listen
   remains gated by Settings → Sync → `sync_voice_output`.

## What this is not

- Not OpenClaw, SIR, JAVIS, or a plant gateway.
- Not Claude Code / Kokoro running in the browser. Kokoro remains the
  desktop backtalk engine in `third_party/jaredrhod/backtalk/`.
- Not the cheeky Jarvis personality from the vault boot template.
- Not a second Decision Case store. The vault holds Meet Sync conversation
  memory; Decision Cases stay on the existing draft store.
