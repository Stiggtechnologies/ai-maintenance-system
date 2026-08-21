import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import type {
  EvidenceReference,
  InvestigationCheckRecord,
  SyncTurnTelemetry,
} from "../types/sync-stream";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { SyncInvestigationTrace } from "./SyncInvestigationTrace";

interface SyncResponseBodyProps {
  text: string;
  streaming?: boolean;
  evidence?: EvidenceReference[];
  checks?: InvestigationCheckRecord[];
  telemetry?: SyncTurnTelemetry | null;
  responseMode?: string | null;
}

export function SyncResponseBody({
  text,
  streaming = false,
  evidence = [],
  checks = [],
  telemetry,
  responseMode,
}: SyncResponseBodyProps) {
  const [expanded, setExpanded] = useState(false);
  const shouldCollapse =
    !streaming &&
    responseMode !== "deliverable" &&
    (text.length > 3200 || text.split("\n").length > 45);

  return (
    <>
      <div className={shouldCollapse && !expanded ? "relative max-h-[38rem] overflow-hidden" : ""}>
        <MarkdownRenderer content={text} evidence={evidence} />
        {shouldCollapse && !expanded ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-linear-to-t from-[#0D1520] via-[#0D1520]/90 to-transparent" aria-hidden />
        ) : null}
      </div>

      {shouldCollapse ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-white/8 px-2.5 py-1.5 text-[11px] font-medium text-slate-400 hover:bg-white/4 hover:text-slate-200"
        >
          {expanded ? <ChevronUp className="h-3 w-3" aria-hidden /> : <ChevronDown className="h-3 w-3" aria-hidden />}
          {expanded ? "Collapse engineering analysis" : "Show full engineering analysis"}
        </button>
      ) : null}

      {!streaming ? (
        <SyncInvestigationTrace
          checks={checks}
          telemetry={telemetry}
          sourceCount={evidence.length}
        />
      ) : null}
    </>
  );
}
