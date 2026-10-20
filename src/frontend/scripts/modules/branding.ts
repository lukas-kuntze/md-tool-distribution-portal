import type { BrandingDto } from '../../../shared/types/api.js';
import { settingsService } from '../../services/settings-service.js';
import { App } from '../core/app.js';
import { alertBox, h, render } from '../core/dom.js';

/** Name the pages carry in their static markup; replaced by the configured name of the portal. */
export const DEFAULT_PORTAL_NAME = 'App-Distribution';

/**
 * Name, contact and texts of the portal from the settings, on every page: the browser tab, `[data-portal-name]`,
 * the footer of the public pages and `[data-branding-notice]` on download and share pages. Pages keep their
 * static texts when the settings cannot be loaded.
 */
export const Branding = App.register('Branding', {
  async init(): Promise<void> {
    try {
      applyBranding(await settingsService.branding());
    } catch {
      // The static defaults stay; branding is never worth an error message.
    }
  },
});

export function applyBranding(branding: BrandingDto): void {
  if (branding.portalName !== DEFAULT_PORTAL_NAME) {
    document.title = document.title.replace(DEFAULT_PORTAL_NAME, branding.portalName);
  }

  for (const element of document.querySelectorAll('[data-portal-name]')) {
    element.textContent = branding.portalName;
  }

  for (const footer of document.querySelectorAll<HTMLElement>('.public-footer')) {
    footer.textContent = branding.footerText;
    footer.hidden = branding.footerText === '';
  }

  for (const target of document.querySelectorAll('[data-branding-notice]')) {
    render(target, notice(branding));
  }
}

function notice({ publicNotice, supportContact }: BrandingDto): Node | null {
  if (publicNotice === '' && supportContact === '') {
    return null;
  }

  return alertBox(
    'info',
    'Hinweis',
    publicNotice,
    supportContact === '' ? null : h('p', { class: 'branding-contact' }, `Fragen? ${supportContact}`),
  );
}
