/**
 * Plain text from an Office XML run.
 *
 * Remove every complete tag, repeating until the string is stable, then
 * delete any leftover `<` or `>`. An unterminated fragment such as `<script`
 * has no closing `>`, so the tag pattern never matches it; the final bracket
 * pass removes it. Well-formed OOXML text is already escaped (`&lt;`), so
 * ordinary document text is unchanged.
 */
export function stripXmlMarkup(value: string): string {
  let current = value;
  let previous: string;
  do {
    previous = current;
    current = current.replace(/<[^>]*>/g, "");
  } while (current !== previous);
  return current.replace(/[<>]/g, "");
}
