import fs from 'node:fs/promises';

export const themeKey = (model, ids) => `${model}:${ids.slice(0, 5).join(',')}`;

export function validateThemeLabel(label) {
  const words = label?.name?.trim().split(/\s+/).length;
  if (!words || words < 4 || words > 8 || /[/,;|]/.test(label.name)
      || !label.description?.trim() || /^Research on\b/i.test(label.description)
      || !/[.!?]$/.test(label.description.trim())) {
    throw new Error(`Invalid research-area label: ${JSON.stringify(label)}`);
  }
  return { name: label.name, description: label.description };
}

export async function loadThemeLabels() {
  return JSON.parse(await fs.readFile(new URL('../data/theme-labels.json', import.meta.url), 'utf8'));
}
