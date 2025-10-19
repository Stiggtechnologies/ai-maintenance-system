import { ReactNode } from 'react';

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const parseMarkdown = (text: string): ReactNode[] => {
    const lines = text.split('\n');
    const elements: ReactNode[] = [];
    let currentList: { items: string[]; type: 'ul' | 'ol' } | null = null;
    let currentCodeBlock: string[] | null = null;
    let inCodeBlock = false;

    lines.forEach((line, index) => {
      if (line.trim().startsWith('```')) {
        if (inCodeBlock && currentCodeBlock) {
          elements.push(
            <pre key={`code-${index}`} className="bg-gray-900 text-gray-100 rounded-lg p-4 my-3 overflow-x-auto">
              <code className="text-sm font-mono">{currentCodeBlock.join('\n')}</code>
            </pre>
          );
          currentCodeBlock = null;
        } else {
          currentCodeBlock = [];
        }
        inCodeBlock = !inCodeBlock;
        return;
      }

      if (inCodeBlock && currentCodeBlock) {
        currentCodeBlock.push(line);
        return;
      }

      if (line.trim().match(/^#{1,6}\s/)) {
        if (currentList) {
          elements.push(renderList(currentList, index));
          currentList = null;
        }

        const level = line.match(/^#{1,6}/)?.[0].length || 1;
        const text = line.replace(/^#{1,6}\s/, '');
        const HeadingTag = `h${level}` as keyof JSX.IntrinsicElements;
        const classes = {
          1: 'text-2xl font-bold text-gray-900 mt-6 mb-4',
          2: 'text-xl font-bold text-gray-900 mt-5 mb-3',
          3: 'text-lg font-semibold text-gray-900 mt-4 mb-2',
          4: 'text-base font-semibold text-gray-800 mt-3 mb-2',
          5: 'text-sm font-semibold text-gray-800 mt-2 mb-1',
          6: 'text-sm font-semibold text-gray-700 mt-2 mb-1'
        };

        elements.push(
          <HeadingTag key={`h-${index}`} className={classes[level as keyof typeof classes]}>
            {parseInlineMarkdown(text)}
          </HeadingTag>
        );
      } else if (line.trim().match(/^[-*]\s/)) {
        const item = line.replace(/^[-*]\s/, '');
        if (!currentList || currentList.type !== 'ul') {
          if (currentList) {
            elements.push(renderList(currentList, index));
          }
          currentList = { items: [item], type: 'ul' };
        } else {
          currentList.items.push(item);
        }
      } else if (line.trim().match(/^\d+\.\s/)) {
        const item = line.replace(/^\d+\.\s/, '');
        if (!currentList || currentList.type !== 'ol') {
          if (currentList) {
            elements.push(renderList(currentList, index));
          }
          currentList = { items: [item], type: 'ol' };
        } else {
          currentList.items.push(item);
        }
      } else if (line.trim().startsWith('---')) {
        if (currentList) {
          elements.push(renderList(currentList, index));
          currentList = null;
        }
        elements.push(<hr key={`hr-${index}`} className="my-4 border-gray-200" />);
      } else if (line.trim()) {
        if (currentList) {
          elements.push(renderList(currentList, index));
          currentList = null;
        }
        elements.push(
          <p key={`p-${index}`} className="text-gray-700 leading-relaxed mb-3">
            {parseInlineMarkdown(line)}
          </p>
        );
      } else {
        if (currentList) {
          elements.push(renderList(currentList, index));
          currentList = null;
        }
        if (elements.length > 0 && line === '') {
          elements.push(<div key={`space-${index}`} className="h-2" />);
        }
      }
    });

    if (currentList) {
      elements.push(renderList(currentList, elements.length));
    }

    return elements;
  };

  const renderList = (list: { items: string[]; type: 'ul' | 'ol' }, key: number) => {
    const ListTag = list.type;
    const listClass = list.type === 'ul' ? 'list-disc' : 'list-decimal';

    return (
      <ListTag key={`list-${key}`} className={`${listClass} pl-6 mb-4 space-y-1.5`}>
        {list.items.map((item, i) => (
          <li key={i} className="text-gray-700 leading-relaxed">
            {parseInlineMarkdown(item)}
          </li>
        ))}
      </ListTag>
    );
  };

  const parseInlineMarkdown = (text: string): ReactNode => {
    const parts: ReactNode[] = [];
    let remaining = text;
    let key = 0;

    const patterns: Array<{ regex: RegExp; render: (...args: string[]) => ReactNode }> = [
      { regex: /\*\*(.+?)\*\*/g, render: (content: string) => <strong key={`b-${key++}`} className="font-semibold text-gray-900">{content}</strong> },
      { regex: /\*(.+?)\*/g, render: (content: string) => <em key={`i-${key++}`} className="italic">{content}</em> },
      { regex: /`(.+?)`/g, render: (content: string) => <code key={`c-${key++}`} className="bg-gray-100 text-teal-700 px-1.5 py-0.5 rounded text-sm font-mono">{content}</code> },
      { regex: /\[(.+?)\]\((.+?)\)/g, render: (_full: string, linkText: string, url: string) => <a key={`a-${key++}`} href={url} className="text-teal-600 hover:text-teal-700 underline" target="_blank" rel="noopener noreferrer">{linkText}</a> }
    ];

    while (remaining) {
      type MatchType = { index: number; length: number; element: ReactNode };
      let earliestMatch: MatchType | null = null;

      patterns.forEach(pattern => {
        const regex = new RegExp(pattern.regex);
        const match = regex.exec(remaining);

        if (match && (earliestMatch === null || match.index < earliestMatch.index)) {
          if (pattern.regex.source.includes('\\[')) {
            earliestMatch = {
              index: match.index,
              length: match[0].length,
              element: pattern.render(match[0], match[1], match[2])
            };
          } else {
            earliestMatch = {
              index: match.index,
              length: match[0].length,
              element: pattern.render(match[1])
            };
          }
        }
      });

      if (earliestMatch !== null) {
        const matchData: MatchType = earliestMatch;
        if (matchData.index > 0) {
          parts.push(remaining.substring(0, matchData.index));
        }
        parts.push(matchData.element);
        remaining = remaining.substring(matchData.index + matchData.length);
      } else {
        parts.push(remaining);
        break;
      }
    }

    return <>{parts}</>;
  };

  return <div className="markdown-content">{parseMarkdown(content)}</div>;
}
