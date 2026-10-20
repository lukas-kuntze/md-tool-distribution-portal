import { describe, expect, it } from 'vitest';

import { archiveProject, updateProjectDetails } from '../../domain/entities/project.js';
import { parseDisplayName } from '../../domain/value-objects/display-name.js';
import { parseSlug } from '../../domain/value-objects/slug.js';
import { buildProject, createTestDatabase, NOW } from './testing/sqlite-fixtures.js';

const errorCode = (code: string): unknown => expect.objectContaining({ code });

describe('SqliteProjectRepository', (): void => {
  it('stores and loads projects by id and slug', (): void => {
    const test = createTestDatabase();
    const project = buildProject('md-ambulant');

    test.unitOfWork.transaction(({ projects }) => projects.insert(project, test.context));

    expect(test.unitOfWork.read(({ projects }) => projects.findById(project.id))).toEqual({
      value: project,
      rowVersion: 1,
    });
    expect(test.unitOfWork.read(({ projects }) => projects.findBySlug(parseSlug('md-ambulant')))?.value).toEqual(
      project,
    );
    expect(test.unitOfWork.read(({ projects }) => projects.findBySlug(parseSlug('unknown')))).toBeNull();
  });

  it('rejects a second project with the same slug', (): void => {
    const test = createTestDatabase();

    test.unitOfWork.transaction(({ projects }) => projects.insert(buildProject('md-ambulant'), test.context));

    expect(() =>
      test.unitOfWork.transaction(({ projects }) => projects.insert(buildProject('md-ambulant'), test.context)),
    ).toThrow(errorCode('slug_taken'));
  });

  it('updates with optimistic locking', (): void => {
    const test = createTestDatabase();
    const project = buildProject();
    test.unitOfWork.transaction(({ projects }) => projects.insert(project, test.context));

    const renamed = updateProjectDetails(project, parseDisplayName('MD Ambulant Pflege'), 'Neu');
    const version = test.unitOfWork.transaction(({ projects }) => projects.update(renamed, 1, test.context));

    expect(version).toBe(2);
    expect(test.unitOfWork.read(({ projects }) => projects.findById(project.id))).toEqual({
      value: renamed,
      rowVersion: 2,
    });
    expect(() => test.unitOfWork.transaction(({ projects }) => projects.update(renamed, 1, test.context))).toThrow(
      errorCode('concurrent_modification'),
    );
  });

  it('lists projects filtered by status', (): void => {
    const test = createTestDatabase();
    const active = buildProject('active');
    const archived = archiveProject(buildProject('archived'), NOW, test.userId);

    test.unitOfWork.transaction(({ projects }) => {
      projects.insert(active, test.context);
      projects.insert(archived, test.context);
    });

    const list = (status?: 'active' | 'archived'): readonly string[] =>
      test.unitOfWork.read(({ projects }) => projects.list({ status })).map((stored) => stored.value.slug);

    expect(list()).toHaveLength(2);
    expect(list('active')).toEqual(['active']);
    expect(list('archived')).toEqual(['archived']);
  });
});
