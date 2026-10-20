import type { Clock } from '../domain/ports/clock.js';
import type { IdGenerator } from '../domain/ports/id-generator.js';
import type { UnitOfWork } from '../domain/ports/unit-of-work.js';
import type { ActorContext } from './authorization.js';
import type { Actor, RequestContext } from './request-context.js';

export interface UseCaseDependencies {
  readonly unitOfWork: UnitOfWork;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

export function contextOf(
  dependencies: Pick<UseCaseDependencies, 'unitOfWork' | 'clock'>,
  actor: Actor,
  request: RequestContext,
): ActorContext {
  return { unitOfWork: dependencies.unitOfWork, actor, request, now: dependencies.clock.now() };
}
