import { describe, expect, it } from 'vitest';

import { parseId } from './identifier.js';
import { covers, GLOBAL, scopeOf, type Target } from './scope.js';

const mdAmbulant = parseId<'Project'>('0192f3a4-0000-7000-8000-000000000010');
const otherProject = parseId<'Project'>('0192f3a4-0000-7000-8000-000000000011');
const kMobile = parseId<'Application'>('0192f3a4-0000-7000-8000-000000000020');
const kMobileTarget: Target = { type: 'application', projectId: mdAmbulant, applicationId: kMobile };

describe('covers', (): void => {
  it('lets a project scope cover the project and its applications only', (): void => {
    const scope = { type: 'project', projectId: mdAmbulant } as const;

    expect(covers(scope, { type: 'project', projectId: mdAmbulant })).toBe(true);
    expect(covers(scope, kMobileTarget)).toBe(true);
    expect(covers(scope, { type: 'project', projectId: otherProject })).toBe(false);
    expect(covers(scope, GLOBAL)).toBe(false);
  });

  it('does not let an application scope cover its project', (): void => {
    const scope = { type: 'application', applicationId: kMobile } as const;

    expect(covers(scope, kMobileTarget)).toBe(true);
    expect(covers(scope, { type: 'project', projectId: mdAmbulant })).toBe(false);
  });
});

describe('scopeOf', (): void => {
  it('derives the scope of a target without the project of an application', (): void => {
    expect(scopeOf(GLOBAL)).toEqual(GLOBAL);
    expect(scopeOf({ type: 'project', projectId: mdAmbulant })).toEqual({ type: 'project', projectId: mdAmbulant });
    expect(scopeOf(kMobileTarget)).toEqual({ type: 'application', applicationId: kMobile });
  });
});
