import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { PERMISSIONS } from '../domain/value-objects/permission.js';
import { migrate, MIGRATIONS } from './migrate.js';

const now = new Date('2026-10-17T10:00:00.000Z');
const LATEST = Math.max(...MIGRATIONS.map((migration) => migration.version));

function freshDatabase(): BetterSqlite3.Database {
  const database = new BetterSqlite3(':memory:');
  database.pragma('foreign_keys = ON');
  return database;
}

describe('migrate', (): void => {
  it('applies every migration once and records it', (): void => {
    const database = freshDatabase();

    expect(migrate(database, now)).toEqual({ applied: MIGRATIONS.map((m) => m.version), currentVersion: LATEST });
    expect(migrate(database, now)).toEqual({ applied: [], currentVersion: LATEST });
    expect(database.prepare('SELECT version, name, applied_at FROM schema_migrations').all()).toEqual(
      MIGRATIONS.map((migration) => ({
        version: migration.version,
        name: migration.name,
        applied_at: now.toISOString(),
      })),
    );
    expect(MIGRATIONS[0]).toMatchObject({ version: 1, name: 'initial-schema' });
  });

  it('rolls a failing migration back completely', (): void => {
    const database = freshDatabase();
    migrate(database, now);

    const broken = {
      version: 99,
      name: 'broken',
      sql: 'CREATE TABLE half_done (id TEXT); SELECT * FROM missing_table;',
    };

    expect(() => migrate(database, now, [...MIGRATIONS, broken])).toThrow();
    expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'half_done'").get()).toBeUndefined();
    expect(database.prepare('SELECT max(version) AS version FROM schema_migrations').get()).toEqual({
      version: LATEST,
    });
  });
});

describe('initial schema', (): void => {
  const database = freshDatabase();
  migrate(database, now);

  const permissionsOf = (roleKey: string): readonly string[] =>
    database
      .prepare<[string], { permission_key: string }>(
        `SELECT permission_key FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
         WHERE r.key = ? ORDER BY permission_key`,
      )
      .all(roleKey)
      .map((row) => row.permission_key);

  it('seeds exactly the permission catalog of the domain', (): void => {
    const seeded = database
      .prepare<[], { key: string }>('SELECT key FROM permissions ORDER BY key')
      .all()
      .map((row) => row.key);

    expect(seeded).toEqual([...PERMISSIONS].sort());
  });

  it('gives the platform administrator every permission', (): void => {
    expect(permissionsOf('platform-admin')).toEqual([...PERMISSIONS].sort());
  });

  it('lets release managers delete and restore but not purge releases', (): void => {
    expect(permissionsOf('release-manager')).toEqual(
      expect.arrayContaining(['releases.delete', 'releases.restore', 'artifacts.delete']),
    );
    expect(permissionsOf('release-manager')).not.toContain('releases.purge');
    expect(permissionsOf('release-manager')).not.toContain('permissions.manage');
  });

  it('keeps testers and viewers to reading and downloading', (): void => {
    expect(permissionsOf('tester')).toEqual(['artifacts.download', 'releases.read']);
    expect(permissionsOf('viewer')).toEqual(['artifacts.download', 'projects.read']);
  });

  it('makes the audit log append-only', (): void => {
    database
      .prepare(
        `INSERT INTO audit_logs (occurred_at, actor_type, actor_label, action, target_type, outcome)
         VALUES (?, 'system', 'test', 'test.event', 'test', 'success')`,
      )
      .run(now.toISOString());

    expect(() => database.prepare("UPDATE audit_logs SET action = 'tampered'").run()).toThrow(
      'audit_logs is append-only',
    );
    expect(() => database.prepare('DELETE FROM audit_logs').run()).toThrow('audit_logs is append-only');
  });

  it('enforces foreign keys', (): void => {
    expect(() =>
      database
        .prepare(
          `INSERT INTO applications (id, project_id, slug, name, visibility, status, created_at, updated_at)
           VALUES ('a', 'missing-project', 'x', 'X', 'private', 'active', ?, ?)`,
        )
        .run(now.toISOString(), now.toISOString()),
    ).toThrow(/FOREIGN KEY/);
  });
});

describe('migrate with two processes', (): void => {
  it('applies each migration only once when web service and worker start together', async (): Promise<void> => {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const { openDatabase } = await import('../adapters/persistence/sqlite-database.js');
    const base = await mkdtemp(path.join(tmpdir(), 'migrate-'));
    const web = openDatabase(path.join(base, 'distribution.db'));
    const worker = openDatabase(path.join(base, 'distribution.db'));

    expect(migrate(web, now).applied).toEqual(MIGRATIONS.map((migration) => migration.version));
    expect(migrate(worker, now)).toEqual({ applied: [], currentVersion: LATEST });

    web.close();
    worker.close();
    await rm(base, { recursive: true, force: true });
  });
});

describe('migration 3 (share links)', (): void => {
  it('keeps every audit entry, accepts share actors and stays append-only', (): void => {
    const database = freshDatabase();
    const insert = (actorType: string): void => {
      database
        .prepare(
          `INSERT INTO audit_logs (occurred_at, actor_type, actor_label, action, target_type, outcome)
           VALUES (?, ?, 'label', 'test.entry', 'test', 'success')`,
        )
        .run(now.toISOString(), actorType);
    };

    migrate(
      database,
      now,
      MIGRATIONS.filter((migration) => migration.version < 3),
    );
    insert('system');
    insert('ci');
    expect(() => insert('share')).toThrow(/CHECK/);

    migrate(database, now);
    insert('share');

    expect(database.prepare('SELECT id, actor_type FROM audit_logs ORDER BY id').all()).toEqual([
      { id: 1, actor_type: 'system' },
      { id: 2, actor_type: 'ci' },
      { id: 3, actor_type: 'share' },
    ]);
    expect(() => database.prepare('UPDATE audit_logs SET action = ?').run('changed')).toThrow(/append-only/);
    expect(() => database.prepare('DELETE FROM audit_logs').run()).toThrow(/append-only/);
  });

  it('keeps application icons when assets learn to belong to projects', (): void => {
    const database = freshDatabase();
    migrate(
      database,
      now,
      MIGRATIONS.filter((migration) => migration.version <= 7),
    );

    const ids = {
      project: '0192f3a4-0000-7000-8000-000000000001',
      application: '0192f3a4-0000-7000-8000-000000000002',
    };
    const at = now.toISOString();
    database
      .prepare('INSERT INTO projects (id, slug, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(ids.project, 'p', 'P', 'active', at, at);
    database
      .prepare(
        'INSERT INTO applications (id, project_id, slug, name, visibility, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(ids.application, ids.project, 'a', 'A', 'private', 'active', at, at);
    database
      .prepare(
        `INSERT INTO assets (id, application_id, kind, content_type, size_bytes, sha256, storage_key, created_at)
         VALUES ('icon', ?, 'icon', 'image/png', 10, ?, 'assets/a/icon.png', ?)`,
      )
      .run(ids.application, 'a'.repeat(64), at);
    database.prepare('UPDATE applications SET icon_asset_id = ? WHERE id = ?').run('icon', ids.application);

    expect(migrate(database, now).applied).toEqual(
      MIGRATIONS.filter((migration) => migration.version > 7).map((m) => m.version),
    );
    expect(database.prepare('SELECT id, application_id, project_id FROM assets').all()).toEqual([
      { id: 'icon', application_id: ids.application, project_id: null },
    ]);
    expect(database.pragma('foreign_key_check')).toEqual([]);
    expect(() =>
      database
        .prepare(
          `INSERT INTO assets (id, application_id, project_id, kind, content_type, size_bytes, sha256, storage_key, created_at)
           VALUES ('both', ?, ?, 'icon', 'image/png', 10, ?, 'assets/b', ?)`,
        )
        .run(ids.application, ids.project, 'b'.repeat(64), at),
    ).toThrow(/CHECK/);
  });
});
