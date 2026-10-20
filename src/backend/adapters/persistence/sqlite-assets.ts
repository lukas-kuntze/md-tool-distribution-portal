import type { Database } from 'better-sqlite3';

import type { Asset, AssetOwner } from '../../domain/entities/asset.js';
import type { ChangeContext } from '../../domain/ports/stored.js';
import type { ApplicationId, AssetId, ProjectId } from '../../domain/value-objects/identifier.js';
import { parseStorageKey } from '../../domain/value-objects/storage-key.js';
import { fromDbTime, toDbTime } from './sqlite-values.js';

interface AssetRow {
  readonly id: string;
  readonly application_id: string | null;
  readonly project_id: string | null;
  readonly content_type: Asset['contentType'];
  readonly size_bytes: number;
  readonly sha256: string;
  readonly storage_key: string;
  readonly created_at: string;
}

/** Table holding the owner's `icon_asset_id`; fixed names, never user input. */
const OWNER_TABLES = { application: 'applications', project: 'projects' } as const;

export function findIcon(database: Database, owner: AssetOwner): Asset | null {
  const row = database
    .prepare<[string], AssetRow>(
      `SELECT s.* FROM ${OWNER_TABLES[owner.type]} o JOIN assets s ON s.id = o.icon_asset_id WHERE o.id = ?`,
    )
    .get(owner.id);
  return row === undefined ? null : assetOf(row);
}

/** Points the owner at a new icon, or none, removes the previous row and returns it. */
export function replaceIcon(
  database: Database,
  owner: AssetOwner,
  icon: Asset | null,
  context: ChangeContext,
): Asset | null {
  const previous = findIcon(database, owner);

  if (icon !== null) {
    database
      .prepare(
        `INSERT INTO assets (id, application_id, project_id, kind, content_type, size_bytes, sha256, storage_key,
                             created_at, created_by)
         VALUES (@id, @applicationId, @projectId, @kind, @contentType, @sizeBytes, @sha256, @storageKey, @at, @actor)`,
      )
      .run({
        id: icon.id,
        applicationId: icon.owner.type === 'application' ? icon.owner.id : null,
        projectId: icon.owner.type === 'project' ? icon.owner.id : null,
        kind: icon.kind,
        contentType: icon.contentType,
        sizeBytes: icon.sizeBytes,
        sha256: icon.sha256,
        storageKey: icon.storageKey,
        at: toDbTime(icon.createdAt),
        actor: context.actor,
      });
  }

  database
    .prepare(`UPDATE ${OWNER_TABLES[owner.type]} SET icon_asset_id = ?, updated_at = ?, updated_by = ? WHERE id = ?`)
    .run(icon?.id ?? null, toDbTime(context.at), context.actor, owner.id);

  if (previous !== null) {
    database.prepare('DELETE FROM assets WHERE id = ?').run(previous.id);
  }

  return previous;
}

function assetOf(row: AssetRow): Asset {
  return {
    id: row.id as AssetId,
    owner:
      row.application_id === null
        ? { type: 'project', id: row.project_id as ProjectId }
        : { type: 'application', id: row.application_id as ApplicationId },
    kind: 'icon',
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    storageKey: parseStorageKey(row.storage_key),
    createdAt: fromDbTime(row.created_at),
  };
}
