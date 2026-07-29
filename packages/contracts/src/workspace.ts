import { z } from 'zod';

const resourceIdSchema = z.string().min(20).max(30);
const optionalParentIdSchema = resourceIdSchema.nullable();
const maximumMarkdownBytes = 2 * 1024 * 1024;
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

export const collaborationTicketResponseSchema = z
  .object({
    ticket: z.string().min(40).max(200),
    documentId: resourceIdSchema,
    permission: z.enum(['owner', 'editor', 'viewer']),
    websocketUrl: z.string().url(),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const collaborationCheckpointResponseSchema = saveDocumentResponseSchema
  .extend({
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const collaborationCheckpointEventSchema = revisionSummarySchema
  .extend({
    type: z.literal('checkpoint'),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
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
export type CollaborationTicketResponse = z.infer<
  typeof collaborationTicketResponseSchema
>;
export type CollaborationCheckpointEvent = z.infer<
  typeof collaborationCheckpointEventSchema
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
export type WorkspaceTreeResponse = z.infer<typeof workspaceTreeResponseSchema>;
export type TrashResponse = z.infer<typeof trashResponseSchema>;
