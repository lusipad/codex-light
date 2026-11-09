export type ComposerEnterBehavior = "enter" | "cmdIfMultiline" | "cmdAlways";
export type FollowUpMode = "queue" | "steer";

export function normalizeFollowUpMode(value: unknown): FollowUpMode {
  return value === "queue" ? "queue" : "steer";
}

export function normalizeComposerEnterBehavior(value: unknown): ComposerEnterBehavior {
  return value === "cmdIfMultiline" || value === "cmdAlways" ? value : "enter";
}
