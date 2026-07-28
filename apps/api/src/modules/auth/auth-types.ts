import type { UserDto } from '@mymd/contracts';

export type AuthenticatedSession = {
  id: string;
  user: UserDto;
  csrfTokenHash: string;
};

export type SessionContext = {
  userAgentSummary: string | null;
};

declare module 'fastify' {
  interface FastifyRequest {
    authSession: AuthenticatedSession | null;
  }
}
