import {
  activateFlavor,
  archiveFlavor,
  changeFlavorKey,
  configurePlatforms,
  createDefaultFlavor,
  createFlavor as create,
  disableFlavor,
  disableFlavors,
  enableFlavors,
  setFlavorBundleIdentifier,
  type Application,
  type ApplicationFlavor,
  type ApplicationVisibility,
  type FlavorStatus,
  type Framework,
} from '../domain/entities/application.js';
import { MAX_INSTALL_NOTES_LENGTH, type ApplicationPresentation } from '../domain/entities/asset.js';
import type { Stored } from '../domain/ports/stored.js';
import type { Repositories } from '../domain/ports/unit-of-work.js';
import { parseBundleIdentifier } from '../domain/value-objects/bundle-identifier.js';
import { parseDisplayName } from '../domain/value-objects/display-name.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import type { EffectivePermissions } from '../domain/value-objects/effective-permissions.js';
import { parseFlavorKey } from '../domain/value-objects/flavor-key.js';
import type { ApplicationId, FlavorId, ProjectId } from '../domain/value-objects/identifier.js';
import { PLATFORMS, type Platform } from '../domain/value-objects/platform.js';
import { parseSlug } from '../domain/value-objects/slug.js';
import {
  applicationTarget,
  auditChange,
  authorizedRead,
  authorizedTransaction,
  projectTarget,
  type ActorContext,
} from './authorization.js';
import { assertUnchanged, requireApplication, requireFlavor, requireProject } from './lookups.js';
import { currentSettings } from './manage-settings.js';
import type { Actor, RequestContext } from './request-context.js';
import { contextOf, type UseCaseDependencies } from './use-case.js';
import { applicationCapabilities, canSeeApplication, type ApplicationCapabilities } from './visibility.js';

export interface ApplicationView {
  readonly application: Stored<Application>;
  readonly flavors: readonly Stored<ApplicationFlavor>[];
  readonly presentation: ApplicationPresentation;
  readonly capabilities: ApplicationCapabilities;
}

/** Package names / bundle identifiers per platform; `null` removes one. */
export type BundleIdentifierInput = Partial<Record<Platform, string | null>>;

type Dependencies = Pick<UseCaseDependencies, 'unitOfWork' | 'clock'>;

export function listApplications(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  projectId: ProjectId,
): readonly ApplicationView[] {
  return authorizedRead(contextOf(dependencies, actor, request), (repositories, { permissions }) => {
    requireProject(repositories, projectId);

    return repositories.applications
      .listByProject(projectId)
      .filter((stored) => canSeeApplication(permissions, stored.value))
      .map((stored) => ({
        application: stored,
        flavors: repositories.applications.listFlavors(stored.value.id),
        presentation: repositories.applications.findPresentation(stored.value.id),
        capabilities: applicationCapabilities(permissions, stored.value),
      }));
  });
}

export function getApplication(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  applicationId: ApplicationId,
): ApplicationView {
  return authorizedRead(contextOf(dependencies, actor, request), (repositories, { permissions }) =>
    viewOf(repositories, visibleApplication(repositories, applicationId, permissions), permissions),
  );
}

export interface CreateApplicationInput {
  readonly projectId: ProjectId;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly framework: Framework;
  readonly platforms: readonly Platform[];
  /** Without a value, the default visibility of the settings applies. */
  readonly visibility?: ApplicationVisibility;
  /** Identifiers of the default flavor, i.e. of the application while it does not use flavors. */
  readonly bundleIdentifiers: BundleIdentifierInput;
}

export function createApplication(
  dependencies: UseCaseDependencies,
  actor: Actor,
  request: RequestContext,
  input: CreateApplicationInput,
): ApplicationView {
  const context = contextOf(dependencies, actor, request);

  return authorizedTransaction(context, (repositories, guard) => {
    const project = requireProject(repositories, input.projectId).value;

    guard.require('applications.manage', projectTarget(project), { type: 'application', id: null });

    if (project.status !== 'active') {
      throw new DomainError('invalid_project_state', 'Applications cannot be added to an archived project.');
    }

    const application = configurePlatforms(
      {
        id: dependencies.ids.next(),
        projectId: project.id,
        slug: parseSlug(input.slug),
        name: parseDisplayName(input.name),
        description: input.description,
        framework: input.framework,
        platforms: [],
        flavorsEnabled: false,
        visibility: input.visibility ?? currentSettings(repositories).defaultVisibility,
        status: 'active',
      },
      input.platforms,
    );
    const flavor = withBundleIdentifiers(
      createDefaultFlavor(dependencies.ids.next(), application),
      input.bundleIdentifiers,
    );

    repositories.applications.insert(application, flavor, { actor: actor.userId, at: context.now });
    audit(repositories, context, 'application.created', application, {
      slug: application.slug,
      framework: application.framework,
      platforms: application.platforms,
      bundleIdentifiers: flavor.bundleIdentifiers,
    });

    return viewOf(repositories, application, guard.permissions);
  });
}

export interface UpdateApplicationInput {
  readonly applicationId: ApplicationId;
  readonly expectedRowVersion: number;
  readonly name?: string;
  readonly description?: string;
  readonly framework?: Framework;
  readonly platforms?: readonly Platform[];
  readonly visibility?: ApplicationVisibility;
  readonly flavorsEnabled?: boolean;
  /** Plain text shown on download pages above the installation buttons. */
  readonly installNotes?: string;
}

export function updateApplication(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  input: UpdateApplicationInput,
): ApplicationView {
  const context = contextOf(dependencies, actor, request);

  return authorizedTransaction(context, (repositories, guard) => {
    const stored = requireApplication(repositories, input.applicationId);
    const target = applicationTarget(stored.value);
    const subject = { type: 'application', id: stored.value.id };

    guard.require('applications.manage', target, subject);
    assertUnchanged(stored, input.expectedRowVersion);

    let changed: Application = {
      ...stored.value,
      name: input.name === undefined ? stored.value.name : parseDisplayName(input.name),
      description: input.description ?? stored.value.description,
      framework: input.framework ?? stored.value.framework,
      visibility: input.visibility ?? stored.value.visibility,
    };

    if (input.platforms !== undefined) {
      changed = configurePlatforms(changed, input.platforms);
    }

    if (input.flavorsEnabled !== undefined && input.flavorsEnabled !== stored.value.flavorsEnabled) {
      guard.require('flavors.manage', target, subject);
      const flavors = repositories.applications.listFlavors(stored.value.id).map((flavor) => flavor.value);
      changed = input.flavorsEnabled ? enableFlavors(changed) : disableFlavors(changed, flavors);
    }

    repositories.applications.update(changed, stored.rowVersion, { actor: actor.userId, at: context.now });

    const notesBefore = repositories.applications.findPresentation(stored.value.id).installNotes;
    const notesAfter = input.installNotes === undefined ? notesBefore : parseInstallNotes(input.installNotes);

    if (notesAfter !== notesBefore) {
      repositories.applications.updateInstallNotes(stored.value.id, notesAfter, {
        actor: actor.userId,
        at: context.now,
      });
    }

    audit(repositories, context, 'application.updated', changed, {
      before: { ...summary(stored.value), installNotes: notesBefore },
      after: { ...summary(changed), installNotes: notesAfter },
    });

    return viewOf(repositories, changed, guard.permissions);
  });
}

export interface CreateFlavorInput {
  readonly applicationId: ApplicationId;
  readonly key: string;
  readonly name: string;
  readonly bundleIdentifiers: BundleIdentifierInput;
}

export function createFlavor(
  dependencies: UseCaseDependencies,
  actor: Actor,
  request: RequestContext,
  input: CreateFlavorInput,
): Stored<ApplicationFlavor> {
  const context = contextOf(dependencies, actor, request);

  return authorizedTransaction(context, (repositories, guard) => {
    const application = requireApplication(repositories, input.applicationId).value;

    guard.require('flavors.manage', applicationTarget(application), { type: 'flavor', id: null });

    const siblings = repositories.applications.listFlavors(application.id).map((flavor) => flavor.value);
    const flavor = withBundleIdentifiers(
      create(dependencies.ids.next(), application, siblings, parseFlavorKey(input.key), parseDisplayName(input.name)),
      input.bundleIdentifiers,
    );

    repositories.applications.insertFlavor(flavor, { actor: actor.userId, at: context.now });
    audit(repositories, context, 'flavor.created', application, {
      flavorId: flavor.id,
      key: flavor.key,
      bundleIdentifiers: flavor.bundleIdentifiers,
    });

    return { value: flavor, rowVersion: 1 };
  });
}

export interface UpdateFlavorInput {
  readonly flavorId: FlavorId;
  readonly expectedRowVersion: number;
  readonly key?: string;
  readonly name?: string;
  readonly status?: FlavorStatus;
  readonly bundleIdentifiers?: BundleIdentifierInput;
}

export function updateFlavor(
  dependencies: Dependencies,
  actor: Actor,
  request: RequestContext,
  input: UpdateFlavorInput,
): Stored<ApplicationFlavor> {
  const context = contextOf(dependencies, actor, request);

  return authorizedTransaction(context, (repositories, guard) => {
    const stored = requireFlavor(repositories, input.flavorId);
    const application = requireApplication(repositories, stored.value.applicationId).value;

    guard.require('flavors.manage', applicationTarget(application), { type: 'flavor', id: stored.value.id });
    assertUnchanged(stored, input.expectedRowVersion);

    let changed: ApplicationFlavor = stored.value;

    if (input.key !== undefined && input.key !== changed.key) {
      const siblings = repositories.applications.listFlavors(application.id).map((flavor) => flavor.value);
      changed = changeFlavorKey(changed, siblings, parseFlavorKey(input.key));
    }

    if (input.name !== undefined) {
      changed = { ...changed, name: parseDisplayName(input.name) };
    }

    if (input.bundleIdentifiers !== undefined) {
      changed = withBundleIdentifiers(changed, input.bundleIdentifiers);
    }

    if (input.status !== undefined && input.status !== changed.status) {
      changed = { active: activateFlavor, disabled: disableFlavor, archived: archiveFlavor }[input.status](changed);
    }

    const rowVersion = repositories.applications.updateFlavor(changed, stored.rowVersion, {
      actor: actor.userId,
      at: context.now,
    });
    audit(repositories, context, 'flavor.updated', application, {
      flavorId: changed.id,
      before: {
        key: stored.value.key,
        name: stored.value.name,
        status: stored.value.status,
        bundleIdentifiers: stored.value.bundleIdentifiers,
      },
      after: {
        key: changed.key,
        name: changed.name,
        status: changed.status,
        bundleIdentifiers: changed.bundleIdentifiers,
      },
    });

    return { value: changed, rowVersion };
  });
}

/** Applications the user cannot see are reported as missing, so that their existence does not leak. */
export function visibleApplication(
  repositories: Repositories,
  applicationId: ApplicationId,
  permissions: EffectivePermissions,
): Application {
  const application = requireApplication(repositories, applicationId).value;

  if (!canSeeApplication(permissions, application)) {
    throw new DomainError('application_not_found', 'The application does not exist.');
  }

  return application;
}

function viewOf(
  repositories: Repositories,
  application: Application,
  permissions: EffectivePermissions,
): ApplicationView {
  return {
    application: requireApplication(repositories, application.id),
    flavors: repositories.applications.listFlavors(application.id),
    presentation: repositories.applications.findPresentation(application.id),
    capabilities: applicationCapabilities(permissions, application),
  };
}

function parseInstallNotes(value: string): string {
  const notes = value.trim();

  if (notes.length > MAX_INSTALL_NOTES_LENGTH) {
    throw new DomainError(
      'install_notes_too_long',
      `Installation notes are limited to ${MAX_INSTALL_NOTES_LENGTH} characters.`,
    );
  }

  return notes;
}

function withBundleIdentifiers(flavor: ApplicationFlavor, identifiers: BundleIdentifierInput): ApplicationFlavor {
  return PLATFORMS.reduce((current, platform) => {
    const value = identifiers[platform];

    if (value === undefined) {
      return current;
    }

    return setFlavorBundleIdentifier(current, platform, value === null ? null : parseBundleIdentifier(platform, value));
  }, flavor);
}

function summary(application: Application): Record<string, unknown> {
  return {
    name: application.name,
    description: application.description,
    framework: application.framework,
    platforms: application.platforms,
    visibility: application.visibility,
    flavorsEnabled: application.flavorsEnabled,
  };
}

function audit(
  repositories: Repositories,
  context: ActorContext,
  action: string,
  application: Application,
  details: Readonly<Record<string, unknown>>,
): void {
  repositories.auditLog.append(
    auditChange(context, action, applicationTarget(application), { type: 'application', id: application.id }, details),
  );
}
