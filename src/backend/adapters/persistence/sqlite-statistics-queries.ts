import type { Database } from 'better-sqlite3';

import type { LifecycleState, PublicationStatus } from '../../domain/entities/release.js';
import type {
  ApplicationReleaseStatistics,
  QuarantineEnding,
  RecentRelease,
  StatisticsQueries,
  StorageUsage,
  StorageUsageEntry,
} from '../../domain/ports/statistics-queries.js';
import type { ApplicationId, ProjectId, ReleaseId, UserId } from '../../domain/value-objects/identifier.js';
import { fromDbTime, toDbTime } from './sqlite-values.js';

interface CountRow {
  readonly application_id: string;
  readonly published: number;
  readonly drafts: number;
  readonly withdrawn: number;
  readonly in_deletion: number;
}

interface LatestRow {
  readonly id: string;
  readonly application_id: string;
  readonly version: string;
  readonly build_number: number;
  readonly published_at: string;
}

interface RecentRow {
  readonly id: string;
  readonly application_id: string;
  readonly version: string;
  readonly build_number: number;
  readonly publication_status: PublicationStatus;
  readonly lifecycle_state: LifecycleState;
  readonly created_at: string;
  readonly published_at: string | null;
}

/** Ordering of `ReleaseRepository.list`: newest version first. */
const NEWEST_VERSION =
  'version_major DESC, version_minor DESC, version_patch DESC, version_pre IS NULL DESC, build_number DESC';

export class SqliteStatisticsQueries implements StatisticsQueries {
  public constructor(private readonly database: Database) {}

  public releasesByApplication(applicationIds: readonly ApplicationId[]): readonly ApplicationReleaseStatistics[] {
    const ids = JSON.stringify(applicationIds);
    const counts = this.database
      .prepare<[string], CountRow>(
        `SELECT application_id,
                sum(publication_status = 'published' AND lifecycle_state = 'active') AS published,
                sum(publication_status = 'draft' AND lifecycle_state = 'active') AS drafts,
                sum(publication_status = 'withdrawn' AND lifecycle_state = 'active') AS withdrawn,
                sum(lifecycle_state IN ('pending_deletion', 'quarantined')) AS in_deletion
         FROM releases
         WHERE application_id IN (SELECT value FROM json_each(?)) AND lifecycle_state <> 'purged'
         GROUP BY application_id`,
      )
      .all(ids);
    const latest = this.database
      .prepare<[string], LatestRow>(
        `SELECT id, application_id, version, build_number, published_at FROM (
           SELECT *, row_number() OVER (PARTITION BY application_id ORDER BY ${NEWEST_VERSION}) AS position
           FROM releases
           WHERE application_id IN (SELECT value FROM json_each(?))
             AND publication_status = 'published' AND lifecycle_state = 'active'
         ) WHERE position = 1`,
      )
      .all(ids);
    const countsById = new Map(counts.map((row) => [row.application_id, row]));
    const latestById = new Map(latest.map((row) => [row.application_id, row]));

    return applicationIds.map((applicationId) => {
      const count = countsById.get(applicationId);
      const newest = latestById.get(applicationId);

      return {
        applicationId,
        published: count?.published ?? 0,
        drafts: count?.drafts ?? 0,
        withdrawn: count?.withdrawn ?? 0,
        inDeletion: count?.in_deletion ?? 0,
        latestPublished:
          newest === undefined
            ? null
            : {
                releaseId: newest.id as ReleaseId,
                version: newest.version,
                buildNumber: newest.build_number,
                publishedAt: fromDbTime(newest.published_at),
              },
      };
    });
  }

  public recentReleases(
    applicationIds: readonly ApplicationId[],
    publishedOnly: readonly ApplicationId[],
    limit: number,
  ): readonly RecentRelease[] {
    return this.database
      .prepare<[{ ids: string; publishedOnly: string; limit: number }], RecentRow>(
        `SELECT id, application_id, version, build_number, publication_status, lifecycle_state, created_at, published_at
         FROM releases
         WHERE application_id IN (SELECT value FROM json_each(@ids))
           AND lifecycle_state <> 'purged'
           AND (application_id NOT IN (SELECT value FROM json_each(@publishedOnly))
                OR (publication_status = 'published' AND lifecycle_state = 'active'))
         ORDER BY coalesce(published_at, created_at) DESC, id DESC
         LIMIT @limit`,
      )
      .all({ ids: JSON.stringify(applicationIds), publishedOnly: JSON.stringify(publishedOnly), limit })
      .map((row) => ({
        releaseId: row.id as ReleaseId,
        applicationId: row.application_id as ApplicationId,
        version: row.version,
        buildNumber: row.build_number,
        publicationStatus: row.publication_status,
        lifecycleState: row.lifecycle_state,
        createdAt: fromDbTime(row.created_at),
        publishedAt: fromDbTime(row.published_at),
      }));
  }

  public downloadsByApplication(
    applicationIds: readonly ApplicationId[],
    since: Date,
  ): ReadonlyMap<ApplicationId, number> {
    const rows = this.database
      .prepare<[{ ids: string; since: string }], { application_id: string; downloads: number }>(
        `SELECT application_id, count(*) AS downloads FROM audit_logs
         WHERE action = 'artifact.downloaded' AND outcome = 'success' AND occurred_at >= @since
           AND application_id IN (SELECT value FROM json_each(@ids))
         GROUP BY application_id`,
      )
      .all({ ids: JSON.stringify(applicationIds), since: toDbTime(since) });

    return new Map(rows.map((row) => [row.application_id as ApplicationId, row.downloads]));
  }

  public quarantineEndingBefore(applicationIds: readonly ApplicationId[], before: Date): readonly QuarantineEnding[] {
    return this.database
      .prepare<
        [{ ids: string; before: string }],
        { id: string; application_id: string; version: string; build_number: number; purge_after: string }
      >(
        `SELECT r.id, r.application_id, r.version, r.build_number, j.purge_after
         FROM deletion_jobs j JOIN releases r ON r.id = j.release_id
         WHERE j.state = 'quarantined' AND r.lifecycle_state = 'quarantined' AND j.purge_after <= @before
           AND r.application_id IN (SELECT value FROM json_each(@ids))
         ORDER BY j.purge_after, r.id`,
      )
      .all({ ids: JSON.stringify(applicationIds), before: toDbTime(before) })
      .map((row) => ({
        releaseId: row.id as ReleaseId,
        applicationId: row.application_id as ApplicationId,
        version: row.version,
        buildNumber: row.build_number,
        purgeAfter: fromDbTime(row.purge_after),
      }));
  }

  public shareLinkCounts(
    projectIds: readonly ProjectId[],
    applicationIds: readonly ApplicationId[],
    now: Date,
    expiringBefore: Date,
  ): { readonly active: number; readonly expiringSoon: number } {
    const row = this.database
      .prepare<
        [{ projects: string; applications: string; now: string; soon: string }],
        { active: number | null; expiring: number | null }
      >(
        `SELECT count(*) AS active, sum(expires_at IS NOT NULL AND expires_at <= @soon) AS expiring
         FROM share_links
         WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > @now)
           AND (project_id IN (SELECT value FROM json_each(@projects))
                OR application_id IN (SELECT value FROM json_each(@applications))
                OR application_id IN (
                  SELECT id FROM applications WHERE project_id IN (SELECT value FROM json_each(@projects))
                ))`,
      )
      .get({
        projects: JSON.stringify(projectIds),
        applications: JSON.stringify(applicationIds),
        now: toDbTime(now),
        soon: toDbTime(expiringBefore),
      });

    return { active: row?.active ?? 0, expiringSoon: row?.expiring ?? 0 };
  }

  public previousSignIn(userId: UserId): Date | null {
    const row = this.database
      .prepare<[string], { created_at: string }>(
        'SELECT created_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1 OFFSET 1',
      )
      .get(userId);

    return row === undefined ? null : fromDbTime(row.created_at);
  }

  public storageUsage(): StorageUsage {
    const rows = this.database
      .prepare<[], UsageRow & { project_id: string; name: string }>(
        `SELECT p.id AS project_id, p.name, ${USAGE_COLUMNS}
         FROM projects p
         JOIN applications ap ON ap.project_id = p.id
         JOIN releases r ON r.application_id = ap.id
         JOIN release_artifacts a ON a.release_id = r.id
         GROUP BY p.id
         ORDER BY stored_bytes + quarantined_bytes DESC, p.name`,
      )
      .all();
    const total = this.database.prepare<[], UsageRow>(`SELECT ${USAGE_COLUMNS} FROM release_artifacts a`).get();

    return {
      total: usageOf(total),
      projects: rows.map((row) => ({ ...usageOf(row), projectId: row.project_id as ProjectId, name: row.name })),
    };
  }
}

interface UsageRow {
  readonly stored_bytes: number | null;
  readonly stored_artifacts: number | null;
  readonly quarantined_bytes: number | null;
  readonly quarantined_artifacts: number | null;
  readonly missing_artifacts: number | null;
}

const USAGE_COLUMNS = `
  sum(CASE WHEN a.storage_state = 'stored' THEN a.size_bytes ELSE 0 END) AS stored_bytes,
  sum(a.storage_state = 'stored') AS stored_artifacts,
  sum(CASE WHEN a.storage_state = 'quarantined' THEN a.size_bytes ELSE 0 END) AS quarantined_bytes,
  sum(a.storage_state = 'quarantined') AS quarantined_artifacts,
  sum(a.storage_state = 'missing') AS missing_artifacts`;

function usageOf(row: UsageRow | undefined): StorageUsageEntry {
  return {
    storedBytes: row?.stored_bytes ?? 0,
    storedArtifacts: row?.stored_artifacts ?? 0,
    quarantinedBytes: row?.quarantined_bytes ?? 0,
    quarantinedArtifacts: row?.quarantined_artifacts ?? 0,
    missingArtifacts: row?.missing_artifacts ?? 0,
  };
}
