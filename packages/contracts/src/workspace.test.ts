import { describe, expect, it } from 'vitest';

import {
  blackboardCollectionSchema,
  collaborationTicketRequestSchema,
  collaborationTicketResponseSchema,
  createDocumentRequestSchema,
  createFolderRequestSchema,
  documentContentResponseSchema,
  collaboratorListResponseSchema,
  publicDocumentRequestSchema,
  publicDocumentResponseSchema,
  publicLinkCreateResponseSchema,
  restoreRevisionRequestSchema,
  revisionContentResponseSchema,
  revisionListResponseSchema,
  saveDocumentRequestSchema,
  saveDocumentResponseSchema,
  updateFolderRequestSchema,
  shareDocumentRequestSchema,
  sharedDocumentListResponseSchema,
  workspaceTreeResponseSchema,
} from './index.js';

describe('workspace contracts', () => {
  it('negotiates a versioned collaboration editor protocol', () => {
    expect(
      collaborationTicketRequestSchema.parse({
        editorProtocol: 'legacy-text-v1',
      }),
    ).toEqual({ editorProtocol: 'legacy-text-v1' });
    expect(() =>
      collaborationTicketRequestSchema.parse({
        editorProtocol: 'unknown-v2',
      }),
    ).toThrow();
    expect(
      collaborationTicketResponseSchema.parse({
        ticket: 'a'.repeat(43),
        documentId: 'cm1234567890documentabcde',
        permission: 'editor',
        stateFormat: 'milkdown-xml-v1',
        websocketUrl: 'ws://127.0.0.1:3001',
        expiresAt: '2026-07-29T00:00:00.000Z',
      }).stateFormat,
    ).toBe('milkdown-xml-v1');
    expect(
      collaborationTicketRequestSchema.parse({
        editorProtocol: 'milkdown-blackboards-v1',
      }).editorProtocol,
    ).toBe('milkdown-blackboards-v1');
  });

  it('accepts bounded folder and document creation requests', () => {
    expect(
      createFolderRequestSchema.parse({ name: 'Projects', parentId: null }),
    ).toEqual({ name: 'Projects', parentId: null });
    expect(
      createDocumentRequestSchema.parse({
        name: 'Readme.md',
        folderId: 'cm1234567890abcdefghijklm',
      }),
    ).toEqual({
      name: 'Readme.md',
      folderId: 'cm1234567890abcdefghijklm',
    });
  });

  it('rejects blank names, path separators, and unknown fields', () => {
    for (const name of ['', '   ', '../secret', 'notes\\private']) {
      expect(() =>
        createFolderRequestSchema.parse({ name, parentId: null }),
      ).toThrow();
    }
    expect(() =>
      createDocumentRequestSchema.parse({
        name: 'Notes.md',
        folderId: null,
        content: 'not accepted here',
      }),
    ).toThrow();
  });

  it('requires at least one folder update field', () => {
    expect(() => updateFolderRequestSchema.parse({})).toThrow();
    expect(updateFolderRequestSchema.parse({ parentId: null })).toEqual({
      parentId: null,
    });
  });

  it('validates a flat owned tree with revision metadata', () => {
    const result = workspaceTreeResponseSchema.parse({
      folders: [
        {
          id: 'cm1234567890folderabcdefgh',
          parentId: null,
          name: 'Projects',
          createdAt: '2026-07-28T00:00:00.000Z',
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
      ],
      documents: [
        {
          id: 'cm1234567890documentabcdef',
          folderId: 'cm1234567890folderabcdefgh',
          name: 'Readme.md',
          currentRevision: {
            id: 'cm1234567890revisionabcdef',
            ordinal: 1,
            createdAt: '2026-07-28T00:00:00.000Z',
          },
          createdAt: '2026-07-28T00:00:00.000Z',
          updatedAt: '2026-07-28T00:00:00.000Z',
        },
      ],
    });

    expect(result.documents[0]?.currentRevision.ordinal).toBe(1);
  });

  it('validates document content reads and explicit saves', () => {
    const currentRevision = {
      id: 'cm1234567890revisionabcdef',
      ordinal: 2,
      createdAt: '2026-07-28T00:00:00.000Z',
    };
    expect(
      saveDocumentRequestSchema.parse({
        baseRevisionId: 'cm1234567890revisionabcdef',
        content: '# Updated\n',
        saveMessage: 'Clarify heading',
      }),
    ).toEqual({
      baseRevisionId: 'cm1234567890revisionabcdef',
      content: '# Updated\n',
      saveMessage: 'Clarify heading',
    });
    expect(
      documentContentResponseSchema.parse({
        id: 'cm1234567890documentabcdef',
        folderId: null,
        name: 'Readme.md',
        permission: 'owner',
        content: '# Updated\n',
        currentRevision,
        createdAt: '2026-07-28T00:00:00.000Z',
        updatedAt: '2026-07-28T00:00:00.000Z',
      }).content,
    ).toBe('# Updated\n');
    expect(
      saveDocumentResponseSchema.parse({
        documentId: 'cm1234567890documentabcdef',
        currentRevision,
      }).currentRevision.ordinal,
    ).toBe(2);
  });

  it('rejects invalid or oversized explicit saves', () => {
    expect(() =>
      saveDocumentRequestSchema.parse({
        baseRevisionId: 'short',
        content: '# Draft',
      }),
    ).toThrow();
    expect(() =>
      saveDocumentRequestSchema.parse({
        baseRevisionId: 'cm1234567890revisionabcdef',
        content: 'a'.repeat(2 * 1024 * 1024 + 1),
      }),
    ).toThrow();
  });

  it('validates direct collaborator grants and shared document responses', () => {
    expect(
      shareDocumentRequestSchema.parse({
        email: 'collaborator@example.test',
        role: 'editor',
      }),
    ).toEqual({ email: 'collaborator@example.test', role: 'editor' });
    expect(
      collaboratorListResponseSchema.parse({
        collaborators: [
          {
            userId: 'cm1234567890userabcdefgh',
            email: 'collaborator@example.test',
            role: 'viewer',
            createdAt: '2026-07-28T00:00:00.000Z',
            updatedAt: '2026-07-28T00:00:00.000Z',
          },
        ],
      }).collaborators[0]?.role,
    ).toBe('viewer');
    expect(
      sharedDocumentListResponseSchema.parse({
        documents: [
          {
            id: 'cm1234567890documentabcdef',
            folderId: null,
            name: 'Shared.md',
            permission: 'editor',
            currentRevision: {
              id: 'cm1234567890revisionabcdef',
              ordinal: 1,
              createdAt: '2026-07-28T00:00:00.000Z',
            },
            createdAt: '2026-07-28T00:00:00.000Z',
            updatedAt: '2026-07-28T00:00:00.000Z',
          },
        ],
      }).documents[0]?.permission,
    ).toBe('editor');
  });

  it('rejects invalid direct collaborator grants', () => {
    expect(() =>
      shareDocumentRequestSchema.parse({ email: 'not-email', role: 'editor' }),
    ).toThrow();
    expect(() =>
      shareDocumentRequestSchema.parse({
        email: 'owner@example.test',
        role: 'owner',
      }),
    ).toThrow();
    expect(() =>
      shareDocumentRequestSchema.parse({
        email: 'viewer@example.test',
        role: 'viewer',
        documentId: 'not-accepted',
      }),
    ).toThrow();
  });

  it('validates immutable history and restore contracts', () => {
    const revision = {
      id: 'cm1234567890revisionabcdef',
      ordinal: 3,
      author: {
        id: 'cm1234567890userabcdefgh',
        email: 'author@example.test',
      },
      byteSize: 12,
      saveMessage: 'Clarify title',
      restoredFromRevisionId: null,
      createdAt: '2026-07-28T00:00:00.000Z',
    };
    expect(
      revisionListResponseSchema.parse({ revisions: [revision] }).revisions[0]
        ?.ordinal,
    ).toBe(3);
    expect(
      revisionContentResponseSchema.parse({
        ...revision,
        content: '# Updated\n',
        blackboards: [],
      }).content,
    ).toBe('# Updated\n');
    expect(
      restoreRevisionRequestSchema.parse({
        baseRevisionId: 'cm1234567890revisioncurrent',
        saveMessage: 'Restore stable version',
      }),
    ).toEqual({
      baseRevisionId: 'cm1234567890revisioncurrent',
      saveMessage: 'Restore stable version',
    });
  });

  it('validates bounded blackboard snapshots with immutable Markdown copies', () => {
    const result = blackboardCollectionSchema.parse([
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Lecture notes',
        order: 0,
        backgroundMarkdown: '# Topic\n',
        backgroundHash:
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        strokes: [
          {
            id: '22222222-2222-4222-8222-222222222222',
            tool: 'pen',
            color: '#112233',
            width: 4,
            points: [{ x: 10, y: 20, pressure: 0.5 }],
          },
        ],
      },
    ]);
    expect(result[0]?.name).toBe('Lecture notes');
    expect(() =>
      blackboardCollectionSchema.parse([
        result[0],
        { ...result[0], id: '33333333-3333-4333-8333-333333333333' },
      ]),
    ).toThrow();
  });

  it('validates public-link tokens and read-only document responses', () => {
    const token = 'a'.repeat(43);
    expect(publicDocumentRequestSchema.parse({ token })).toEqual({ token });
    expect(
      publicLinkCreateResponseSchema.parse({
        token,
        createdAt: '2026-07-28T00:00:00.000Z',
      }).token,
    ).toBe(token);
    expect(
      publicDocumentResponseSchema.parse({
        name: 'Published.md',
        content: '# Public\n',
        currentRevision: {
          id: 'cm1234567890revisionabcdef',
          ordinal: 2,
          createdAt: '2026-07-28T00:00:00.000Z',
        },
      }).content,
    ).toBe('# Public\n');
    expect(() =>
      publicDocumentRequestSchema.parse({ token: 'short' }),
    ).toThrow();
  });
});
