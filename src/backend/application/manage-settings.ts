import { DEFAULT_SETTINGS, validateSettings, type Settings } from '../domain/entities/settings.js';
import type { Clock } from '../domain/ports/clock.js';
import type { Stored } from '../domain/ports/stored.js';
import type { Repositories, UnitOfWork } from '../domain/ports/unit-of-work.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import { auditChange, authorizedRead, authorizedTransaction, GLOBAL_TARGET } from './authorization.js';
import type { Actor, RequestContext } from './request-context.js';
import { contextOf, type UseCaseDependencies } from './use-case.js';

type Dependencies = Pick<UseCaseDependencies, 'unitOfWork' | 'clock'>;

const SUBJECT = { type: 'settings', id: null } as const;

/** The settings in effect: stored ones, or the defaults before the first start seeded them. */
export function currentSettings(repositories: Repositories): Settings {
  return repositories.settings.load()?.value ?? DEFAULT_SETTINGS;
}

/**
 * Stores the start values once, on the very first start; afterwards the settings page is the only place that
 * changes them, and the environment variables no longer apply.
 */
export function seedSettings(unitOfWork: UnitOfWork, startValues: Settings, now: Date): boolean {
  return unitOfWork.transaction((repositories) => repositories.settings.seed(validateSettings(startValues), now));
}

export function getSettings(dependencies: Dependencies, actor: Actor, request: RequestContext): Stored<Settings> {
  return authorizedRead(contextOf(dependencies, actor, request), (repositories, guard) => {
    guard.require('settings.manage', GLOBAL_TARGET, SUBJECT);
    // Before the first save the defaults count as version 1, which `updateSettings` seeds the same way.
    return repositories.settings.load() ?? { value: DEFAULT_SETTINGS, rowVersion: 1 };
  });
}

/** Saves all settings at once; the audit entry lists the changed ones with their old and new value. */
export function updateSettings(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  input: { readonly settings: Settings; readonly expectedRowVersion: number },
): Stored<Settings> {
  const context = contextOf(dependencies, actor, request);

  return authorizedTransaction(context, (repositories, guard) => {
    guard.require('settings.manage', GLOBAL_TARGET, SUBJECT);

    const settings = validateSettings(input.settings);
    let stored = repositories.settings.load();

    if (stored === null) {
      repositories.settings.seed(DEFAULT_SETTINGS, context.now);
      stored = { value: DEFAULT_SETTINGS, rowVersion: 1 };
    }

    if (input.expectedRowVersion !== stored.rowVersion) {
      throw new DomainError('concurrent_modification', 'The settings were changed in the meantime.');
    }

    const changed = (Object.keys(settings) as (keyof Settings)[]).filter((key) => settings[key] !== stored.value[key]);
    const rowVersion = repositories.settings.save(settings, stored.rowVersion, {
      actor: actor.userId,
      at: context.now,
    });

    repositories.auditLog.append(
      auditChange(context, 'settings.updated', GLOBAL_TARGET, SUBJECT, {
        before: Object.fromEntries(changed.map((key) => [key, stored.value[key]])),
        after: Object.fromEntries(changed.map((key) => [key, settings[key]])),
      }),
    );

    return { value: settings, rowVersion };
  });
}

/** Presets for forms of signed-in users, e.g. the share link dialog; no permission needed. */
export function getSettingPresets(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
): Pick<Settings, 'shareLinkDefaultDays' | 'shareLinkMaxDays' | 'shareLinkDefaultReleases' | 'defaultVisibility'> {
  return authorizedRead(contextOf(dependencies, actor, request), (repositories) => {
    const { shareLinkDefaultDays, shareLinkMaxDays, shareLinkDefaultReleases, defaultVisibility } =
      currentSettings(repositories);
    return { shareLinkDefaultDays, shareLinkMaxDays, shareLinkDefaultReleases, defaultVisibility };
  });
}

/** Name, contact and texts of the portal; public, because share links and the sign-in page show them. */
export function getBranding(
  unitOfWork: UnitOfWork,
): Pick<Settings, 'portalName' | 'supportContact' | 'publicNotice' | 'footerText'> {
  return unitOfWork.read((repositories) => {
    const { portalName, supportContact, publicNotice, footerText } = currentSettings(repositories);
    return { portalName, supportContact, publicNotice, footerText };
  });
}

/**
 * Settings for long-lived processes (session checks, worker loop), read again at most every few seconds so that
 * a change applies without a restart and without a database read per request.
 */
export class SettingsCache {
  private cached: { readonly settings: Settings; readonly loadedAt: number } | null = null;

  public constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly clock: Clock,
    private readonly maxAgeMs = 5_000,
  ) {}

  public current(): Settings {
    const now = this.clock.now().getTime();

    if (this.cached === null || now - this.cached.loadedAt >= this.maxAgeMs) {
      this.cached = { settings: this.unitOfWork.read(currentSettings), loadedAt: now };
    }

    return this.cached.settings;
  }
}
