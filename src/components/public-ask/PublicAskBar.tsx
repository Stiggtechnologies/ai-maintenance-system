import type { ChangeEvent, KeyboardEvent, RefObject } from "react";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Image as ImageIcon,
  Mic,
  Paperclip,
  Plus,
} from "lucide-react";

type PublicAskBarProps = {
  docked?: boolean;
  value: string;
  placeholder: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onSend: () => void;
  sendDisabled: boolean;
  dictationSupported: boolean;
  dictationListening: boolean;
  dictationTitle: string;
  onToggleDictation: () => void;
  photoInputRef: RefObject<HTMLInputElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
};

const ASK_PLACEHOLDER = "Ask anything or @mention a Space";

export function PublicAskBar({
  docked = false,
  value,
  placeholder,
  textareaRef,
  onChange,
  onSend,
  sendDisabled,
  dictationSupported,
  dictationListening,
  dictationTitle,
  onToggleDictation,
  photoInputRef,
  fileInputRef,
}: PublicAskBarProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!overflowOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (
        overflowRef.current &&
        !overflowRef.current.contains(event.target as Node)
      ) {
        setOverflowOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [overflowOpen]);

  const renderAccessories = () => (
    <>
      <button
        type="button"
        className="bolt-ask-tool"
        title="Attach a photo"
        aria-label="Attach a photo"
        onClick={() => {
          setOverflowOpen(false);
          photoInputRef.current?.click();
        }}
      >
        <ImageIcon size={16} />
        <span className="bolt-ask-overflow-label">Image</span>
      </button>
      <button
        type="button"
        className="bolt-ask-tool"
        title="Attach a CSV, TSV, text, or log file"
        aria-label="Attach a data file"
        onClick={() => {
          setOverflowOpen(false);
          fileInputRef.current?.click();
        }}
      >
        <Paperclip size={16} />
        <span className="bolt-ask-overflow-label">Data file</span>
      </button>
      {dictationSupported ? (
        <button
          type="button"
          className={`bolt-ask-tool${dictationListening ? " is-live" : ""}`}
          title={dictationTitle}
          aria-label={
            dictationListening ? "Stop dictation" : "Dictate a message"
          }
          aria-pressed={dictationListening}
          onClick={() => {
            setOverflowOpen(false);
            onToggleDictation();
          }}
        >
          <Mic size={16} />
          <span className="bolt-ask-overflow-label">Dictate</span>
        </button>
      ) : null}
    </>
  );

  return (
    <div className={docked ? "bolt-ask-dock" : "bolt-ask"}>
      <div className="bolt-ask-bar">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
            onChange(event.target.value)
          }
          onKeyDown={onKeyDown}
          placeholder={placeholder || ASK_PLACEHOLDER}
          rows={1}
          aria-label="Ask"
        />
        <div className="bolt-ask-tools">{renderAccessories()}</div>
        <div className="bolt-ask-overflow" ref={overflowRef}>
          <button
            type="button"
            className="bolt-ask-overflow-toggle"
            title="More actions"
            aria-label="More actions"
            aria-expanded={overflowOpen}
            data-testid="bolt-ask-overflow"
            onClick={() => setOverflowOpen((open) => !open)}
          >
            <Plus size={18} />
          </button>
          {overflowOpen ? (
            <div className="bolt-ask-overflow-menu" role="menu">
              {renderAccessories()}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="bolt-ask-send"
          title="Send message"
          aria-label="Send message"
          data-testid="bolt-ask-send"
          disabled={sendDisabled}
          onClick={onSend}
        >
          <ArrowUp size={17} />
        </button>
      </div>
    </div>
  );
}

export { ASK_PLACEHOLDER };
