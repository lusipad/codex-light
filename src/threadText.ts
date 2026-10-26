import { TurnItem } from "./types";

export function extractTextFromItem(item: TurnItem): string {
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.content)) {
    return item.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (Array.isArray((item as any).parts)) {
    return (item as any).parts
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (Array.isArray(item.summary)) {
    return item.summary
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}
