import type { CiJobIdentity } from '../entities/ci-binding.js';
import type { WorkflowRun } from '../entities/release.js';

/** A GitHub Actions job as its verified OIDC token describes it. */
export interface CiJob extends CiJobIdentity {
  /** Commit the job runs on. */
  readonly sha: string;
  readonly workflowRun: WorkflowRun;
  /** GitHub login of whoever triggered the run; for the audit log. */
  readonly actor: string;
}

export interface CiTokenVerifier {
  /** Checks signature, issuer, audience and lifetime; fails with `ci_token_invalid` and never echoes the token. */
  verify(token: string): Promise<CiJob>;
}
