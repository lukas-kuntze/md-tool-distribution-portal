import type { CiBinding } from '../entities/ci-binding.js';
import type { ApplicationId, CiBindingId } from '../value-objects/identifier.js';

export interface CiBindingRepository {
  insert(binding: CiBinding): void;
  /** Persists the revocation; nothing else about a binding changes. */
  update(binding: CiBinding): void;
  findById(id: CiBindingId): CiBinding | null;
  /** Bindings of the application including revoked ones, newest first. */
  listByApplication(applicationId: ApplicationId): readonly CiBinding[];
}
