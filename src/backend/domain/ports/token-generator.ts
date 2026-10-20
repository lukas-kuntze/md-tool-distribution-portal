export interface IssuedToken {
  /** Handed to the client once; never stored. */
  readonly token: string;
  readonly hash: string;
}

/** Unguessable secrets for session cookies and OAuth state. */
export interface TokenGenerator {
  issue(): IssuedToken;
  hash(token: string): string;
}
