/** Display formats of the German user interface. */
const dateTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
const date = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' });
const decimal = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

export function formatDateTime(iso: string | null): string {
  return iso === null ? '—' : dateTime.format(new Date(iso));
}

export function formatDate(iso: string | null): string {
  return iso === null ? '—' : date.format(new Date(iso));
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${unit === 0 ? String(value) : decimal.format(value)} ${UNITS[unit] ?? 'B'}`;
}

/** First seven characters, as Git shows commit hashes. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/** `4.13.0 (125)`: how releases are named throughout the platform. */
export function releaseLabel(release: { readonly version: string; readonly buildNumber: number }): string {
  return `${release.version} (${release.buildNumber})`;
}

/** URL-safe slug suggested from a display name, e.g. `MD Ambulant` → `md-ambulant`. */
export function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
}
