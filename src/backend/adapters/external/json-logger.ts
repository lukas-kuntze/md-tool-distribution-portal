import type { Logger } from '../../domain/ports/logger.js';

type Level = 'info' | 'warn' | 'error';

/** One JSON object per line on stdout, for the Windows service wrapper or a log shipper to pick up. */
export class JsonLogger implements Logger {
  public constructor(
    private readonly component: string,
    private readonly write: (line: string) => void = (line): void => {
      process.stdout.write(line);
    },
  ) {}

  public info(message: string, context?: Readonly<Record<string, unknown>>): void {
    this.log('info', message, context);
  }

  public warn(message: string, context?: Readonly<Record<string, unknown>>): void {
    this.log('warn', message, context);
  }

  public error(message: string, context?: Readonly<Record<string, unknown>>): void {
    this.log('error', message, context);
  }

  private log(level: Level, message: string, context: Readonly<Record<string, unknown>> = {}): void {
    this.write(
      `${JSON.stringify({ time: new Date().toISOString(), level, component: this.component, message, ...context })}\n`,
    );
  }
}
