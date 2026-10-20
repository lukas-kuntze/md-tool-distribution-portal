import {
  createShareLink as newShareLink,
  revokeShareLink as revoked,
  type ReleaseSelection,
  type ShareLink,
  type ShareScope,
} from '../domain/entities/share-link.js';
import { latestShareExpiry } from '../domain/entities/settings.js';
import type { TokenGenerator } from '../domain/ports/token-generator.js';
import type { Repositories } from '../domain/ports/unit-of-work.js';
import { DomainError } from '../domain/value-objects/domain-error.js';
import type { ShareLinkId } from '../domain/value-objects/identifier.js';
import type { Target } from '../domain/value-objects/scope.js';
import { auditChange, authorizedRead, authorizedTransaction } from './authorization.js';
import { requireApplication, requireProject } from './lookups.js';
import { resolveTarget } from './manage-access.js';
import { currentSettings } from './manage-settings.js';
import type { Actor, RequestContext } from './request-context.js';
import { contextOf, type UseCaseDependencies } from './use-case.js';

export interface ShareLinkDependencies extends UseCaseDependencies {
  readonly tokens: TokenGenerator;
}

/** A share link together with what the administration shows about it. */
export interface ShareLinkView {
  readonly link: ShareLink;
  /** Name of the shared project or application. */
  readonly scopeName: string;
  readonly createdBy: string | null;
}

export interface CreatedShareLink {
  readonly view: ShareLinkView;
  /** The secret of the link; returned once and never stored. */
  readonly token: string;
}

/**
 * Creates a link for people without an account, e.g. a customer: it shows the published releases of a
 * project or application and lets them download and install them. Needs `shares.manage` at the scope.
 */
export function createShareLink(
  dependencies: ShareLinkDependencies,
  actor: Actor,
  request: RequestContext,
  input: {
    readonly scope: ShareScope;
    readonly label: string;
    readonly releases: ReleaseSelection;
    readonly expiresAt: Date | null;
  },
): CreatedShareLink {
  const context = contextOf(dependencies, actor, request);
  const issued = dependencies.tokens.issue();

  const view = authorizedTransaction(context, (repositories, guard) => {
    const target = resolveTarget(repositories, input.scope);
    guard.require('shares.manage', target, { type: 'share_link', id: null });
    assertShareable(repositories, input.scope);

    // The settings may limit how long a link lives; links without expiry are then not allowed either.
    const latest = latestShareExpiry(currentSettings(repositories), context.now);

    if (latest !== null && (input.expiresAt === null || input.expiresAt > latest)) {
      throw new DomainError('share_link_too_long', `Share links may be valid until ${latest.toISOString()} at most.`);
    }

    const link = newShareLink(
      {
        id: dependencies.ids.next<'ShareLink'>(),
        scope: input.scope,
        label: input.label,
        releases: input.releases,
        expiresAt: input.expiresAt,
      },
      context.now,
      actor.userId,
    );

    repositories.shareLinks.insert(link, issued.hash);
    repositories.auditLog.append(
      auditChange(
        context,
        'share_link.created',
        target,
        { type: 'share_link', id: link.id },
        {
          label: link.label,
          scope: link.scope,
          releases: link.releases,
          expiresAt: link.expiresAt?.toISOString() ?? null,
        },
      ),
    );
    return viewOf(repositories, link);
  });

  return { view, token: issued.token };
}

/** Links of a project (including those of its applications) or of one application, newest first. */
export function listShareLinks(
  dependencies: Pick<UseCaseDependencies, 'unitOfWork' | 'clock'>,
  actor: Actor,
  request: RequestContext,
  scope: ShareScope,
): readonly ShareLinkView[] {
  return authorizedRead(contextOf(dependencies, actor, request), (repositories, guard) => {
    const target = resolveTarget(repositories, scope);
    guard.require('shares.manage', target, { type: 'share_link', id: null });

    const links =
      scope.type === 'project'
        ? repositories.shareLinks.listByProject(scope.projectId)
        : repositories.shareLinks.listByApplication(scope.applicationId);

    return links.map((link) => viewOf(repositories, link));
  });
}

export function revokeShareLink(
  dependencies: Pick<UseCaseDependencies, 'unitOfWork' | 'clock'>,
  actor: Actor,
  request: RequestContext,
  input: { readonly shareLinkId: ShareLinkId },
): void {
  const context = contextOf(dependencies, actor, request);

  authorizedTransaction(context, (repositories, guard) => {
    const link = repositories.shareLinks.findById(input.shareLinkId);

    if (link === null) {
      throw new DomainError('share_link_not_found', 'The share link does not exist or was already revoked.');
    }

    const target: Target = resolveTarget(repositories, link.scope);
    guard.require('shares.manage', target, { type: 'share_link', id: link.id });

    repositories.shareLinks.update(revoked(link, context.now, actor.userId));
    repositories.auditLog.append(
      auditChange(context, 'share_link.revoked', target, { type: 'share_link', id: link.id }, { label: link.label }),
    );
  });
}

/** Archived projects and applications are hidden from customers, so they cannot be shared either. */
function assertShareable(repositories: Repositories, scope: ShareScope): void {
  let active: boolean;

  if (scope.type === 'project') {
    active = requireProject(repositories, scope.projectId).value.status === 'active';
  } else {
    const application = requireApplication(repositories, scope.applicationId).value;
    active =
      application.status === 'active' && requireProject(repositories, application.projectId).value.status === 'active';
  }

  if (!active) {
    throw new DomainError('invalid_share_link', 'Archived projects and applications cannot be shared.');
  }
}

function viewOf(repositories: Repositories, link: ShareLink): ShareLinkView {
  const scopeName =
    link.scope.type === 'project'
      ? (repositories.projects.findById(link.scope.projectId)?.value.name ?? '')
      : (repositories.applications.findById(link.scope.applicationId)?.value.name ?? '');

  return { link, scopeName, createdBy: repositories.users.findById(link.createdBy)?.displayName ?? null };
}
