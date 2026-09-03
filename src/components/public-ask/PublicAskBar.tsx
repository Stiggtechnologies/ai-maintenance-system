import type { ChangeEvent, KeyboardEvent, RefObject } from "react";
import {
  ArrowUp,
  Globe,
  Image as ImageIcon,
  Mic,
  MicOff,
  Paperclip,
  Search,
} from "lucide-react";

type PublicAskBarProps = {
  docked?: boolean;
  value: string;
  placeholder: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onSend: () => void;
  sendDisabled: boolean;
  caseExists: boolean;
  dictationSupported: boolean;
  dictationListening: boolean;
  dictationTitle: string;
  onToggleDictation: () => void;
  photoInputRef: RefObject<HTMLInputElement | null>;
  onOpenAttachMenu?: () => void;
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
  caseExists,
  dictationSupported,
  dictationListening,
  dictationTitle,
  onToggleDictation,
  photoInputRef,
  onOpenAttachMenu,
}: PublicAskBarProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSend();
    }
  };

  const attachTitle = caseExists
    ? "Attach a file"
    : "Available after a case exists";
  const imageTitle = caseExists
    ? "Attach a photo"
    : "Available after a case exists";

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
        <div className="bolt-ask-tools">
          <button
            type="button"
            className="bolt-ask-tool"
            title="Search is not a separate mode yet"
            aria-label="Search"
            disabled
          >
            <Search size={16} />
          </button>
          <button
            type="button"
            className="bolt-ask-tool"
            title={imageTitle}
            aria-label="Attach a photo"
            disabled={!caseExists}
            onClick={() => photoInputRef.current?.click()}
          >
            <ImageIcon size={16} />
          </button>
          <button
            type="button"
            className="bolt-ask-tool"
            title={attachTitle}
            aria-label={
              caseExists ? "Add camera, photos, or files" : "Attach a file"
            }
            disabled={!caseExists}
            onClick={onOpenAttachMenu}
          >
            <Paperclip size={16} />
          </button>
          <button
            type="button"
            className="bolt-ask-tool"
            title="Web search is not available"
            aria-label="Web search"
            disabled
          >
            <Globe size={16} />
          </button>
          <button
            type="button"
            className={`bolt-ask-tool${dictationListening ? " is-live" : ""}`}
            title={dictationTitle}
            aria-label={
              dictationListening ? "Stop dictation" : "Dictate a message"
            }
            aria-pressed={dictationListening}
            disabled={!dictationSupported}
            onClick={onToggleDictation}
          >
            {dictationSupported ? <Mic size={16} /> : <MicOff size={16} />}
          </button>
          <button
            type="button"
            className="bolt-ask-send"
            title="Send message"
            aria-label="Send message"
            disabled={sendDisabled}
            onClick={onSend}
          >
            <ArrowUp size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}

export { ASK_PLACEHOLDER };
