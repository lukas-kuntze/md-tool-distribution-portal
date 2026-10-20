import { describe, expect, it } from 'vitest';

import { parseSlug, SLUG_MAX_LENGTH, suggestSlug } from './slug.js';

describe('parseSlug', (): void => {
  it.each(['md-ambulant', 'k-mobile', 'app2'])('accepts %s', (value): void => {
    expect(parseSlug(value)).toBe(value);
  });

  it.each(['K-Mobile', '-leading', 'trailing-', 'double--hyphen', 'with space', '..', 'a'.repeat(SLUG_MAX_LENGTH + 1)])(
    'rejects %s',
    (value): void => {
      expect((): string => parseSlug(value)).toThrow(expect.objectContaining({ code: 'invalid_slug' }));
    },
  );
});

describe('suggestSlug', (): void => {
  it('transliterates German umlauts and collapses separators', (): void => {
    expect(suggestSlug('Unterstützung & Größe')).toBe('unterstuetzung-groesse');
  });

  it('removes diacritics', (): void => {
    expect(suggestSlug('Café Doku')).toBe('cafe-doku');
  });

  it('never ends with a hyphen after truncation', (): void => {
    const suggestion = suggestSlug(`${'a'.repeat(SLUG_MAX_LENGTH - 1)} b`);

    expect(suggestion).toBe('a'.repeat(SLUG_MAX_LENGTH - 1));
    expect(parseSlug(suggestion)).toBe(suggestion);
  });

  it('returns an empty string when nothing usable remains', (): void => {
    expect(suggestSlug('!!!')).toBe('');
  });
});
