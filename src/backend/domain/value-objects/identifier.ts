import { DomainError } from './domain-error.js';

declare const idBrand: unique symbol;

/** Server-generated identifier of an entity: a canonical, lowercase UUIDv7. */
export type Id<Entity extends string> = string & { readonly [idBrand]: Entity };

export type ProjectId = Id<'Project'>;
export type ApplicationId = Id<'Application'>;
export type FlavorId = Id<'Flavor'>;
export type ReleaseId = Id<'Release'>;
export type ArtifactId = Id<'Artifact'>;
export type DeletionJobId = Id<'DeletionJob'>;
export type UserId = Id<'User'>;
export type TeamId = Id<'Team'>;
export type RoleAssignmentId = Id<'RoleAssignment'>;
export type RoleId = Id<'Role'>;
export type UploadId = Id<'Upload'>;
export type SessionId = Id<'Session'>;
export type ShareLinkId = Id<'ShareLink'>;
export type StorageReportId = Id<'StorageReport'>;
export type AssetId = Id<'Asset'>;
export type CiBindingId = Id<'CiBinding'>;

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isId(value: string): boolean {
  return UUID_V7.test(value);
}

export function parseId<Entity extends string>(value: string): Id<Entity> {
  if (!isId(value)) {
    throw new DomainError('invalid_id', 'Identifier must be a canonical lowercase UUIDv7.');
  }

  return value as Id<Entity>;
}
