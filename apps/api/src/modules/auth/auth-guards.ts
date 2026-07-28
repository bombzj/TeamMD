import type { FastifyRequest } from 'fastify';

import { ApiError } from '../../lib/api-error.js';
import type { AuthService } from './auth-service.js';

export function requireSession(request: FastifyRequest) {
  if (request.authSession === null) {
    throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Sign in required.');
  }
  return request.authSession;
}

export function requireMutationAuth(
  request: FastifyRequest,
  authService: AuthService,
  webOrigin: string,
) {
  requireAllowedOrigin(request, webOrigin);
  const session = requireSession(request);
  const token = request.headers['x-csrf-token'];
  if (typeof token !== 'string' || !authService.csrfMatches(session, token)) {
    throw new ApiError(
      403,
      'CSRF_INVALID',
      'The request could not be verified.',
    );
  }
  return session;
}

export function requireAllowedOrigin(
  request: FastifyRequest,
  webOrigin: string,
): void {
  if (request.headers.origin !== webOrigin) {
    throw new ApiError(
      403,
      'CSRF_INVALID',
      'The request origin is not allowed.',
    );
  }
}
