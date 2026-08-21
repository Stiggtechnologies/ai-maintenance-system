import { Fragment, type ReactNode } from "react";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

function inlineContent(text: string, keyPrefix: string): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;
    if (token.startsWith("**")) {
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

function renderBlocks(content: string): ReactNode[] {
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
      const children = inlineContent(heading[2], `heading-${index}`);
      if (heading[1].length === 1) {
        blocks.push(
          <h1
            key={`block-${index}`}
            className="mb-3 mt-8 text-xl font-semibold leading-tight tracking-[-0.015em] text-white first:mt-0"
          >
            {children}
          </h1>,
        );
      } else if (heading[1].length === 2) {
        blocks.push(
          <h2
            key={`block-${index}`}
            className="mb-2.5 mt-7 text-[17px] font-semibold leading-snug text-white first:mt-0"
          >
            {children}
          </h2>,
        );
      } else {
        blocks.push(
          <h3
            key={`block-${index}`}
            className="mb-2 mt-5 text-[15px] font-semibold leading-snug text-slate-100 first:mt-0"
          >
            {children}
          </h3>,
        );
      }
      index += 1;
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      blocks.push(
        <hr key={`block-${index}`} className="my-6 border-0 border-t border-white/8" />,
      );
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
                  <th
                    key={`head-${cellIndex}`}
                    className="min-w-40 border-b border-white/10 px-4 py-3 align-top font-semibold text-slate-100"
                  >
                    {inlineContent(cell, `head-${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6">
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`} className="align-top">
                  {headers.map((_, cellIndex) => (
                    <td
                      key={`cell-${rowIndex}-${cellIndex}`}
                      className="min-w-40 max-w-80 px-4 py-3 text-slate-300"
                    >
                      {inlineContent(
                        row[cellIndex] || "",
                        `cell-${rowIndex}-${cellIndex}`,
                      )}
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

    const unordered = /^\s*[-*]\s+/.test(line);
    const ordered = /^\s*\d+\.\s+/.test(line);
    if (unordered || ordered) {
      const items: string[] = [];
      const pattern = unordered ? /^\s*[-*]\s+/ : /^\s*\d+\.\s+/;
      while (index < lines.length && pattern.test(lines[index])) {
        items.push(lines[index].replace(pattern, "").trim());
        index += 1;
      }
      const children = items.map((item, itemIndex) => (
        <li key={`item-${index}-${itemIndex}`} className="pl-1 marker:text-slate-500">
          {inlineContent(item, `item-${index}-${itemIndex}`)}
        </li>
      ));
      blocks.push(
        ordered ? (
          <ol
            key={`block-${index}`}
            className="my-4 list-decimal space-y-2.5 pl-6 text-slate-300"
          >
            {children}
          </ol>
        ) : (
          <ul
            key={`block-${index}`}
            className="my-4 list-disc space-y-2.5 pl-6 text-slate-300"
          >
            {children}
          </ul>
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
        <blockquote
          key={`block-${index}`}
          className="my-5 border-l-2 border-cyan-400/40 bg-cyan-400/4 py-2 pl-4 pr-3 text-slate-300"
        >
          {inlineContent(quote.join(" "), `quote-${index}`)}
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
      <p
        key={`block-${index}`}
        className="my-3 max-w-[78ch] text-[15px] leading-[1.72] text-slate-300 sm:text-[16px]"
      >
        {inlineContent(paragraph.join(" "), `paragraph-${index}`)}
      </p>,
    );
  }

  return blocks.map((block, index) => (
    <Fragment key={`fragment-${index}`}>{block}</Fragment>
  ));
}

export function MarkdownRenderer({
  content,
  className = "max-w-none",
}: MarkdownRendererProps) {
  return (
    <div
      className={`markdown-renderer min-w-0 text-[15px] leading-[1.72] text-slate-300 sm:text-[16px] ${className}`.trim()}
    >
      {renderBlocks(content)}
    </div>
  );
}
