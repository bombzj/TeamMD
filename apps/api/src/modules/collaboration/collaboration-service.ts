import type {
  CollaborationEditorProtocol,
  CollaborationStateFormat,
  CollaborationTicketResponse,
  DocumentContentResponse,
} from '@teammd/contracts';
import { Prisma, type PrismaClient } from '@prisma/client';
import * as Y from 'yjs';

import { ApiError } from '../../lib/api-error.js';
import { createOpaqueToken, hashToken } from '../../lib/tokens.js';
import { requireDocumentAccess } from '../workspace/document-access-policy.js';

const ticketLifetimeMilliseconds = 60_000;
const maximumYjsStateBytes = 8 * 1024 * 1024;

export type CollaborationContext = {
  userId: string;
  userEmail: string;
  sessionId: string;
  documentId: string;
  permission: DocumentContentResponse['permission'];
  readOnly: boolean;
  stateFormat: CollaborationStateFormat;
};

export class CollaborationService {
  public constructor(private readonly prisma: PrismaClient) {}

  public async createTicket(
    userId: string,
    sessionId: string,
    documentId: string,
    websocketUrl: string,
    editorProtocol: CollaborationEditorProtocol,
  ): Promise<CollaborationTicketResponse> {
    const now = new Date();
    const [access, session] = await Promise.all([
      requireDocumentAccess(this.prisma, userId, documentId, 'read'),
      this.prisma.session.findFirst({
        where: {
          id: sessionId,
          userId,
          revokedAt: null,
          expiresAt: { gt: now },
          user: { disabledAt: null },
        },
        include: { user: { select: { sessionEpoch: true } } },
      }),
    ]);
    if (
      session === null ||
      session.sessionEpoch !== session.user.sessionEpoch
    ) {
      throw authenticationRequired();
    }

    const stateFormat = await this.getStateFormat(documentId);
    if (stateFormat !== editorProtocol) {
      throw protocolMismatch(stateFormat);
    }

    const ticket = createOpaqueToken();
    const expiresAt = new Date(now.getTime() + ticketLifetimeMilliseconds);
    await this.prisma.collaborationTicket.create({
      data: {
        tokenHash: hashToken(ticket),
        documentId,
        sessionId,
        userId,
        stateFormat: toStoredStateFormat(stateFormat),
        expiresAt,
      },
    });
    return {
      ticket,
      documentId,
      permission: access.permission,
      stateFormat,
      websocketUrl,
      expiresAt: expiresAt.toISOString(),
    };
  }

  public async consumeTicket(
    ticket: string,
    documentId: string,
  ): Promise<CollaborationContext> {
    return this.prisma.$transaction(async (transaction) => {
      const now = new Date();
      const stored = await transaction.collaborationTicket.findUnique({
        where: { tokenHash: hashToken(ticket) },
        include: { session: { include: { user: true } } },
      });
      if (
        stored === null ||
        stored.documentId !== documentId ||
        stored.consumedAt !== null ||
        stored.expiresAt <= now ||
        stored.session.revokedAt !== null ||
        stored.session.expiresAt <= now ||
        stored.session.user.disabledAt !== null ||
        stored.session.sessionEpoch !== stored.session.user.sessionEpoch ||
        stored.userId !== stored.session.userId
      ) {
        throw authenticationRequired();
      }

      const access = await requireDocumentAccess(
        transaction,
        stored.userId,
        documentId,
        'read',
      );
      const state = await transaction.collaborationState.findUnique({
        where: { documentId },
        select: { stateFormat: true },
      });
      const stateFormat = fromStoredStateFormat(
        state?.stateFormat ?? 'LEGACY_TEXT_V1',
      );
      if (stateFormat !== fromStoredStateFormat(stored.stateFormat)) {
        throw protocolMismatch(stateFormat);
      }
      const consumed = await transaction.collaborationTicket.updateMany({
        where: {
          id: stored.id,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw authenticationRequired();

      return {
        userId: stored.userId,
        userEmail: stored.session.user.email,
        sessionId: stored.sessionId,
        documentId,
        permission: access.permission,
        readOnly: access.permission === 'viewer',
        stateFormat,
      };
    });
  }

  public async getStateFormat(
    documentId: string,
  ): Promise<CollaborationStateFormat> {
    const state = await this.prisma.collaborationState.findUnique({
      where: { documentId },
      select: { stateFormat: true },
    });
    return fromStoredStateFormat(state?.stateFormat ?? 'LEGACY_TEXT_V1');
  }

  public async loadState(documentId: string): Promise<Uint8Array> {
    const stored = await this.prisma.collaborationState.findUnique({
      where: { documentId },
    });
    if (stored !== null) return new Uint8Array(stored.yjsState);

    const document = await this.prisma.document.findFirst({
      where: { id: documentId, trashedAt: null },
    });
    if (document?.currentRevisionId === null || document === null) {
      throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Document not found.');
    }
    const revision = await this.prisma.documentRevision.findUnique({
      where: { id: document.currentRevisionId },
    });
    if (revision === null) {
      throw new ApiError(
        500,
        'INTERNAL_ERROR',
        'The document revision state is invalid.',
      );
    }

    const yDocument = new Y.Doc();
    if (revision.content.length > 0) {
      yDocument.getText('content').insert(0, revision.content);
    }
    const yjsState = Y.encodeStateAsUpdate(yDocument);
    try {
      await this.prisma.collaborationState.create({
        data: {
          documentId,
          yjsState: Buffer.from(yjsState),
          checkpointRevisionId: revision.id,
        },
      });
      return yjsState;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const concurrent =
          await this.prisma.collaborationState.findUniqueOrThrow({
            where: { documentId },
          });
        return new Uint8Array(concurrent.yjsState);
      }
      throw error;
    } finally {
      yDocument.destroy();
    }
  }

  public async storeState(
    documentId: string,
    yjsState: Uint8Array,
    expectedFormat?: CollaborationStateFormat,
  ): Promise<void> {
    if (yjsState.byteLength > maximumYjsStateBytes) {
      throw new ApiError(
        413,
        'VALIDATION_ERROR',
        'The collaborative document state is too large.',
      );
    }
    await this.prisma.collaborationState.updateMany({
      where: {
        documentId,
        ...(expectedFormat === undefined
          ? {}
          : { stateFormat: toStoredStateFormat(expectedFormat) }),
      },
      data: { yjsState: Buffer.from(yjsState) },
    });
  }

  public async convertLegacyState(
    documentId: string,
    yjsState: Uint8Array,
  ): Promise<boolean> {
    if (yjsState.byteLength > maximumYjsStateBytes) {
      throw new ApiError(
        413,
        'VALIDATION_ERROR',
        'The collaborative document state is too large.',
      );
    }
    const converted = await this.prisma.collaborationState.updateMany({
      where: { documentId, stateFormat: 'LEGACY_TEXT_V1' },
      data: {
        generation: { increment: 1 },
        stateFormat: 'MILKDOWN_XML_V1',
        yjsState: Buffer.from(yjsState),
      },
    });
    return converted.count === 1;
  }

  public async getCheckpointRevisionId(documentId: string): Promise<string> {
    const state = await this.prisma.collaborationState.findUnique({
      where: { documentId },
      select: { checkpointRevisionId: true },
    });
    if (state === null) {
      throw new ApiError(404, 'RESOURCE_NOT_FOUND', 'Document not found.');
    }
    return state.checkpointRevisionId;
  }
}

function toStoredStateFormat(
  format: CollaborationStateFormat,
): 'LEGACY_TEXT_V1' | 'MILKDOWN_XML_V1' {
  return format === 'legacy-text-v1' ? 'LEGACY_TEXT_V1' : 'MILKDOWN_XML_V1';
}

function fromStoredStateFormat(
  format: 'LEGACY_TEXT_V1' | 'MILKDOWN_XML_V1',
): CollaborationStateFormat {
  return format === 'LEGACY_TEXT_V1' ? 'legacy-text-v1' : 'milkdown-xml-v1';
}

function protocolMismatch(stateFormat: CollaborationStateFormat): ApiError {
  return new ApiError(
    409,
    'COLLABORATION_PROTOCOL_MISMATCH',
    'The collaboration room requires a different editor version.',
    { stateFormat },
  );
}

function authenticationRequired(): ApiError {
  return new ApiError(
    401,
    'AUTHENTICATION_REQUIRED',
    'The collaboration ticket is invalid or expired.',
  );
}
