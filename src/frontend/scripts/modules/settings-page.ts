import type { PlatformSettingsDto, SettingsDto } from '../../../shared/types/api.js';
import { api } from '../../services/api-client.js';
import { settingsService } from '../../services/settings-service.js';
import { currentUser } from '../../services/session-service.js';
import { App } from '../core/app.js';
import { emptyState, errorState, h, loadingState, render } from '../core/dom.js';
import { setValue, submit, value, type Validation } from '../core/forms.js';
import { describeError } from '../core/messages.js';
import { Toast } from './toast.js';

const number = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

type Entry = readonly [label: string, value: string | Node, variable?: string];

type NumberSetting = Exclude<
  {
    [Key in keyof SettingsDto]: SettingsDto[Key] extends number | null ? Key : never;
  }[keyof SettingsDto],
  'rowVersion'
>;
type TextSetting = 'portalName' | 'supportContact' | 'publicNotice' | 'footerText';

interface NumberField {
  readonly name: NumberSetting;
  readonly label: string;
  readonly unit: string;
  readonly range: readonly [number, number];
  /** Empty means "no value" (`null`), e.g. share links without expiry. */
  readonly optional?: string;
  readonly helper?: string;
}

/** Same ranges as the server; checked here for immediate feedback. */
const NUMBER_FIELDS: Readonly<Record<string, readonly NumberField[]>> = {
  deletion: [
    {
      name: 'quarantineDays',
      label: 'Quarantäne bis zur endgültigen Löschung',
      unit: 'Tage',
      range: [1, 90],
      helper: 'Gilt für Releases und Artefakte, deren Löschung ab jetzt beantragt wird.',
    },
  ],
  security: [
    { name: 'sessionAbsoluteHours', label: 'Sitzung höchstens', unit: 'Stunden', range: [1, 168] },
    {
      name: 'sessionIdleMinutes',
      label: 'Abmeldung nach Inaktivität',
      unit: 'Minuten',
      range: [5, 1440],
      helper: 'Höchstens so lang wie die Sitzung selbst.',
    },
    {
      name: 'installLinkMinutes',
      label: 'Gültigkeit von iOS-Installationslinks',
      unit: 'Minuten',
      range: [1, 60],
    },
  ],
  shares: [
    {
      name: 'shareLinkDefaultDays',
      label: 'Vorgabe für die Gültigkeit',
      unit: 'Tage',
      range: [1, 365],
      optional: 'Leer: neue Freigaben sind zunächst unbefristet.',
    },
    {
      name: 'shareLinkMaxDays',
      label: 'Längste erlaubte Gültigkeit',
      unit: 'Tage',
      range: [1, 730],
      optional: 'Leer: keine Grenze, auch unbefristete Freigaben sind erlaubt.',
    },
  ],
  storage: [{ name: 'reconcileHours', label: 'Abgleich Datenbank/Ablage alle', unit: 'Stunden', range: [1, 168] }],
  dashboard: [
    { name: 'dashboardDownloadDays', label: 'Downloads der letzten', unit: 'Tage', range: [1, 365] },
    { name: 'dashboardQuarantineDays', label: 'Endgültige Löschung steht bevor in', unit: 'Tagen', range: [1, 90] },
    { name: 'dashboardShareExpiryDays', label: 'Freigabe läuft bald ab in', unit: 'Tagen', range: [1, 90] },
  ],
};

const TEXT_LIMITS: Readonly<Record<TextSetting, readonly [number, number]>> = {
  portalName: [1, 60],
  supportContact: [0, 200],
  publicNotice: [0, 1000],
  footerText: [0, 200],
};

/**
 * Settings (`settings.html`). Platform administrators (`settings.manage`) change the behaviour of the platform
 * here; it applies within seconds, without a restart. Below, platform operations (`storage.manage`) see the
 * configuration the service was started with, read-only and without secrets.
 */
export const SettingsPage = App.register('SettingsPage', {
  async init(): Promise<void> {
    const root = document.querySelector<HTMLElement>('[data-settings-page]');

    if (root === null) {
      return;
    }

    render(root, loadingState());

    try {
      const { capabilities } = await currentUser();

      if (!capabilities.manageSettings && !capabilities.manageStorage) {
        render(
          root,
          emptyState('lock', 'Keine Berechtigung', 'Die Einstellungen sind der Plattformverwaltung vorbehalten.'),
        );
        return;
      }

      const [settings, platform] = await Promise.all([
        capabilities.manageSettings ? settingsService.get() : null,
        capabilities.manageStorage ? api.get<PlatformSettingsDto>('/api/platform-settings') : null,
      ]);

      render(
        root,
        h(
          'div',
          { class: 'stack' },
          settings === null ? null : settingsForm(settings),
          platform === null
            ? null
            : [
                h(
                  'div',
                  {},
                  h('h2', { class: 'section-title' }, 'Betrieb'),
                  h(
                    'p',
                    { class: 'text-muted' },
                    'Mit diesen Werten wurde der Dienst gestartet. Geändert werden sie über seine Umgebungsvariablen (siehe ',
                    h('code', {}, '.env.example'),
                    '); Geheimnisse werden nie angezeigt.',
                  ),
                ),
                settingsView(platform),
              ],
        ),
      );
    } catch (error) {
      render(root, errorState(describeError(error)));
    }
  },
});

function settingsForm(initial: SettingsDto): HTMLFormElement {
  let current = initial;
  const form = h(
    'form',
    { class: 'stack', id: 'settings-form', novalidate: true },
    formCard('Löschung', numberFields('deletion')),
    formCard('Sicherheit', numberFields('security')),
    formCard('Freigabelinks', [
      ...numberFields('shares'),
      choice('shareLinkDefaultReleases', 'Vorgabe für den Inhalt', [
        ['all', 'Alle veröffentlichten Releases'],
        ['latest', 'Nur die neueste Version je Flavor'],
      ]),
    ]),
    formCard('Anwendungen', [
      choice('defaultVisibility', 'Sichtbarkeit neuer Anwendungen', [
        ['private', 'Privat – nur Personen mit einer Rolle'],
        ['organization', 'Organisation – alle angemeldeten Mitglieder'],
      ]),
    ]),
    formCard('Speicher', numberFields('storage')),
    formCard('Übersicht', numberFields('dashboard')),
    formCard('Darstellung', [
      textField('portalName', 'Name des Portals', 'Erscheint im Browser-Tab und auf Download- und Freigabeseiten.'),
      textField(
        'supportContact',
        'Ansprechpartner bei Fragen',
        'z. B. E-Mail-Adresse oder Telefonnummer des Supports.',
      ),
      textField(
        'publicNotice',
        'Hinweis auf Download- und Freigabeseiten',
        'z. B. unterstützte Geräte. Nur Text, Zeilenumbrüche bleiben erhalten.',
        true,
      ),
      textField('footerText', 'Fußzeile', 'Erscheint unten auf Download- und Freigabeseiten.'),
    ]),
    h(
      'div',
      { class: 'form-actions' },
      h('button', { type: 'submit', class: 'btn btn-primary' }, 'Einstellungen speichern'),
    ),
  );

  fill(form, current);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit(
      form,
      async () => {
        current = await settingsService.save({ ...read(form), rowVersion: current.rowVersion });
        fill(form, current);
        Toast.show('success', 'Einstellungen gespeichert', 'Sie gelten nach wenigen Sekunden, ohne Neustart.');
      },
      () => validate(form),
    );
  });

  return form;
}

function numberFields(group: string): HTMLElement[] {
  return (NUMBER_FIELDS[group] ?? []).map((field) => {
    const id = `setting-${field.name}`;
    const [min, max] = field.range;

    return h(
      'div',
      { class: 'form-group' },
      h('label', { class: 'form-label', for: id }, `${field.label} (${field.unit})`),
      h('input', {
        id,
        name: field.name,
        class: 'form-control',
        type: 'number',
        inputmode: 'numeric',
        min: String(min),
        max: String(max),
        step: '1',
        required: field.optional === undefined,
      }),
      field.optional === undefined && field.helper === undefined
        ? null
        : h('div', { class: 'form-helper' }, field.optional ?? field.helper ?? ''),
    );
  });
}

function choice(
  name: 'shareLinkDefaultReleases' | 'defaultVisibility',
  label: string,
  options: readonly (readonly [string, string])[],
): HTMLElement {
  const id = `setting-${name}`;

  return h(
    'div',
    { class: 'form-group' },
    h('label', { class: 'form-label', for: id }, label),
    h(
      'select',
      { id, name, class: 'form-control' },
      options.map(([option, text]) => h('option', { value: option }, text)),
    ),
  );
}

function textField(name: TextSetting, label: string, helper: string, multiline = false): HTMLElement {
  const id = `setting-${name}`;
  const [, max] = TEXT_LIMITS[name];
  const attributes = { id, name, class: 'form-control', maxlength: String(max), required: name === 'portalName' };

  return h(
    'div',
    { class: 'form-group' },
    h('label', { class: 'form-label', for: id }, label),
    multiline ? h('textarea', { ...attributes, rows: '3' }) : h('input', { ...attributes, type: 'text' }),
    h('div', { class: 'form-helper' }, helper),
  );
}

function formCard(title: string, fields: readonly HTMLElement[]): HTMLElement {
  return h(
    'article',
    { class: 'card' },
    h('div', { class: 'card-header' }, h('h3', { class: 'card-title' }, title)),
    h('div', { class: 'card-body' }, h('div', { class: 'form-grid' }, fields)),
  );
}

function allNumberFields(): NumberField[] {
  return Object.values(NUMBER_FIELDS).flat();
}

function fill(form: HTMLFormElement, settings: SettingsDto): void {
  for (const field of allNumberFields()) {
    const current = settings[field.name];
    setValue(form, field.name, current === null ? '' : String(current));
  }

  for (const name of ['shareLinkDefaultReleases', 'defaultVisibility', ...Object.keys(TEXT_LIMITS)] as const) {
    setValue(form, name, settings[name as TextSetting | 'shareLinkDefaultReleases' | 'defaultVisibility']);
  }
}

function read(form: HTMLFormElement): Omit<SettingsDto, 'rowVersion'> {
  const numbers = Object.fromEntries(
    allNumberFields().map((field) => {
      const text = value(form, field.name);
      return [field.name, text === '' ? null : Number(text)];
    }),
  ) as Pick<SettingsDto, NumberSetting>;

  return {
    ...numbers,
    shareLinkDefaultReleases: value(form, 'shareLinkDefaultReleases') === 'latest' ? 'latest' : 'all',
    defaultVisibility: value(form, 'defaultVisibility') === 'organization' ? 'organization' : 'private',
    portalName: value(form, 'portalName'),
    supportContact: value(form, 'supportContact'),
    publicNotice: value(form, 'publicNotice'),
    footerText: value(form, 'footerText'),
  };
}

/** The same rules as the server, as messages next to the fields. */
export function validate(form: HTMLFormElement): Validation {
  const settings = read(form);
  const problems: Record<string, string | null> = {};

  for (const field of allNumberFields()) {
    const current = settings[field.name];
    const [min, max] = field.range;

    if (current === null) {
      problems[field.name] = field.optional === undefined ? 'Bitte gib einen Wert an.' : null;
    } else if (!Number.isInteger(current) || current < min || current > max) {
      problems[field.name] = `Bitte eine ganze Zahl von ${min} bis ${max}.`;
    }
  }

  if (settings.portalName === '') {
    problems['portalName'] = 'Bitte gib einen Namen an.';
  }

  if (
    problems['sessionIdleMinutes'] === undefined &&
    settings.sessionIdleMinutes > settings.sessionAbsoluteHours * 60
  ) {
    problems['sessionIdleMinutes'] = 'Darf nicht länger sein als die Sitzung selbst.';
  }

  if (settings.shareLinkMaxDays !== null && problems['shareLinkDefaultDays'] === undefined) {
    if (settings.shareLinkDefaultDays === null) {
      problems['shareLinkDefaultDays'] = 'Mit einer Höchstdauer braucht es auch eine Vorgabe.';
    } else if (settings.shareLinkDefaultDays > settings.shareLinkMaxDays) {
      problems['shareLinkDefaultDays'] = 'Darf die längste erlaubte Gültigkeit nicht überschreiten.';
    }
  }

  return problems;
}

/** The configuration the service was started with; values that are settings now appear in the form above. */
export function settingsView(settings: PlatformSettingsDto): Node {
  const { limits, worker } = settings;

  return h(
    'div',
    { class: 'stack' },
    card('System', [
      ['Version', settings.version],
      ['Node.js', settings.nodeVersion],
      ['Öffentliche Adresse', code(settings.publicUrl), 'PUBLIC_URL'],
    ]),
    card('Anmeldung über GitHub', [
      ['GitHub', code(settings.gitHub.webUrl), 'GITHUB_WEB_URL'],
      ['API', code(settings.gitHub.apiUrl), 'GITHUB_API_URL'],
      ['Organisation', code(settings.gitHub.organization), 'GITHUB_ORGANIZATION'],
      ['Admins aus der Konfiguration', number.format(settings.bootstrapAdministrators), 'BOOTSTRAP_ADMIN_GITHUB_IDS'],
    ]),
    card('CI-Uploads', [
      ['OIDC-Aussteller', code(settings.ci.issuer), 'CI_OIDC_ISSUER'],
      ['Erwartete Audience', code(settings.ci.audience), 'CI_OIDC_AUDIENCE'],
    ]),
    card('Ablage und Uploads', [
      ['Datenbank', code(settings.storage.databasePath), 'DATABASE_PATH'],
      ['Ablage', code(settings.storage.storageRoot), 'STORAGE_ROOT'],
      [
        'Von IIS ausgelieferte Ordner',
        settings.storage.servedAreas.length === 0
          ? '—'
          : h(
              'div',
              {},
              settings.storage.servedAreas.map((area) => h('div', {}, code(area))),
            ),
        'SERVED_AREAS',
      ],
      ['Größte Datei', `${number.format(limits.maxUploadMegabytes)} MB`, 'UPLOAD_MAX_MEGABYTES'],
    ]),
    card('Lösch-Worker', [
      ['Worker prüft alle', `${number.format(worker.pollSeconds)} Sekunden`, 'WORKER_POLL_SECONDS'],
      ['Sperre eines Auftrags', `${number.format(worker.leaseMinutes)} Minuten`, 'WORKER_LEASE_MINUTES'],
    ]),
  );
}

function code(text: string): HTMLElement {
  return h('code', {}, text);
}

function card(title: string, entries: readonly Entry[]): HTMLElement {
  return h(
    'article',
    { class: 'card' },
    h('div', { class: 'card-header' }, h('h3', { class: 'card-title' }, title)),
    h(
      'div',
      { class: 'card-body' },
      h(
        'dl',
        { class: 'meta-list' },
        entries.flatMap(([label, value, variable]) => [
          h('dt', {}, label),
          h(
            'dd',
            {},
            value,
            variable === undefined ? null : h('div', { class: 'form-helper' }, h('code', {}, variable)),
          ),
        ]),
      ),
    ),
  );
}
