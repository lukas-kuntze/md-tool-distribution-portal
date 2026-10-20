import type { Application } from '../domain/entities/application.js';
import type { EffectivePermissions } from '../domain/value-objects/effective-permissions.js';
import type { Permission } from '../domain/value-objects/permission.js';
import { GLOBAL, type Target } from '../domain/value-objects/scope.js';
import { applicationTarget } from './authorization.js';

/** Any of these at an application lets a user see it in the administration. */
const APPLICATION_ACCESS: readonly Permission[] = [
  'releases.read',
  'artifacts.download',
  'applications.manage',
  'flavors.manage',
  'releases.create',
  'releases.publish',
  'releases.delete',
  'permissions.manage',
  'audit.read',
];

/** What the user may do with an application; the user interface shows actions accordingly. */
export interface ApplicationCapabilities {
  readonly manage: boolean;
  readonly manageFlavors: boolean;
  readonly readDrafts: boolean;
  readonly createReleases: boolean;
  readonly updateReleases: boolean;
  readonly publishReleases: boolean;
  readonly deleteReleases: boolean;
  readonly restoreReleases: boolean;
  readonly releaseBuildNumbers: boolean;
  readonly uploadArtifacts: boolean;
  readonly downloadArtifacts: boolean;
  readonly deleteArtifacts: boolean;
  readonly managePermissions: boolean;
  readonly readAudit: boolean;
  readonly manageShares: boolean;
}

export interface ProjectCapabilities {
  readonly update: boolean;
  readonly createApplications: boolean;
  readonly managePermissions: boolean;
  readonly readAudit: boolean;
  readonly manageShares: boolean;
}

export interface GlobalCapabilities {
  readonly createProjects: boolean;
  readonly managePermissions: boolean;
  readonly readAudit: boolean;
  readonly manageStorage: boolean;
  readonly manageSettings: boolean;
  /** Ending a quarantine early (`releases.purge`), offered for quarantined deletion jobs. */
  readonly purgeReleases: boolean;
  /** Whether the user can manage permissions anywhere, e.g. to show the access management at all. */
  readonly managesAnyPermissions: boolean;
  /** Whether any role gives the user more than reading and downloading; others start on the download page. */
  readonly administers: boolean;
}

/** Organisation-wide visibility makes published releases of an application visible to every signed-in user. */
export function canSeeApplication(permissions: EffectivePermissions, application: Application): boolean {
  const target = applicationTarget(application);
  return (
    application.visibility === 'organization' ||
    APPLICATION_ACCESS.some((permission) => permissions.allows(permission, target))
  );
}

export function canDownloadPublished(permissions: EffectivePermissions, application: Application): boolean {
  return (
    application.visibility === 'organization' ||
    permissions.allows('artifacts.download', applicationTarget(application))
  );
}

export function applicationCapabilities(
  permissions: EffectivePermissions,
  application: Application,
): ApplicationCapabilities {
  const target = applicationTarget(application);
  const allows = (permission: Permission): boolean => permissions.allows(permission, target);

  return {
    manage: allows('applications.manage'),
    manageFlavors: allows('flavors.manage'),
    readDrafts: allows('releases.read'),
    createReleases: allows('releases.create'),
    updateReleases: allows('releases.update'),
    publishReleases: allows('releases.publish'),
    deleteReleases: allows('releases.delete'),
    restoreReleases: allows('releases.restore'),
    releaseBuildNumbers: allows('build_numbers.release'),
    uploadArtifacts: allows('artifacts.upload'),
    downloadArtifacts: canDownloadPublished(permissions, application),
    deleteArtifacts: allows('artifacts.delete'),
    managePermissions: allows('permissions.manage'),
    readAudit: allows('audit.read'),
    manageShares: allows('shares.manage'),
  };
}

export function projectCapabilities(permissions: EffectivePermissions, target: Target): ProjectCapabilities {
  return {
    update: permissions.allows('projects.update', target),
    createApplications: permissions.allows('applications.manage', target),
    managePermissions: permissions.allows('permissions.manage', target),
    readAudit: permissions.allows('audit.read', target),
    manageShares: permissions.allows('shares.manage', target),
  };
}

export function globalCapabilities(
  permissions: EffectivePermissions,
  managesAnyPermissions: boolean,
  administers: boolean,
): GlobalCapabilities {
  return {
    administers,
    createProjects: permissions.allows('projects.create', GLOBAL),
    managePermissions: permissions.allows('permissions.manage', GLOBAL),
    readAudit: permissions.allows('audit.read', GLOBAL),
    manageStorage: permissions.allows('storage.manage', GLOBAL),
    manageSettings: permissions.allows('settings.manage', GLOBAL),
    purgeReleases: permissions.allows('releases.purge', GLOBAL),
    managesAnyPermissions,
  };
}
