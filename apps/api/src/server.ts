import { parseServerConfig } from '@teammd/config';
import dotenv from 'dotenv';

import { buildApp } from './app.js';
import { createPrismaClient } from './infrastructure/prisma.js';
import { CollaborationCheckpointService } from './modules/collaboration/collaboration-checkpoint-service.js';
import { createCollaborationServer } from './modules/collaboration/collaboration-server.js';
import { CollaborationService } from './modules/collaboration/collaboration-service.js';
import { createServerShutdown } from './server-shutdown.js';
import { WorkspaceService } from './modules/workspace/workspace-service.js';

dotenv.config({ path: '../../.env.local' });

const config = parseServerConfig(process.env);
const prisma = createPrismaClient();
const collaborationService = new CollaborationService(prisma);
const collaborationServer = createCollaborationServer(
  config,
  collaborationService,
);
const workspaceService = new WorkspaceService(prisma);
const collaborationCheckpointService = new CollaborationCheckpointService(
  collaborationServer.hocuspocus,
  collaborationService,
  workspaceService,
);
const app = await buildApp({
  config,
  prisma,
  collaborationCheckpointService,
  collaborationService,
  closeCollaborationConnections: (documentId) =>
    collaborationServer.hocuspocus.closeConnections(documentId),
  workspaceService,
});

const close = createServerShutdown({
  closeApi: () => app.close(),
  closeCollaboration: () => collaborationServer.destroy(),
  disconnectDatabase: () => prisma.$disconnect(),
});

const handleSignal = (): void => {
  void close().catch((error: unknown) => {
    app.log.error({ error }, 'Server shutdown failed.');
    process.exitCode = 1;
  });
};

process.once('SIGINT', handleSignal);
process.once('SIGTERM', handleSignal);

await app.listen({ host: config.host, port: config.port });
await collaborationServer.listen(config.collaborationPort);
