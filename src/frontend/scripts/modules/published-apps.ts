import type { SharedApplicationDto, SharedArtifactDto, SharedReleaseDto } from '../../../shared/types/api.js';
import { isAppleMobileDevice } from '../core/device.js';
import { badge, h, icon } from '../core/dom.js';
import { formatBytes, formatDate, releaseLabel } from '../core/format.js';
import { whileBusy } from '../core/forms.js';
import { PLATFORM_LABELS } from '../core/labels.js';
import { describeError } from '../core/messages.js';
import { Toast } from './toast.js';

export interface PublishedAppOptions {
  /**
   * Requests an `itms-services` address for IPAs that come without one; signed-in employees get a short-lived
   * link per tap, share links carry a fixed one.
   */
  readonly requestInstall?: (artifactId: string) => Promise<string>;
}

/**
 * Card of a published application as customers (share links) and employees (download page) see it: icon,
 * installation notes and the releases with download and iOS installation.
 */
export function applicationCard(application: SharedApplicationDto, options: PublishedAppOptions = {}): HTMLElement {
  const seenFlavors = new Set<string | null>();

  return h(
    'article',
    { class: 'card share-app', 'aria-labelledby': `app-${application.id}` },
    h(
      'div',
      { class: 'card-header' },
      h(
        'div',
        { class: 'app-heading' },
        appIcon(application.iconUrl),
        h('h2', { class: 'card-title', id: `app-${application.id}` }, application.name),
      ),
      h(
        'span',
        { class: 'badge-row' },
        application.platforms.map((platform) => badge(PLATFORM_LABELS[platform], 'neutral')),
      ),
    ),
    h(
      'div',
      { class: 'card-body' },
      application.description === '' ? null : h('p', { class: 'text-muted card-text' }, application.description),
      application.installNotes === ''
        ? null
        : h(
            'div',
            { class: 'install-notes' },
            h('strong', {}, 'Hinweise zur Installation'),
            h('p', {}, application.installNotes),
          ),
      application.releases.length === 0
        ? h('p', { class: 'text-muted' }, 'Noch keine veröffentlichte Version.')
        : h(
            'ol',
            { class: 'share-releases' },
            application.releases.map((release) => {
              // Releases arrive grouped by flavor, newest first: the first one of each flavor is current.
              const latest = !seenFlavors.has(release.flavorName);
              seenFlavors.add(release.flavorName);
              return releaseItem(release, latest, options);
            }),
          ),
    ),
  );
}

/** The icon of an application or project, or a neutral placeholder of the same size. */
export function appIcon(url: string | null, size: 'sm' | 'md' | 'lg' = 'md', placeholder = 'apps'): HTMLElement {
  return url === null
    ? h('span', { class: `app-icon app-icon-${size} app-icon-placeholder`, 'aria-hidden': 'true' }, icon(placeholder))
    : h('img', { class: `app-icon app-icon-${size}`, src: url, alt: '', loading: 'lazy' });
}

function releaseItem(release: SharedReleaseDto, latest: boolean, options: PublishedAppOptions): HTMLElement {
  return h(
    'li',
    { class: 'share-release' },
    h(
      'div',
      { class: 'share-release-head' },
      h(
        'div',
        {},
        h('strong', { class: 'share-version' }, releaseLabel(release)),
        ' ',
        latest ? badge('Aktuell', 'success') : null,
        release.flavorName === null ? null : [' ', badge(release.flavorName, 'neutral')],
        h('div', { class: 'text-muted' }, `Veröffentlicht ${formatDate(release.publishedAt)}`),
      ),
      h(
        'div',
        { class: 'share-actions' },
        release.artifacts.map((artifact) => artifactAction(artifact, latest, options)),
      ),
    ),
    release.releaseNotes === ''
      ? null
      : h(
          'details',
          { class: 'share-notes', open: latest },
          h('summary', {}, 'Neuerungen'),
          h('p', {}, release.releaseNotes),
        ),
  );
}

/** Only current releases get the primary action; older ones stay secondary. */
function artifactAction(artifact: SharedArtifactDto, latest: boolean, options: PublishedAppOptions): HTMLElement {
  const size = formatBytes(artifact.sizeBytes);
  const installClass = `btn ${latest ? 'btn-primary' : 'btn-outline'} btn-sm`;

  if (artifact.kind === 'ipa' && isAppleMobileDevice()) {
    if (artifact.installUrl !== null) {
      return h(
        'a',
        { class: installClass, href: artifact.installUrl },
        icon('install_mobile'),
        'Auf diesem Gerät installieren',
      );
    }

    const { requestInstall } = options;

    if (requestInstall !== undefined) {
      const button = h(
        'button',
        { type: 'button', class: installClass },
        icon('install_mobile'),
        'Auf diesem Gerät installieren',
      );
      button.addEventListener('click', () => {
        void whileBusy(button, async () => {
          try {
            window.location.assign(await requestInstall(artifact.id));
          } catch (error) {
            Toast.show('danger', 'Installation nicht möglich', describeError(error));
          }
        });
      });
      return button;
    }
  }

  const label =
    artifact.platform === 'ios' ? `iOS (IPA, ${size})` : `Android (${artifact.kind.toUpperCase()}, ${size})`;
  return h('a', { class: 'btn btn-outline btn-sm', href: artifact.downloadUrl, download: '' }, icon('download'), label);
}
