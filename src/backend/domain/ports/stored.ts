import type { UserId } from '../value-objects/identifier.js';

/** An entity as loaded from persistence, together with the version used for optimistic locking. */
export interface Stored<Entity> {
  readonly value: Entity;
  readonly rowVersion: number;
}

/** Who changes something and when; written to the change columns of the affected rows. */
export interface ChangeContext {
  /** `null` for changes made by a workflow or by the system itself. */
  readonly actor: UserId | null;
  readonly at: Date;
}
