import { describe, expect, it } from 'vitest';

import { JsonLogger } from './json-logger.js';

describe('JsonLogger', (): void => {
  it('writes one JSON object per line with level, component and context', (): void => {
    const lines: string[] = [];
    const logger = new JsonLogger('web', (line) => lines.push(line));

    logger.info('request', { status: 200 });
    logger.warn('slow');
    logger.error('failed', { correlationId: 'c-1' });

    expect(lines.every((line) => line.endsWith('\n'))).toBe(true);
    expect(lines.map((line) => JSON.parse(line) as Record<string, unknown>)).toEqual([
      expect.objectContaining({ level: 'info', component: 'web', message: 'request', status: 200 }),
      expect.objectContaining({ level: 'warn', message: 'slow' }),
      expect.objectContaining({ level: 'error', message: 'failed', correlationId: 'c-1' }),
    ]);
  });
});
