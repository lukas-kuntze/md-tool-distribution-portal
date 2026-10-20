import type { Id } from '../value-objects/identifier.js';

export interface IdGenerator {
  /** A new, time-ordered UUIDv7. */
  next<Entity extends string>(): Id<Entity>;
}
