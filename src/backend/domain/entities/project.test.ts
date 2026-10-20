import { describe, expect, it } from 'vitest';

import { parseDisplayName } from '../value-objects/display-name.js';
import { parseId } from '../value-objects/identifier.js';
import { parseSlug } from '../value-objects/slug.js';
import {
  archiveProject,
  createProject,
  PROJECT_DESCRIPTION_MAX_LENGTH,
  restoreProject,
  updateProjectDetails,
  type Project,
} from './project.js';

const now = new Date('2026-10-17T10:00:00Z');
const actor = parseId<'User'>('0192f3a4-0000-7000-8000-000000000001');
const errorCode = (code: string): unknown => expect.objectContaining({ code });

function project(): Project {
  return createProject(
    parseId('0192f3a4-0000-7000-8000-000000000010'),
    parseSlug('md-ambulant'),
    parseDisplayName('MD Ambulant'),
    '',
  );
}

describe('project', (): void => {
  it('starts active', (): void => {
    expect(project()).toMatchObject({ status: 'active', archivedAt: null });
  });

  it('updates name and description while active', (): void => {
    expect(updateProjectDetails(project(), parseDisplayName('MD Ambulant Pflege'), 'Neu')).toMatchObject({
      name: 'MD Ambulant Pflege',
      description: 'Neu',
    });
  });

  it('limits the description', (): void => {
    expect((): Project =>
      updateProjectDetails(project(), project().name, 'x'.repeat(PROJECT_DESCRIPTION_MAX_LENGTH + 1)),
    ).toThrow(errorCode('invalid_name'));
  });

  it('is read-only while archived and can be restored', (): void => {
    const archived = archiveProject(project(), now, actor);

    expect(archived).toMatchObject({ status: 'archived', archivedAt: now, archivedBy: actor });
    expect((): Project => updateProjectDetails(archived, archived.name, '')).toThrow(
      errorCode('invalid_project_state'),
    );
    expect((): Project => archiveProject(archived, now, actor)).toThrow(errorCode('invalid_project_state'));
    expect(restoreProject(archived)).toMatchObject({ status: 'active', archivedAt: null, archivedBy: null });
    expect((): Project => restoreProject(project())).toThrow(errorCode('invalid_project_state'));
  });
});
