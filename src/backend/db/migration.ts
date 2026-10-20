/** A forward-only schema change. Applied migrations are never edited; changes go into a new migration. */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}
