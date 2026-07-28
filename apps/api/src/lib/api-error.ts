import type { ErrorCode, ErrorResponse } from '@mymd/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

export class ApiError extends Error {
  public constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function sendApiError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: ApiError,
): FastifyReply {
  const body: ErrorResponse = {
    error: {
      code: error.code,
      message: error.message,
      requestId: request.id,
      ...(error.details === undefined ? {} : { details: error.details }),
    },
  };

  return reply.status(error.statusCode).send(body);
}
