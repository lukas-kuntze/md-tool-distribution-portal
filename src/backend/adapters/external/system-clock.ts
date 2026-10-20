import type { Clock } from '../../domain/ports/clock.js';

export class SystemClock implements Clock {
  public now(): Date {
    return new Date();
  }
}
