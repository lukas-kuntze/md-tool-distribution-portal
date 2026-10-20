import { ApiError } from '../../services/api-client.js';
import { shares } from '../../services/share-service.js';
import { App } from '../core/app.js';
import { isAppleMobileDevice } from '../core/device.js';
import { alertBox, emptyState, errorState, h, render, required } from '../core/dom.js';
import { formatDate } from '../core/format.js';
import { describeError, messageForCode } from '../core/messages.js';
import { applicationCard } from './published-apps.js';

/**
 * The page customers open from a share link (`share.html#<secret>`): the published releases of the shared
 * project or application, with downloads and the iOS installation. No account and no session are involved;
 * the secret in the URL fragment is the only credential and never reaches a server log as part of the page
 * address.
 */
export const SharePage = App.register('SharePage', {
  async init(): Promise<void> {
    const root = document.querySelector<HTMLElement>('[data-share-page]');

    if (root === null) {
      return;
    }

    const token = window.location.hash.slice(1);
    const state = required('[data-page-state]', root);

    if (token === '') {
      render(state, invalidLink());
      return;
    }

    try {
      const content = await shares.content(token);

      document.title = `${content.project.name} · Freigabe`;
      required('[data-share-label]', root).textContent = `Freigabe für ${content.label}`;
      required('[data-share-project]', root).textContent = content.project.name;
      required('[data-share-description]', root).textContent = content.project.description;
      render(
        required('[data-share-notice]', root),
        content.releases === 'latest'
          ? h('p', { class: 'text-muted share-hint' }, 'Hier steht immer die aktuelle Version bereit.')
          : null,
        content.expiresAt === null
          ? null
          : alertBox(
              'info',
              `Dieser Link gilt bis ${formatDate(content.expiresAt)}.`,
              'Danach sind die Downloads nicht mehr erreichbar.',
            ),
        isAppleMobileDevice()
          ? null
          : alertBox(
              'info',
              'iPhone und iPad',
              'iOS-Apps lassen sich nur direkt auf dem Gerät installieren: Öffne diesen Link dort in Safari.',
            ),
      );
      render(
        required('[data-share-applications]', root),
        content.applications.length === 0
          ? emptyState('apps', 'Noch nichts freigegeben', 'Hier erscheinen die Apps, sobald sie veröffentlicht sind.')
          : content.applications.map((application) => applicationCard(application)),
      );
      required('[data-page-content]', root).hidden = false;
    } catch (error) {
      render(
        state,
        error instanceof ApiError && error.status === 404
          ? invalidLink()
          : errorState(describeError(error), () => void SharePage.init()),
      );
    }
  },
});

function invalidLink(): HTMLElement {
  return emptyState(
    'link_off',
    'Link nicht verfügbar',
    `${messageForCode('share_link_not_found')} Bitte wende dich an deinen Ansprechpartner.`,
  );
}
