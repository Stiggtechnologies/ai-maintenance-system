interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="prose max-w-none">
      <div dangerouslySetInnerHTML={{ __html: content.replace(/\n/g, '<br />') }} />
    </div>
  );
}
