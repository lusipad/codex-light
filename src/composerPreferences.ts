export type ComposerEnterBehavior = "enter" | "cmdIfMultiline" | "cmdAlways";

export function normalizeComposerEnterBehavior(value: unknown): ComposerEnterBehavior {
  return value === "cmdIfMultiline" || value === "cmdAlways" ? value : "enter";
}
