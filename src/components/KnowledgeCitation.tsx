import { useRef, useState } from "react";
import { useOptionalAuth } from "./AuthProvider";
import { supabase } from "../lib/supabase";

interface ResolvedSource {
  citationLabel: string;
  sourceId: string;
  title: string;
  contentRevision: number | null;
}
/** Titles returned for human inspection are React text, never model context. */
export function KnowledgeCitation({
  title,
  pageRange,
}: {
  title: string;
  pageRange: string;
}) {
  const auth = useOptionalAuth();
  const scope = `${auth?.user?.id ?? "anonymous"}:${auth?.profile?.organization_id ?? "none"}:${auth?.profile?.role ?? "none"}:${title}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [result, setResult] = useState<{
    scope: string;
    source?: ResolvedSource;
    error?: string;
    busy?: boolean;
  }>();
  const visible = result?.scope === scope ? result : undefined;
  const generated = /^KB document [a-f0-9]{16}$/.test(title);
  async function inspect() {
    const started = scope;
    setResult({ scope: started, busy: true });
    try {
      const { data, error } = await supabase.rpc("resolve_kb_citation", {
        p_label: title,
      });
      if (error)
        throw new Error(
          "Source inspection is unavailable in this environment.",
        );
      if (!Array.isArray(data) || data.length !== 1)
        throw new Error(
          "The source is unavailable or ambiguous. No identity was inferred.",
        );
      const source = data[0] as Partial<ResolvedSource>;
      if (
        source.citationLabel !== title ||
        typeof source.sourceId !== "string" ||
        typeof source.title !== "string" ||
        !(
          source.contentRevision === null ||
          (Number.isSafeInteger(source.contentRevision) &&
            Number(source.contentRevision) > 0)
        )
      )
        throw new Error("Source inspection returned an incomplete reference.");
      if (currentScope.current === started)
        setResult({ scope: started, source: source as ResolvedSource });
    } catch (error) {
      if (currentScope.current === started)
        setResult({
          scope: started,
          error:
            error instanceof Error
              ? error.message
              : "Source inspection failed.",
        });
    }
  }
  return (
    <div>
      <div>
        {title} · {pageRange}
      </div>
      {generated &&
        (auth?.user ? (
          <button
            type="button"
            disabled={visible?.busy}
            onClick={() => void inspect()}
            className="mt-2 underline"
          >
            {visible?.busy ? "Loading source…" : "Inspect cited source"}
          </button>
        ) : (
          <p className="mt-2">Sign in to inspect this cited source.</p>
        ))}
      {visible?.error && <p role="alert">{visible.error}</p>}
      {visible?.source && (
        <div className="mt-2">
          <p>Document title: {visible.source.title}</p>
          <p>
            Source record: {visible.source.sourceId}
            {visible.source.contentRevision
              ? ` · revision ${visible.source.contentRevision}`
              : ""}
          </p>
          <p>Source identification does not establish engineering approval.</p>
        </div>
      )}
    </div>
  );
}
