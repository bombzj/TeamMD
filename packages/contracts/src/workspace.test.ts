import { describe, expect, it } from 'vitest';

import {
  createDocumentRequestSchema,
  createFolderRequestSchema,
  documentContentResponseSchema,
  saveDocumentRequestSchema,
  saveDocumentResponseSchema,
  updateFolderRequestSchema,
  workspaceTreeResponseSchema,
} from './index.js';

describe('workspace contracts', () => {
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
});
