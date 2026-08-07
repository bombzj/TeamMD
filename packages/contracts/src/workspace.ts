import { z } from 'zod';

const resourceIdSchema = z.string().min(20).max(30);
const publicLinkTokenSchema = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]+$/);
const optionalParentIdSchema = resourceIdSchema.nullable();
const maximumMarkdownBytes = 2 * 1024 * 1024;
export const maximumBlackboardsPerDocument = 12;
export const maximumBlackboardStrokes = 500;
export const maximumBlackboardPointsPerStroke = 2_048;
const maximumBlackboardNameLength = 80;
const workspaceNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((name) => !name.includes('/') && !name.includes('\\'), {
    message: 'Names cannot contain path separators.',
  })
  .refine((name) => name !== '.' && name !== '..', {
    message: 'That name is reserved.',
  });

export const createFolderRequestSchema = z
  .object({
    name: workspaceNameSchema,
    parentId: optionalParentIdSchema,
  })
  .strict();

export const updateFolderRequestSchema = z
  .object({
    name: workspaceNameSchema.optional(),
    parentId: optionalParentIdSchema.optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.parentId !== undefined, {
    message: 'At least one field is required.',
  });

export const createDocumentRequestSchema = z
  .object({
    name: workspaceNameSchema,
    folderId: optionalParentIdSchema,
  })
  .strict();

export const updateDocumentRequestSchema = z
  .object({
    name: workspaceNameSchema.optional(),
    folderId: optionalParentIdSchema.optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.folderId !== undefined, {
    message: 'At least one field is required.',
  });

export const permanentDeleteRequestSchema = z
  .object({
    confirmation: z.literal('DELETE'),
  })
  .strict();

export const saveDocumentRequestSchema = z
  .object({
    baseRevisionId: resourceIdSchema,
    content: z
      .string()
      .refine(
        (value) =>
          new TextEncoder().encode(value).byteLength <= maximumMarkdownBytes,
        { message: 'Markdown content must not exceed 2 MiB.' },
      ),
    saveMessage: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const collaborativeCheckpointRequestSchema = z
  .object({
    saveMessage: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const folderSchema = z
  .object({
    id: resourceIdSchema,
    parentId: optionalParentIdSchema,
    name: workspaceNameSchema,
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const revisionSummarySchema = z
  .object({
    id: resourceIdSchema,
    ordinal: z.number().int().positive(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const revisionHistoryItemSchema = revisionSummarySchema
  .extend({
    author: z
      .object({ id: resourceIdSchema, email: z.email().max(320) })
      .strict(),
    byteSize: z.number().int().nonnegative(),
    saveMessage: z.string().max(500).nullable(),
    restoredFromRevisionId: resourceIdSchema.nullable(),
  })
  .strict();

export const revisionListResponseSchema = z
  .object({ revisions: z.array(revisionHistoryItemSchema).max(200) })
  .strict();

export const blackboardPointSchema = z
  .object({
    x: z.number().finite().min(0).max(100_000),
    y: z.number().finite().min(0).max(100_000),
    pressure: z.number().finite().min(0).max(1),
  })
  .strict();

export const blackboardStrokeSchema = z
  .object({
    id: z.uuid(),
    tool: z.enum(['pen', 'highlighter']),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    width: z.number().finite().min(1).max(32),
    points: z
      .array(blackboardPointSchema)
      .min(1)
      .max(maximumBlackboardPointsPerStroke),
  })
  .strict();

export const blackboardSnapshotSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(maximumBlackboardNameLength),
    order: z.number().int().nonnegative(),
    backgroundMarkdown: z
      .string()
      .refine(
        (value) =>
          new TextEncoder().encode(value).byteLength <= maximumMarkdownBytes,
        { message: 'Blackboard background must not exceed 2 MiB.' },
      ),
    backgroundHash: z.string().regex(/^[a-f0-9]{64}$/),
    strokes: z.array(blackboardStrokeSchema).max(maximumBlackboardStrokes),
  })
  .strict();

export const blackboardCollectionSchema = z
  .array(blackboardSnapshotSchema)
  .max(maximumBlackboardsPerDocument)
  .superRefine((blackboards, context) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const [index, blackboard] of blackboards.entries()) {
      const normalizedName = blackboard.name.trim().toLocaleLowerCase('en-US');
      if (ids.has(blackboard.id)) {
        context.addIssue({
          code: 'custom',
          message: 'Blackboard IDs must be unique.',
          path: [index, 'id'],
        });
      }
      if (names.has(normalizedName)) {
        context.addIssue({
          code: 'custom',
          message: 'Blackboard names must be unique.',
          path: [index, 'name'],
        });
      }
      ids.add(blackboard.id);
      names.add(normalizedName);
    }
  });

export const revisionContentResponseSchema = revisionHistoryItemSchema
  .extend({ content: z.string(), blackboards: blackboardCollectionSchema })
  .strict();

export const restoreRevisionRequestSchema = z
  .object({
    baseRevisionId: resourceIdSchema,
    saveMessage: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const documentSummarySchema = z
  .object({
    id: resourceIdSchema,
    folderId: optionalParentIdSchema,
    name: workspaceNameSchema,
    currentRevision: revisionSummarySchema,
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const documentContentResponseSchema = documentSummarySchema
  .extend({
    permission: z.enum(['owner', 'editor', 'viewer']),
    content: z.string(),
  })
  .strict();

export const saveDocumentResponseSchema = z
  .object({
    documentId: resourceIdSchema,
    currentRevision: revisionSummarySchema,
  })
  .strict();

export const collaborationEditorProtocolSchema = z.enum([
  'legacy-text-v1',
  'milkdown-xml-v1',
  'milkdown-blackboards-v1',
]);

export const collaborationStateFormatSchema = z.enum([
  'legacy-text-v1',
  'milkdown-xml-v1',
  'milkdown-blackboards-v1',
]);

export const collaborationTicketRequestSchema = z
  .object({ editorProtocol: collaborationEditorProtocolSchema })
  .strict();

export const collaborationTicketResponseSchema = z
  .object({
    ticket: z.string().min(40).max(200),
    documentId: resourceIdSchema,
    permission: z.enum(['owner', 'editor', 'viewer']),
    stateFormat: collaborationStateFormatSchema,
    websocketUrl: z.string().url(),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const collaborationCheckpointResponseSchema = saveDocumentResponseSchema
  .extend({
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    blackboardHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const collaborationCheckpointEventSchema = revisionSummarySchema
  .extend({
    type: z.literal('checkpoint'),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    blackboardHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const collaborationRestoreEventSchema = revisionSummarySchema
  .extend({
    type: z.literal('document-restored'),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    blackboardHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const collaboratorRoleSchema = z.enum(['editor', 'viewer']);

export const shareDocumentRequestSchema = z
  .object({
    email: z.email().max(320),
    role: collaboratorRoleSchema,
  })
  .strict();

export const updateCollaboratorRequestSchema = z
  .object({ role: collaboratorRoleSchema })
  .strict();

export const collaboratorSchema = z
  .object({
    userId: resourceIdSchema,
    email: z.email().max(320),
    role: collaboratorRoleSchema,
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const collaboratorListResponseSchema = z
  .object({ collaborators: z.array(collaboratorSchema).max(100) })
  .strict();

export const sharedDocumentSummarySchema = documentSummarySchema
  .extend({ permission: collaboratorRoleSchema })
  .strict();

export const sharedDocumentListResponseSchema = z
  .object({ documents: z.array(sharedDocumentSummarySchema).max(1_000) })
  .strict();

export const publicLinkStatusSchema = z
  .object({ enabled: z.boolean(), createdAt: z.iso.datetime().nullable() })
  .strict();

export const publicLinkCreateResponseSchema = z
  .object({ token: publicLinkTokenSchema, createdAt: z.iso.datetime() })
  .strict();

export const publicDocumentRequestSchema = z
  .object({ token: publicLinkTokenSchema })
  .strict();

export const publicDocumentResponseSchema = z
  .object({
    name: workspaceNameSchema,
    content: z.string(),
    currentRevision: revisionSummarySchema,
  })
  .strict();

export const workspaceTreeResponseSchema = z
  .object({
    folders: z.array(folderSchema),
    documents: z.array(documentSummarySchema),
  })
  .strict();

export const trashItemSchema = z.discriminatedUnion('type', [
  folderSchema.extend({
    type: z.literal('folder'),
    trashedAt: z.iso.datetime({ offset: true }),
  }),
  documentSummarySchema.extend({
    type: z.literal('document'),
    trashedAt: z.iso.datetime({ offset: true }),
  }),
]);

export const trashResponseSchema = z
  .object({
    items: z.array(trashItemSchema),
  })
  .strict();

export type CreateFolderRequest = z.infer<typeof createFolderRequestSchema>;
export type UpdateFolderRequest = z.infer<typeof updateFolderRequestSchema>;
export type CreateDocumentRequest = z.infer<typeof createDocumentRequestSchema>;
export type UpdateDocumentRequest = z.infer<typeof updateDocumentRequestSchema>;
export type SaveDocumentRequest = z.infer<typeof saveDocumentRequestSchema>;
export type CollaborativeCheckpointRequest = z.infer<
  typeof collaborativeCheckpointRequestSchema
>;
export type FolderDto = z.infer<typeof folderSchema>;
export type DocumentSummaryDto = z.infer<typeof documentSummarySchema>;
export type DocumentContentResponse = z.infer<
  typeof documentContentResponseSchema
>;
export type SaveDocumentResponse = z.infer<typeof saveDocumentResponseSchema>;
export type RevisionHistoryItem = z.infer<typeof revisionHistoryItemSchema>;
export type RevisionListResponse = z.infer<typeof revisionListResponseSchema>;
export type RevisionContentResponse = z.infer<
  typeof revisionContentResponseSchema
>;
export type BlackboardSnapshot = z.infer<typeof blackboardSnapshotSchema>;
export type BlackboardStroke = z.infer<typeof blackboardStrokeSchema>;
export type BlackboardPoint = z.infer<typeof blackboardPointSchema>;
export type RestoreRevisionRequest = z.infer<
  typeof restoreRevisionRequestSchema
>;
export type CollaborationEditorProtocol = z.infer<
  typeof collaborationEditorProtocolSchema
>;
export type CollaborationStateFormat = z.infer<
  typeof collaborationStateFormatSchema
>;
export type CollaborationTicketRequest = z.infer<
  typeof collaborationTicketRequestSchema
>;
export type CollaborationTicketResponse = z.infer<
  typeof collaborationTicketResponseSchema
>;
export type CollaborationCheckpointEvent = z.infer<
  typeof collaborationCheckpointEventSchema
>;
export type CollaborationRestoreEvent = z.infer<
  typeof collaborationRestoreEventSchema
>;
export type CollaborationCheckpointResponse = z.infer<
  typeof collaborationCheckpointResponseSchema
>;
export type CollaboratorRole = z.infer<typeof collaboratorRoleSchema>;
export type ShareDocumentRequest = z.infer<typeof shareDocumentRequestSchema>;
export type UpdateCollaboratorRequest = z.infer<
  typeof updateCollaboratorRequestSchema
>;
export type CollaboratorDto = z.infer<typeof collaboratorSchema>;
export type CollaboratorListResponse = z.infer<
  typeof collaboratorListResponseSchema
>;
export type SharedDocumentSummary = z.infer<typeof sharedDocumentSummarySchema>;
export type SharedDocumentListResponse = z.infer<
  typeof sharedDocumentListResponseSchema
>;
export type PublicLinkStatus = z.infer<typeof publicLinkStatusSchema>;
export type PublicLinkCreateResponse = z.infer<
  typeof publicLinkCreateResponseSchema
>;
export type PublicDocumentRequest = z.infer<typeof publicDocumentRequestSchema>;
export type PublicDocumentResponse = z.infer<
  typeof publicDocumentResponseSchema
>;
export type WorkspaceTreeResponse = z.infer<typeof workspaceTreeResponseSchema>;
export type TrashResponse = z.infer<typeof trashResponseSchema>;
