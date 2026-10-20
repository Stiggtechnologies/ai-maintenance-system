/**
 * Field — same conversation primitive as Decision Workspace.
 * First paint is the composer. Camera and QR attach to this turn.
 * A filed report is a user turn, not a landing list or /assets hop.
 *
 * Hands-free mode (/field?mode=hands-free) is the same page for head-worn
 * devices and gloved use: every tool is a large button with a visible text
 * label (RealWear voice control taps a button by saying its label), voice
 * dictation fills the report, and short spoken commands send, clear or set
 * the report type. Every send ends with a SyncAI turn saying whether a
 * notification was filed, and why not when it was not.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Camera, Mic, Paperclip, QrCode, Send, X as XIcon } from "lucide-react";
import { useDictation } from "../hooks/useDictation";
import {
  fieldFilingOutcome,
  filedMessage,
  parseFieldVoice,
  type FieldNotificationType,
} from "../lib/field/handsFree";
import {
  listRecentFieldReports,
  type FieldReport,
} from "../services/fieldReports";
import { reportFailure } from "../services/fieldCapture";
import "./DecisionCaseWorkspacePage.css";

interface FieldTurn {
  id: string;
  role: "user" | "system";
  text: string;
  createdAt: string;
}

function reportToTurn(report: FieldReport): FieldTurn {
  return {
    id: report.id,
    role: "user",
    text: [
      report.description,
      `[${report.notification_type}] ${report.asset_tag ?? "Unassigned asset"} · reported by ${report.reported_by}`,
    ].join("\n"),
    createdAt: report.created_at,
  };
}

function timestamp(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

const NOTIFICATION_TYPES: FieldNotificationType[] = [
  "fault",
  "observation",
  "safety",
];

export function FieldPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const handsFree = searchParams.get("mode") === "hands-free";
  const [notificationType, setNotificationType] =
    useState<FieldNotificationType>("observation");
  const [voiceSend, setVoiceSend] = useState(false);
  const [turns, setTurns] = useState<FieldTurn[]>([]);
  const [composer, setComposer] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrValue, setQrValue] = useState("");
  const [assetChip, setAssetChip] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const photoRef = useRef<HTMLInputElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try {
      const reports = await listRecentFieldReports();
      setTurns(reports.map(reportToTurn));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load field reports");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    composerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (typeof endRef.current?.scrollIntoView === "function") {
      endRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [turns.length]);

  const attachQr = () => {
    const value = qrValue.trim();
    if (!value) return;
    const assetMatch = value.match(/\/assets\/([^/?#]+)/);
    setAssetChip(assetMatch?.[1] ?? value);
    setQrValue("");
    setQrOpen(false);
  };

  const send = async () => {
    const text = composer.trim();
    if ((!text && !photo && !assetChip) || sending) return;
    setSending(true);
    setError(null);
    const chips = [
      photo
        ? `[Attached photo — ${photo.name}]\nImage will be sent with this turn.`
        : "",
      assetChip ? `[QR / asset — ${assetChip}]` : "",
      text,
    ]
      .filter(Boolean)
      .join("\n\n");
    const userTurn: FieldTurn = {
      id: `field-${Date.now()}`,
      role: "user",
      text: chips,
      createdAt: new Date().toISOString(),
    };
    setTurns((current) => [...current, userTurn]);
    setComposer("");
    const sentPhoto = photo;
    const sentAsset = assetChip;
    setPhoto(null);
    setAssetChip(null);

    const outcome = fieldFilingOutcome({ asset: sentAsset, text });
    let status: string;
    if (!outcome.fileable) {
      status = outcome.reason;
    } else {
      try {
        const result = await reportFailure({
          assetId: sentAsset as string,
          description: text,
          notificationType,
          photo: sentPhoto ?? undefined,
        });
        status = filedMessage({
          notificationId: result.notificationId,
          type: notificationType,
          withPhoto: Boolean(result.photoPath),
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Report was not filed";
        setError(message);
        status = `Not filed: ${message}`;
      }
    }
    setTurns((current) => [
      ...current,
      {
        id: `field-status-${Date.now()}`,
        role: "system",
        text: status,
        createdAt: new Date().toISOString(),
      },
    ]);
    setSending(false);
  };

  const dictation = useDictation((spoken) => {
    const action = parseFieldVoice(spoken);
    if (action.kind === "send") setVoiceSend(true);
    else if (action.kind === "clear") {
      setComposer("");
      setPhoto(null);
      setAssetChip(null);
    } else if (action.kind === "set-type") setNotificationType(action.value);
    else
      setComposer((current) =>
        current.trim() ? `${current.trim()} ${action.text}` : action.text,
      );
  });

  useEffect(() => {
    if (!voiceSend) return;
    setVoiceSend(false);
    void send();
    // send reads the latest composer state on this render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceSend]);

  const toggleMode = () => {
    const next = new URLSearchParams(searchParams);
    if (handsFree) next.delete("mode");
    else next.set("mode", "hands-free");
    setSearchParams(next, { replace: true });
  };

  const showTools = handsFree || turns.length > 0;

  return (
    <div
      className={`decision-workspace field-workspace${handsFree ? " is-hands-free" : ""}`}
      data-layout="chat-first"
      data-mode={handsFree ? "hands-free" : "standard"}
    >
      <header className="dw-topbar">
        <div className="dw-topbar-side" />
        <div className="dw-topbar-center">
          {turns.length > 0 && (
            <span className="dw-case-name">Field observation</span>
          )}
        </div>
        <div className="dw-topbar-side is-end">
          <button
            type="button"
            className="field-mode-toggle"
            onClick={toggleMode}
            aria-pressed={handsFree}
          >
            {handsFree ? "Standard view" : "Hands-free"}
          </button>
        </div>
      </header>
      <div className="dw-layout">
        <main className="dw-main">
          <section className="dw-thread" aria-label="Conversation">
            {turns.length === 0 ? (
              <div className="dw-empty" data-testid="first-paint-empty">
                <button
                  type="button"
                  className="dw-seed-chip"
                  data-testid="sample-seed-chip"
                  onClick={() => {
                    setTurns([
                      {
                        id: `field-sample-${Date.now()}`,
                        role: "user",
                        text: "Seal weep on the inboard gland",
                        createdAt: new Date().toISOString(),
                      },
                    ]);
                  }}
                >
                  <span className="dw-seed-orb" aria-hidden />
                  Seal weep on the inboard gland
                </button>
              </div>
            ) : (
              turns.map((turn) => (
                <article
                  key={turn.id}
                  className={`dw-message role-${turn.role}`}
                >
                  <div>
                    <header>
                      <strong>{turn.role === "user" ? "You" : "SyncAI"}</strong>
                      <span>{timestamp(turn.createdAt)}</span>
                    </header>
                    <p>{turn.text}</p>
                  </div>
                </article>
              ))
            )}
            <div ref={endRef} />
          </section>
          <section className="dw-composer-wrap">
            {photo && (
              <div className="dw-attach-chip">
                <Camera size={13} />
                <span className="dw-attach-name">{photo.name}</span>
                <span className="dw-attach-meta">
                  Photo will be sent with this turn
                </span>
                <button
                  type="button"
                  title="Remove photo"
                  onClick={() => setPhoto(null)}
                >
                  <XIcon size={13} />
                </button>
              </div>
            )}
            {assetChip && (
              <div className="dw-attach-chip">
                <QrCode size={13} />
                <span className="dw-attach-name">{assetChip}</span>
                <span className="dw-attach-meta">
                  Asset tag will be sent with this turn
                </span>
                <button
                  type="button"
                  title="Remove asset"
                  onClick={() => setAssetChip(null)}
                >
                  <XIcon size={13} />
                </button>
              </div>
            )}
            {error && (
              <div className="dw-attach-error" role="alert">
                {error}
              </div>
            )}
            {handsFree && (
              <div
                className="field-handsfree-bar"
                role="toolbar"
                aria-label="Hands-free tools"
              >
                <button
                  type="button"
                  className={dictation.listening ? "is-live" : undefined}
                  disabled={!dictation.supported}
                  onClick={() =>
                    dictation.listening ? dictation.stop() : dictation.start()
                  }
                >
                  <Mic size={20} />
                  {dictation.supported
                    ? dictation.listening
                      ? "Stop listening"
                      : "Speak"
                    : "Voice not available in this browser"}
                </button>
                <button
                  type="button"
                  onClick={() => photoRef.current?.click()}
                >
                  <Camera size={20} />
                  Take photo
                </button>
                <button type="button" onClick={() => setQrOpen((v) => !v)}>
                  <QrCode size={20} />
                  Enter asset
                </button>
                {NOTIFICATION_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={notificationType === type}
                    onClick={() => setNotificationType(type)}
                  >
                    {type[0].toUpperCase() + type.slice(1)}
                  </button>
                ))}
                <button
                  type="button"
                  className="is-primary"
                  disabled={(!composer.trim() && !photo && !assetChip) || sending}
                  onClick={() => void send()}
                >
                  <Send size={20} />
                  Send report
                </button>
                {dictation.error && (
                  <p className="field-handsfree-note" role="status">
                    {dictation.error}
                  </p>
                )}
                {dictation.listening && (
                  <p className="field-handsfree-note">
                    Listening. Say what you see, or say “send report”, “clear”,
                    “fault”, “observation” or “safety”.
                  </p>
                )}
              </div>
            )}
            {qrOpen && (
              <div className="dw-qr-tool">
                <input
                  value={qrValue}
                  onChange={(event) => setQrValue(event.target.value)}
                  placeholder="Asset tag or QR payload"
                  aria-label="Asset tag or QR payload"
                />
                <button type="button" onClick={attachQr}>
                  Attach
                </button>
              </div>
            )}
            <div className="dw-composer">
              {showTools && (
                <>
                  <input
                    ref={photoRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="dw-file-input"
                    aria-label="Attach a photo"
                    onChange={(event) => {
                      setPhoto(event.target.files?.[0] ?? null);
                      event.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    className="dw-composer-tool"
                    aria-label="Camera"
                    title="Attach a photo to this turn"
                    onClick={() => photoRef.current?.click()}
                  >
                    <Camera size={16} />
                  </button>
                  <button
                    type="button"
                    className="dw-composer-tool"
                    aria-label="QR"
                    title="Attach a QR or asset tag to this turn"
                    onClick={() => setQrOpen((value) => !value)}
                  >
                    <QrCode size={16} />
                  </button>
                  <button
                    type="button"
                    className="dw-composer-tool"
                    aria-label="Attach a file"
                    title="Attach a file to this turn"
                    onClick={() => photoRef.current?.click()}
                  >
                    <Paperclip size={16} />
                  </button>
                </>
              )}
              <textarea
                ref={composerRef}
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder="What did you observe?"
                rows={2}
              />
              <button
                type="button"
                title="Send message"
                disabled={(!composer.trim() && !photo && !assetChip) || sending}
                onClick={() => void send()}
              >
                <Send size={17} />
              </button>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
