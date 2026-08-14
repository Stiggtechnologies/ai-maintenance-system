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
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
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
        blocks.push(<h1 key={`block-${index}`}>{children}</h1>);
      } else if (heading[1].length === 2) {
        blocks.push(<h2 key={`block-${index}`}>{children}</h2>);
      } else {
        blocks.push(<h3 key={`block-${index}`}>{children}</h3>);
      }
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
        <pre key={`block-${index}`} data-language={language || undefined}>
          <code>{code.join("\n")}</code>
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
        <div className="markdown-table-wrap" key={`block-${index}`}>
          <table>
            <thead>
              <tr>
                {headers.map((cell, cellIndex) => (
                  <th key={`head-${cellIndex}`}>
                    {inlineContent(cell, `head-${cellIndex}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {headers.map((_, cellIndex) => (
                    <td key={`cell-${rowIndex}-${cellIndex}`}>
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
        <li key={`item-${index}-${itemIndex}`}>
          {inlineContent(item, `item-${index}-${itemIndex}`)}
        </li>
      ));
      blocks.push(
        ordered ? (
          <ol key={`block-${index}`}>{children}</ol>
        ) : (
          <ul key={`block-${index}`}>{children}</ul>
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
        <blockquote key={`block-${index}`}>
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
      <p key={`block-${index}`}>
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
  className = "prose max-w-none",
}: MarkdownRendererProps) {
  return (
    <div className={`markdown-renderer ${className}`.trim()}>
      {renderBlocks(content)}
    </div>
  );
}
