import { Fragment, type ReactNode } from "react";
import type { EvidenceReference } from "../types/sync-stream";

interface MarkdownRendererProps {
  content: string;
  evidence?: EvidenceReference[];
  className?: string;
}

function safeLink(href: string): string | null {
  const value = href.trim();
  if (value.startsWith("/")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function evidenceMap(items: EvidenceReference[] | undefined): Map<string, EvidenceReference> {
  return new Map((items ?? []).map((item) => [item.id, item]));
}

function inlineContent(
  text: string,
  keyPrefix: string,
  evidence: Map<string, EvidenceReference>,
): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\)|\[(?:L|A|R)\d+\])/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    const sourceMatch = token.match(/^\[((?:L|A|R)\d+)\]$/);
    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);

    if (sourceMatch) {
      const source = evidence.get(sourceMatch[1]);
      if (!source) {
        nodes.push(token);
      } else {
        const title = [source.title, source.excerpt].filter(Boolean).join(" — ");
        const href = source.applicationUrl ? safeLink(source.applicationUrl) : null;
        const className =
          "mx-0.5 inline-flex translate-y-[-0.08em] items-center rounded-md border border-cyan-400/20 bg-cyan-400/7 px-1.5 py-0.5 text-[0.72em] font-semibold leading-none text-cyan-200 no-underline";
        nodes.push(
          href ? (
            <a
              key={key}
              href={href}
              title={title || source.id}
              className={className}
              target={href.startsWith("http") ? "_blank" : undefined}
              rel={href.startsWith("http") ? "noreferrer" : undefined}
            >
              {source.id}
            </a>
          ) : (
            <span key={key} title={title || source.id} className={className}>
              {source.id}
            </span>
          ),
        );
      }
    } else if (linkMatch) {
      const href = safeLink(linkMatch[2]);
      nodes.push(
        href ? (
          <a
            key={key}
            href={href}
            target={href.startsWith("http") ? "_blank" : undefined}
            rel={href.startsWith("http") ? "noreferrer" : undefined}
            className="font-medium text-cyan-300 underline decoration-cyan-400/30 underline-offset-2 hover:text-cyan-200"
          >
            {linkMatch[1]}
          </a>
        ) : (
          token
        ),
      );
    } else if (token.startsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold text-slate-100">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith("`")) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-white/7 px-1.5 py-0.5 font-mono text-[0.88em] text-cyan-100"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(
        <em key={key} className="text-slate-200">
          {token.slice(1, -1)}
        </em>,
      );
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableDivider(line: string | undefined): boolean {
  return Boolean(
    line && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line),
  );
}

function startsBlock(lines: string[], index: number): boolean {
  const line = lines[index] || "";
  return (
    /^#{1,3}\s+/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^```/.test(line) ||
    /^\s*---+\s*$/.test(line) ||
    (line.includes("|") && isTableDivider(lines[index + 1]))
  );
}

function renderBlocks(content: string, evidenceItems?: EvidenceReference[]): ReactNode[] {
  const evidence = evidenceMap(evidenceItems);
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const children = inlineContent(heading[2], `heading-${index}`, evidence);
      const common = "font-semibold text-white first:mt-0";
      if (heading[1].length === 1) {
        blocks.push(
          <h1 key={`block-${index}`} className={`mb-3 mt-8 text-xl leading-tight tracking-[-0.015em] ${common}`}>
            {children}
          </h1>,
        );
      } else if (heading[1].length === 2) {
        blocks.push(
          <h2 key={`block-${index}`} className={`mb-2.5 mt-7 text-[17px] leading-snug ${common}`}>
            {children}
          </h2>,
        );
      } else {
        blocks.push(
          <h3 key={`block-${index}`} className="mb-2 mt-5 text-[15px] font-semibold leading-snug text-slate-100 first:mt-0">
            {children}
          </h3>,
        );
      }
      index += 1;
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      blocks.push(<hr key={`block-${index}`} className="my-6 border-0 border-t border-white/8" />);
      index += 1;
      continue;
    }

    if (/^```/.test(line)) {
      const language = line.replace(/^```/, "").trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push(
        <pre
          key={`block-${index}`}
          data-language={language || undefined}
          className="my-5 max-w-full overflow-x-auto rounded-xl border border-white/8 bg-black/25 p-4 font-mono text-[13px] leading-6 text-slate-200"
        >
          <code className="bg-transparent p-0 text-inherit">{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    if (line.includes("|") && isTableDivider(lines[index + 1])) {
      const headers = tableCells(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|")) {
        rows.push(tableCells(lines[index]));
        index += 1;
      }
      blocks.push(
        <div
          className="markdown-table-wrap my-5 max-w-full overflow-x-auto rounded-xl border border-white/10 bg-black/10"
          key={`block-${index}`}
          role="region"
          aria-label="Response table"
          tabIndex={0}
        >
          <table className="w-max min-w-full border-collapse text-left text-[13px] leading-5">
            <thead className="bg-white/5">
              <tr>
                {headers.map((cell, cellIndex) => (
                  <th key={`head-${cellIndex}`} className="min-w-40 border-b border-white/10 px-4 py-3 align-top font-semibold text-slate-100">
                    {inlineContent(cell, `head-${cellIndex}`, evidence)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6">
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`} className="align-top">
                  {headers.map((_, cellIndex) => (
                    <td key={`cell-${rowIndex}-${cellIndex}`} className="min-w-40 max-w-80 px-4 py-3 text-slate-300">
                      {inlineContent(row[cellIndex] || "", `cell-${rowIndex}-${cellIndex}`, evidence)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    const listStart = line.match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
    if (listStart) {
      const ordered = /\d+\./.test(listStart[2]);
      const items: Array<{ text: string; indent: number; checked?: boolean }> = [];
      while (index < lines.length) {
        const item = lines[index].match(/^(\s*)([-*]|\d+\.)\s+(.+)$/);
        if (!item || /\d+\./.test(item[2]) !== ordered) break;
        const text = item[3].trim();
        const task = text.match(/^\[([ xX])\]\s+(.+)$/);
        items.push({
          text: task ? task[2] : text,
          indent: Math.min(3, Math.floor(item[1].length / 2)),
          checked: task ? task[1].toLowerCase() === "x" : undefined,
        });
        index += 1;
      }
      const children = items.map((item, itemIndex) => (
        <li
          key={`item-${index}-${itemIndex}`}
          className="marker:text-slate-500"
          style={{ marginLeft: `${item.indent * 1.1}rem` }}
        >
          {item.checked !== undefined ? (
            <span className="inline-flex items-start gap-2">
              <input type="checkbox" checked={item.checked} readOnly aria-label={item.checked ? "Completed" : "Not completed"} className="mt-1 accent-teal-400" />
              <span>{inlineContent(item.text, `item-${index}-${itemIndex}`, evidence)}</span>
            </span>
          ) : (
            inlineContent(item.text, `item-${index}-${itemIndex}`, evidence)
          )}
        </li>
      ));
      blocks.push(
        ordered ? (
          <ol key={`block-${index}`} className="my-4 list-decimal space-y-2.5 pl-6 text-slate-300">{children}</ol>
        ) : (
          <ul key={`block-${index}`} className="my-4 list-disc space-y-2.5 pl-6 text-slate-300">{children}</ul>
        ),
      );
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(
        <blockquote key={`block-${index}`} className="my-5 border-l-2 border-cyan-400/40 bg-cyan-400/4 py-2 pl-4 pr-3 text-slate-300">
          {inlineContent(quote.join(" "), `quote-${index}`, evidence)}
        </blockquote>,
      );
      continue;
    }

    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      (paragraph.length === 0 || !startsBlock(lines, index))
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(
      <p key={`block-${index}`} className="my-3 max-w-[78ch] text-[15px] leading-[1.72] text-slate-300 sm:text-[16px]">
        {inlineContent(paragraph.join(" "), `paragraph-${index}`, evidence)}
      </p>,
    );
  }

  return blocks.map((block, blockIndex) => (
    <Fragment key={`fragment-${blockIndex}`}>{block}</Fragment>
  ));
}

export function MarkdownRenderer({
  content,
  evidence,
  className = "max-w-none",
}: MarkdownRendererProps) {
  return (
    <div className={`markdown-renderer min-w-0 text-[15px] leading-[1.72] text-slate-300 sm:text-[16px] ${className}`.trim()}>
      {renderBlocks(content, evidence)}
    </div>
  );
}
