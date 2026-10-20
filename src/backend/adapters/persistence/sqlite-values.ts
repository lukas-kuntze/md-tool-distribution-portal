import { DomainError, type DomainErrorCode } from '../../domain/value-objects/domain-error.js';

export function toDbTime(value: Date): string;
export function toDbTime(value: Date | null): string | null;
export function toDbTime(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

export function fromDbTime(value: string): Date;
export function fromDbTime(value: string | null): Date | null;
export function fromDbTime(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

export function toDbBoolean(value: boolean): number {
  return value ? 1 : 0;
}

export function fromDbBoolean(value: number): boolean {
  return value === 1;
}

/** Escapes `%`, `_` and the escape character itself for use in `LIKE … ESCAPE '\'`. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

export interface ConstraintTranslation {
  /** Part of the SQLite error message naming the constraint, e.g. `projects.slug` or `index 'name'`. */
  readonly constraint: string;
  readonly code: DomainErrorCode;
  readonly message: string;
}

/** Turns violations of the given uniqueness constraints into domain errors; everything else is rethrown. */
export function translateConstraints<Result>(
  work: () => Result,
  translations: readonly ConstraintTranslation[],
): Result {
  try {
    return work();
  } catch (error) {
    const translation = isConstraintError(error)
      ? translations.find((candidate) => error.message.includes(candidate.constraint))
      : undefined;

    if (translation !== undefined) {
      throw new DomainError(translation.code, translation.message);
    }

    throw error;
  }
}

/** Optimistic locking: an update that matched no row was based on an outdated version. */
export function assertRowUpdated(changes: number): void {
  if (changes === 0) {
    throw new DomainError(
      'concurrent_modification',
      'The record was changed or removed in the meantime; reload it and try again.',
    );
  }
}

function isConstraintError(error: unknown): error is Error & { code: string } {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code.startsWith('SQLITE_CONSTRAINT')
  );
}
