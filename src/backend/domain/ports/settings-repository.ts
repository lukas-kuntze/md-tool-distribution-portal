import type { Settings } from '../entities/settings.js';
import type { ChangeContext, Stored } from './stored.js';

export interface SettingsRepository {
  /** The stored settings over the defaults; `null` before they were seeded. */
  load(): Stored<Settings> | null;
  /** Stores the settings once, unless they exist already; returns whether it did. */
  seed(settings: Settings, at: Date): boolean;
  /** Fails with `concurrent_modification` if someone else saved in between. */
  save(settings: Settings, expectedRowVersion: number, context: ChangeContext): number;
}
