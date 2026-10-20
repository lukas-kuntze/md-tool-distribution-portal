import { describe, expect, it } from 'vitest';

import { createTestDatabase, nextId } from './testing/sqlite-fixtures.js';

describe('SqliteUserRepository', (): void => {
  it('loads stored users and returns null for unknown ones', (): void => {
    const test = createTestDatabase();

    expect(test.unitOfWork.read(({ users }) => users.findById(test.userId))).toEqual({
      id: test.userId,
      displayName: 'Release Manager',
      email: null,
      avatarUrl: null,
      status: 'active',
    });
    expect(test.unitOfWork.read(({ users }) => users.findById(nextId()))).toBeNull();
  });
});
