import { z } from 'zod';

export const errorCodeSchema = z.enum([
  'VALIDATION_ERROR',
  'AUTHENTICATION_REQUIRED',
  'INVALID_CREDENTIALS',
  'CSRF_INVALID',
  'FORBIDDEN',
  'RESOURCE_NOT_FOUND',
  'NAME_CONFLICT',
  'REVISION_CONFLICT',
  'COLLABORATION_PROTOCOL_MISMATCH',
  'INVITATION_INVALID',
  'INVITATION_EXPIRED',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
]);

export const errorResponseSchema = z
  .object({
    error: z
      .object({
        code: errorCodeSchema,
        message: z.string().min(1).max(500),
        details: z.record(z.string(), z.unknown()).optional(),
        requestId: z.string().min(1).max(100),
      })
      .strict(),
  })
  .strict();

export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
