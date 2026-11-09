/**
 * Replace the same nonempty angle spans as /<[^>]+>/g with one space.
 * Text extraction only, NOT an HTML sanitizer. Empty <> and unmatched tails
 * remain literal; nested '<' belongs to the span ending at the first '>'.
 * Each search advances past its inspected span, or stops at the final tail.
 */
export function replaceNonemptyAngleSpans(text: string): string {
  const parts: string[] = [];
  let copied = 0;
  let search = 0;
  while (search < text.length) {
    const opening = text.indexOf('<', search);
    if (opening === -1) break;
    const closing = text.indexOf('>', opening + 1);
    if (closing === -1) break;
    search = closing + 1;
    if (closing === opening + 1) continue;
    parts.push(text.slice(copied, opening), ' ');
    copied = search;
  }
  parts.push(text.slice(copied));
  return parts.join('');
}
