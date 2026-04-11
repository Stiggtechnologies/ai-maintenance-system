interface MarkdownRendererProps {
  content: string;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

function renderMarkdown(content: string): string {
  let html = escapeHtml(content);

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Inline code
  html = html.replace(
    /`(.+?)`/g,
    '<code class="bg-[#1A2030] px-1 rounded text-sm">$1</code>',
  );
  // Headers
  html = html.replace(
    /^### (.+)$/gm,
    '<h3 class="text-lg font-semibold mt-3 mb-1">$1</h3>',
  );
  html = html.replace(
    /^## (.+)$/gm,
    '<h2 class="text-xl font-semibold mt-4 mb-2">$1</h2>',
  );
  html = html.replace(
    /^# (.+)$/gm,
    '<h1 class="text-2xl font-bold mt-4 mb-2">$1</h1>',
  );
  // List items
  html = html.replace(/^- (.+)$/gm, '<li class="ml-4">$1</li>');
  // Line breaks
  html = html.replace(/\n/g, "<br />");

  return html;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div
      className="prose max-w-none"
      dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
    />
  );
}
