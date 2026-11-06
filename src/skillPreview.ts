/** Preview text only. Clipboard and file opening keep the untouched source. */
export function skillPreviewMarkdown(contents: string, path: string, expectedTitle: string): string {
  let markdown = contents.replace(/\r\n/g, "\n");
  if (markdown.startsWith("---\n")) {
    const end = markdown.indexOf("\n---", 4);
    if (end !== -1) {
      markdown = markdown.slice(end + 4);
      if (markdown.startsWith("\n")) markdown = markdown.slice(1);
    }
  }
  if (!path && !expectedTitle) return markdown;
  const lines = markdown.split("\n");
  let index = 0;
  while (index < lines.length && !lines[index].trim()) index++;
  if (index === lines.length || !/^#\s+/.test(lines[index].trim())) return markdown;
  index++;
  while (index < lines.length && !lines[index].trim()) index++;
  return lines.slice(index).join("\n");
}
