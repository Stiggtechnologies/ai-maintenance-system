/**
 * Field — same conversation primitive as Decision Workspace.
 * First paint is the composer. Camera and QR attach to this turn.
 * A filed report is a user turn, not a landing list or /assets hop.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Paperclip, QrCode, Send, X as XIcon } from "lucide-react";
import { listRecentFieldReports, type FieldReport } from "../services/fieldReports";
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

export function FieldPage() {
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
    endRef.current?.scrollIntoView({ block: "nearest" });
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

    if (sentAsset && /^[0-9a-f-]{16,}$/i.test(sentAsset) && text) {
      try {
        await reportFailure({
          assetId: sentAsset,
          description: text,
          notificationType: "observation",
          photo: sentPhoto ?? undefined,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Report was not filed");
      }
    }
    setSending(false);
  };

  return (
    <div className="decision-workspace field-workspace" data-layout="chat-first">
      <header className="dw-topbar">
        <div className="dw-identity">
          <span className="dw-mark" aria-hidden>
            S
          </span>
          <span>
            <strong>SyncAI</strong>
            <small>Field</small>
          </span>
        </div>
      </header>
      <div className="dw-layout">
        <main className="dw-main">
          <section className="dw-thread" aria-label="Conversation">
            {turns.length === 0 ? (
              <div className="dw-empty">
                <p>What did you observe?</p>
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
