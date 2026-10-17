import { describe, expect, it } from 'vitest';

import { greet, type Greeting } from './greeting.js';

describe('greet', (): void => {
  it('returns a greeting for the given name', (): void => {
    expect(greet('World')).toEqual({ message: 'Hello, World!' });
  });

  it('ignores surrounding whitespace', (): void => {
    expect(greet('  World  ')).toEqual({ message: 'Hello, World!' });
  });

  it('rejects a name that is empty or whitespace only', (): void => {
    expect((): Greeting => greet('   ')).toThrow('name must not be empty');
  });
});
