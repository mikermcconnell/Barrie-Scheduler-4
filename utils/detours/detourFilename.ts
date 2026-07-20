const MAX_SLUG_LENGTH = 96;

/** Converts planner-entered text into a portable, URL-safe filename segment. */
export function toDetourFilenameSlug(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
}

export interface DetourFilenameInput {
  title: string;
  revision: number;
  startDate?: string;
  extension: 'pdf' | 'png';
}

export function buildDetourFilename(input: DetourFilenameInput): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(input.startDate ?? '')
    ? input.startDate
    : new Date().toISOString().slice(0, 10);
  const slug = toDetourFilenameSlug(input.title) || 'detour-notice';
  const revision = Math.max(1, Math.trunc(input.revision || 1));
  return `${date}-${slug}-v${revision}.${input.extension}`;
}
