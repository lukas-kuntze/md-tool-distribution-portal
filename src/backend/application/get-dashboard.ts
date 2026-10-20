import type { Application } from '../domain/entities/application.js';
import type { Project } from '../domain/entities/project.js';
import type {
  ApplicationReleaseStatistics,
  QuarantineEnding,
  RecentRelease,
} from '../domain/ports/statistics-queries.js';
import { applicationTarget, authorizedRead, projectTarget } from './authorization.js';
import { currentSettings } from './manage-settings.js';
import type { Actor, RequestContext } from './request-context.js';
import { contextOf, type UseCaseDependencies } from './use-case.js';
import { canSeeApplication } from './visibility.js';

const RECENT_RELEASES = 10;
const DAY_MS = 24 * 60 * 60_000;

export interface DashboardApplication {
  readonly application: Application;
  readonly statistics: ApplicationReleaseStatistics;
  readonly downloads: number;
}

export interface DashboardProject {
  readonly project: Project;
  readonly applications: readonly DashboardApplication[];
}

export interface DashboardRelease {
  readonly release: RecentRelease;
  readonly application: Application;
  readonly project: Project;
}

export interface DashboardQuarantine {
  readonly release: QuarantineEnding;
  readonly application: Application;
  readonly project: Project;
  readonly canRestore: boolean;
}

export interface Dashboard {
  readonly projects: readonly DashboardProject[];
  readonly recentReleases: readonly DashboardRelease[];
  /** Releases whose final deletion is near; only for applications whose drafts the user may read. */
  readonly quarantineEnding: readonly DashboardQuarantine[];
  /** `null` for users who manage no share links. */
  readonly shareLinks: { readonly active: number; readonly expiringSoon: number } | null;
  readonly previousSignInAt: Date | null;
  /** Periods from the settings: downloads counted, quarantine ending soon, share links expiring soon. */
  readonly windows: {
    readonly downloadDays: number;
    readonly quarantineDays: number;
    readonly shareExpiryDays: number;
  };
}

/**
 * Overview of everything the user can see: active projects and applications with their release counts,
 * downloads of the last days and the newest releases. Drafts, withdrawn releases and deletions only count
 * for users who may read drafts of the application, as in the release list.
 */
export function getDashboard(
  dependencies: Pick<UseCaseDependencies, 'unitOfWork' | 'clock'>,
  actor: Actor,
  request: RequestContext,
): Dashboard {
  const context = contextOf(dependencies, actor, request);

  return authorizedRead(context, (repositories, { permissions }) => {
    const settings = currentSettings(repositories);
    const windows = {
      downloadDays: settings.dashboardDownloadDays,
      quarantineDays: settings.dashboardQuarantineDays,
      shareExpiryDays: settings.dashboardShareExpiryDays,
    };
    const visible = repositories.projects.list({ status: 'active' }).flatMap(({ value: project }) => {
      const applications = repositories.applications
        .listByProject(project.id)
        .map((stored) => stored.value)
        .filter((application) => application.status === 'active' && canSeeApplication(permissions, application));

      return permissions.allows('projects.read', projectTarget(project)) || applications.length > 0
        ? [{ project, applications }]
        : [];
    });
    const applications = visible.flatMap(({ applications: list }) => list);
    const ids = applications.map((application) => application.id);
    const publishedOnly = applications
      .filter((application) => !permissions.allows('releases.read', applicationTarget(application)))
      .map((application) => application.id);
    const statistics = new Map(
      repositories.statistics
        .releasesByApplication(ids)
        .map((entry) => [
          entry.applicationId,
          publishedOnly.includes(entry.applicationId) ? { ...entry, drafts: 0, withdrawn: 0, inDeletion: 0 } : entry,
        ]),
    );
    const downloads = repositories.statistics.downloadsByApplication(
      ids,
      new Date(context.now.getTime() - windows.downloadDays * DAY_MS),
    );
    // Links are counted where the user may manage them: a whole project, or single applications.
    const shareLinkCounts = (): Dashboard['shareLinks'] => {
      const projectIds = visible
        .map(({ project }) => project)
        .filter((project) => permissions.allows('shares.manage', projectTarget(project)))
        .map((project) => project.id);
      const applicationIds = applications
        .filter((application) => permissions.allows('shares.manage', applicationTarget(application)))
        .map((application) => application.id);

      return projectIds.length === 0 && applicationIds.length === 0
        ? null
        : repositories.statistics.shareLinkCounts(
            projectIds,
            applicationIds,
            context.now,
            new Date(context.now.getTime() + windows.shareExpiryDays * DAY_MS),
          );
    };
    const byApplication = new Map(
      visible.flatMap(({ project, applications: list }) =>
        list.map((application) => [application.id, { application, project }]),
      ),
    );

    return {
      projects: visible.map(({ project, applications: list }) => ({
        project,
        applications: list.map((application) => ({
          application,
          statistics: statistics.get(application.id) ?? emptyStatistics(application),
          downloads: downloads.get(application.id) ?? 0,
        })),
      })),
      quarantineEnding: repositories.statistics
        .quarantineEndingBefore(
          ids.filter((id) => !publishedOnly.includes(id)),
          new Date(context.now.getTime() + windows.quarantineDays * DAY_MS),
        )
        .flatMap((release) => {
          const owner = byApplication.get(release.applicationId);
          return owner === undefined
            ? []
            : [
                {
                  release,
                  ...owner,
                  canRestore: permissions.allows('releases.restore', applicationTarget(owner.application)),
                },
              ];
        }),
      shareLinks: shareLinkCounts(),
      previousSignInAt: repositories.statistics.previousSignIn(actor.userId),
      windows,
      recentReleases: repositories.statistics.recentReleases(ids, publishedOnly, RECENT_RELEASES).flatMap((release) => {
        const owner = byApplication.get(release.applicationId);
        return owner === undefined ? [] : [{ release, ...owner }];
      }),
    };
  });
}

function emptyStatistics(application: Application): ApplicationReleaseStatistics {
  return { applicationId: application.id, published: 0, drafts: 0, withdrawn: 0, inDeletion: 0, latestPublished: null };
}
