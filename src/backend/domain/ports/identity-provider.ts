/**
 * A person as described by GitHub (github.com or GitHub Enterprise). `subject` is the numeric user id, which never
 * changes; together with the host it identifies the person.
 */
export interface ExternalProfile {
  readonly providerHost: string;
  readonly subject: string;
  readonly nodeId: string | null;
  /** Can be renamed at any time; never used to identify the person. */
  readonly login: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly avatarUrl: string | null;
}

export interface SignInResult {
  readonly profile: ExternalProfile;
  /** Membership of the configured organisation. It only decides whether someone may sign in. */
  readonly isOrganizationMember: boolean;
}

export interface IdentityProvider {
  /** Where to send the browser to start the OAuth flow; `state` ties the callback to this browser. */
  authorizationUrl(state: string): string;
  /** Exchanges the authorization code from the callback. Fails with `sign_in_failed`. */
  completeSignIn(code: string): Promise<SignInResult>;
}
