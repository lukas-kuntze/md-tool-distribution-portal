// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { inlineImages, insertPartials } from '../../vite.config.js';

describe('vite page transforms', (): void => {
  it('inserts nested partials', (): void => {
    const partials: Record<string, string> = { outer: '<header><!-- @inner --></header>', inner: '<h1>Hi</h1>' };

    expect(insertPartials('<body><!-- @outer --></body>', (name) => partials[name] ?? '')).toBe(
      '<body><header><h1>Hi</h1></header></body>',
    );
  });

  it('embeds images of assets/images as data URIs and leaves other sources alone', (): void => {
    const html =
      '<img src="../assets/images/logo.webp" alt="" /><img src="../assets/images/icon.svg" /><img src="/other.png" />';

    expect(inlineImages(html, (name) => Buffer.from(name))).toBe(
      `<img src="data:image/webp;base64,${Buffer.from('logo.webp').toString('base64')}" alt="" />` +
        `<img src="data:image/svg+xml;base64,${Buffer.from('icon.svg').toString('base64')}" /><img src="/other.png" />`,
    );
  });

  it('embeds the real logo', (): void => {
    const html = inlineImages('<img src="../assets/images/medifox-dan-logo.webp" />');

    expect(html).toMatch(/^<img src="data:image\/webp;base64,UklGR/);
  });
});
