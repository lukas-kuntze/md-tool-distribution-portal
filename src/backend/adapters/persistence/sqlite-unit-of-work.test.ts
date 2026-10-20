import { describe, expect, it } from 'vitest';

import { buildProject, createTestDatabase } from './testing/sqlite-fixtures.js';

describe('SqliteUnitOfWork', (): void => {
  it('commits all changes of a transaction together', (): void => {
    const test = createTestDatabase();
    const project = buildProject();

    const result = test.unitOfWork.transaction(({ projects }) => {
      projects.insert(project, test.context);
      return 'done';
    });

    expect(result).toBe('done');
    expect(test.unitOfWork.read(({ projects }) => projects.findById(project.id))).not.toBeNull();
  });

  it('rolls back every change when the work fails', (): void => {
    const test = createTestDatabase();
    const project = buildProject();

    expect(() =>
      test.unitOfWork.transaction(({ projects }) => {
        projects.insert(project, test.context);
        throw new Error('later step failed');
      }),
    ).toThrow('later step failed');
    expect(test.unitOfWork.read(({ projects }) => projects.findById(project.id))).toBeNull();
  });
});
