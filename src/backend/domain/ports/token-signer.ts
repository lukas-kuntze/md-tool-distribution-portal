/**
 * Tamper-proof, self-contained tokens for links that have to work without the session cookie, such as the
 * iOS installation, where the device fetches manifest and IPA outside the browser.
 */
export interface TokenSigner {
  /** URL-safe token that carries the payload readably (signed, not encrypted). */
  sign(payload: string): string;
  /** The payload if the token is intact, otherwise `null`. */
  verify(token: string): string | null;
}
