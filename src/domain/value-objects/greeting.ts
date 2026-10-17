export interface Greeting {
  readonly message: string;
}

export function greet(name: string): Greeting {
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    throw new Error('name must not be empty');
  }

  return { message: `Hello, ${trimmed}!` };
}
