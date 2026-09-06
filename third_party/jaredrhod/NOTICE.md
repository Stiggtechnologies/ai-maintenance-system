# Jared Rhodenizer Meet Sync stack — third-party notices

**Founder unlock (Orville Davis, 2026-09-06):** the prior “do not vendor AGPL”
engineering lock is overridden for this attributed tree. Counsel review of the
SaaS source-offer obligation remains required; this file is the engineering
record, not a legal opinion.

Source: [jaredrhod.com](https://jaredrhod.com) “Get a Jarvis (2 steps)” and the
five public GitHub repositories below. SyncAI uses these as the Meet Sync /
meeting-moderator stack. Personality on app.syncai.ca stays **Sync, the
Reliability Engineer** — recommend ≠ authorize, no plant execute, professional
tone. The shipped Jarvis “cheeky butler” identity is **not** used.

## Vendored repositories

| Tree               | Upstream                                     | Recorded commit                            | License           |
| ------------------ | -------------------------------------------- | ------------------------------------------ | ----------------- |
| `fullstack-agent/` | https://github.com/jaredrhod/fullstack-agent | `5bb159f47dbd6fa8f108651d0532a43aef16346b` | AGPL-3.0-or-later |
| `ai-memory-vault/` | https://github.com/jaredrhod/ai-memory-vault | `659bba9c8b351c937dd393b3042801d1ff1b502c` | CC BY-SA 4.0      |
| `backtalk/`        | https://github.com/jaredrhod/backtalk        | `84b3a6cd321060cabb74aad6ebe794621cf99bd3` | AGPL-3.0-or-later |
| `ai-visualizer/`   | https://github.com/jaredrhod/ai-visualizer   | `6921e1d4b06bdd4a34c5264882d5257c4d5f70fd` | AGPL-3.0-or-later |
| `barehands/`       | https://github.com/jaredrhod/barehands       | `eb23bed2d772f9d5a24de26fb92f46c3c76d69cf` | AGPL-3.0-or-later |

Each tree keeps its upstream `LICENSE`, copyright headers, and README. Do not
strip notices. `UPSTREAM.txt` in each tree records the exact SHA.

## AGPL-3.0 implications (network use)

`fullstack-agent`, `backtalk`, `ai-visualizer`, and `barehands` are AGPL-3.0-or-later.
Serving a modified version of those works to users over a network (including
SaaS on app.syncai.ca) requires offering corresponding source of the modified
AGPL work to those users.

How this repository meets that for the vendored trees:

- The modified and unmodified AGPL source lives in this public directory.
- Meet Sync adapters that derive from those works (`src/lib/presence/visualizerCore.ts`,
  sentence-chunked speech in `src/lib/speech/speechOutput.ts`, booth listen
  policy informed by backtalk hands-free, optional hands overlay) are in this
  same public repository.
- Corresponding source for a production deploy of this commit is this Git
  history at the deployed SHA.

This does **not** relicense SyncAI’s proprietary tree. It does mean the
AGPL-derived Meet Sync adapters cannot be closed-sourced while they are served.

`ai-memory-vault` is CC BY-SA 4.0: credit Jared Rhodenizer, and adaptations of
the vault templates must remain ShareAlike. Sync’s seeded identity notes are
an adaptation and stay attributed.

## What was not copied into git

These upstream binaries were omitted to keep the tree reviewable. They remain
available at the recorded SHAs:

- `backtalk/assets/thinking.wav` (~6.3 MiB)
- `ai-visualizer/assets/thinking.wav` (~6.3 MiB)
- `ai-visualizer/assets/face.png` (~2.2 MiB)
- `barehands/media/fx/fireball.png` (~1.5 MiB)
- `barehands/media/misc/glass-hands.png` (~1.1 MiB)

Meet Sync does not play the thinking WAV. The face is a Sync-branded canvas
driven by the vendored visualizer envelope, not the omitted photo.

## How SyncAI uses the modules

| Module          | Meet Sync use                                                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fullstack-agent | Assembly map / installer docs. Not executed as Claude Code on the host.                                                                                                                        |
| ai-memory-vault | Durable markdown vault (VAULT-INDEX, MEMORY, daily notes, session log) in the signed-in browser. Not the Obsidian desktop app.                                                                 |
| backtalk        | Voice loop: hands-free default, hold-to-talk optional, barge-in, sentence-chunked TTS. Browser STT + `sync-tts` (OpenAI Speech; optional ElevenLabs overlay). Kokoro stays local-desktop-only. |
| ai-visualizer   | Face engine: idle / listening / thinking / speaking + envelope. Sync cyan branding, name **SYNC**, not JARVIS.                                                                                 |
| barehands       | Optional webcam hands overlay. Gestures may mute, pause listen, or send typed/spoken Ask. Never plant execute.                                                                                 |

## npm inventory

These trees are **not** npm dependencies. `package-lock.json` is unchanged.
The automated AGPL reject in `scripts/compliance/generate-license-inventory.mjs`
still applies to lockfile packages. This founder exception is for the attributed
`third_party/jaredrhod/` source trees only.
