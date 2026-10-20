import { z } from 'zod';

import { isId, type Id } from '../../domain/value-objects/identifier.js';

/** Identifier path or body field; anything but a canonical UUIDv7 is rejected before it reaches a use case. */
export function idOf<Entity extends string>(): z.ZodType<Id<Entity>> {
  return z.string().refine(isId, { message: 'Expected an identifier.' }) as unknown as z.ZodType<Id<Entity>>;
}

export const rowVersion = z.number().int().positive();

export const platformSchema = z.enum(['android', 'ios']);

export const bundleIdentifiersSchema = z
  .object({ android: z.string().max(255).nullable().optional(), ios: z.string().max(255).nullable().optional() })
  .strict();

export const scopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('global') }),
  z.object({ type: z.literal('project'), projectId: idOf<'Project'>() }),
  z.object({ type: z.literal('application'), applicationId: idOf<'Application'>() }),
]);

export const pagination = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};

/** Comma-separated query parameter, e.g. `?status=draft,published`. */
export function csvOf<Value extends string>(
  values: readonly [Value, ...Value[]],
): z.ZodType<readonly Value[] | undefined> {
  return z
    .string()
    .optional()
    .transform((raw) => (raw === undefined || raw === '' ? undefined : raw.split(',')))
    .pipe(z.array(z.enum(values)).optional());
}

/** Scope given as query parameters, e.g. `?scope=application&id=…`. */
export const scopeQuerySchema = z
  .object({ scope: z.enum(['global', 'project', 'application']).default('global'), id: z.string().optional() })
  .transform((query, context) => {
    if (query.scope === 'global') {
      return { type: 'global' } as const;
    }

    if (query.id === undefined || !isId(query.id)) {
      context.addIssue({ code: 'custom', path: ['id'], message: 'Expected an identifier.' });
      return z.NEVER;
    }

    return query.scope === 'project'
      ? ({ type: 'project', projectId: query.id as Id<'Project'> } as const)
      : ({ type: 'application', applicationId: query.id as Id<'Application'> } as const);
  });

/** Response header of paged lists: the number of all matching entries, so that clients can show page numbers. */
export const TOTAL_COUNT = 'x-total-count';
