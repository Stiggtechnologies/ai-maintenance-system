import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownRenderer } from './MarkdownRenderer';

describe('MarkdownRenderer', () => {
  it('renders plain text content', () => {
    render(<MarkdownRenderer content="Hello world" />);
    expect(screen.getByText(/Hello world/)).toBeInTheDocument();
  });

  it('renders bold text', () => {
    const { container } = render(<MarkdownRenderer content="**bold text**" />);
    const strong = container.querySelector('strong');
    expect(strong).toBeInTheDocument();
    expect(strong?.textContent).toBe('bold text');
  });

  it('escapes HTML to prevent XSS', () => {
    const malicious = '<script>alert("xss")</script>';
    const { container } = render(<MarkdownRenderer content={malicious} />);
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toContain('<script>');
  });

  it('renders list items', () => {
    const { container } = render(<MarkdownRenderer content="- item one" />);
    const li = container.querySelector('li');
    expect(li).toBeInTheDocument();
    expect(li?.textContent).toBe('item one');
  });
});
