export function buildSkillTrialPrompt(skill: { name: string; path?: string | null; defaultPrompt?: string | null }): string {
  const label = `$${skill.name}`;
  const escapedLabel = label.replaceAll("\\", "\\\\").replaceAll("[", "\\[")
    .replaceAll("](", "]\\(").replaceAll("]", "\\]");
  const reference = skill.path
    ? `[${escapedLabel}](${skill.path.replaceAll("\\", "\\\\").replaceAll(")", "\\)")})`
    : label;
  const prompt = skill.defaultPrompt?.trim();
  if (!prompt) return `${reference} `;
  const lower = prompt.toLowerCase();
  if (lower.includes(`[$${skill.name.toLowerCase()}](`)
    || (!skill.path && lower.includes(label.toLowerCase()))) return `${prompt} `;
  return `${prompt} ${reference} `;
}
