import {
  authResponseSchema,
  collaborationCheckpointResponseSchema,
  collaborationTicketResponseSchema,
  documentContentResponseSchema,
  documentSummarySchema,
  errorResponseSchema,
  folderSchema,
  saveDocumentResponseSchema,
  trashResponseSchema,
  workspaceTreeResponseSchema,
  type AuthResponse,
  type CollaborationCheckpointResponse,
  type CollaborationTicketResponse,
  type CreateDocumentRequest,
  type CreateFolderRequest,
  type DocumentSummaryDto,
  type DocumentContentResponse,
  type FolderDto,
  type LoginRequest,
  type RegisterRequest,
  type SaveDocumentRequest,
  type SaveDocumentResponse,
  type TrashResponse,
  type UpdateDocumentRequest,
  type UpdateFolderRequest,
  type WorkspaceTreeResponse,
} from '@mymd/contracts';

export class ApiClientError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    public readonly requestId: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;
let currentUserRequest: Promise<AuthResponse | null> | null = null;

export async function loadCurrentUser(): Promise<AuthResponse | null> {
  currentUserRequest ??= requestCurrentUser();
  return currentUserRequest;
}

async function requestCurrentUser(): Promise<AuthResponse | null> {
  const response = await fetch('/api/v1/auth/me', { credentials: 'include' });
  if (response.status === 401) return null;
  const data = await parseResponse(response, (value) =>
    authResponseSchema.parse(value),
  );
  csrfToken = data.csrfToken;
  return data;
}

export async function registerAccount(
  input: RegisterRequest,
): Promise<AuthResponse> {
  const data = await requestAuth('/api/v1/auth/register', input);
  csrfToken = data.csrfToken;
  currentUserRequest = Promise.resolve(data);
  return data;
}

export async function login(input: LoginRequest): Promise<AuthResponse> {
  const data = await requestAuth('/api/v1/auth/login', input);
  csrfToken = data.csrfToken;
  currentUserRequest = Promise.resolve(data);
  return data;
}

export async function logout(): Promise<void> {
  const response = await fetch('/api/v1/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : {},
  });
  if (!response.ok) await throwApiError(response);
  csrfToken = null;
  currentUserRequest = Promise.resolve(null);
}

export async function loadWorkspaceTree(): Promise<WorkspaceTreeResponse> {
  return requestJson('/api/v1/workspace/tree', undefined, (value) =>
    workspaceTreeResponseSchema.parse(value),
  );
}

export async function loadTrash(): Promise<TrashResponse> {
  return requestJson('/api/v1/trash', undefined, (value) =>
    trashResponseSchema.parse(value),
  );
}

export async function createFolder(
  input: CreateFolderRequest,
): Promise<FolderDto> {
  return requestJson('/api/v1/folders', mutation('POST', input), (value) =>
    folderSchema.parse(value),
  );
}

export async function updateFolder(
  folderId: string,
  input: UpdateFolderRequest,
): Promise<FolderDto> {
  return requestJson(
    `/api/v1/folders/${folderId}`,
    mutation('PATCH', input),
    (value) => folderSchema.parse(value),
  );
}

export async function trashFolder(folderId: string): Promise<void> {
  return requestEmpty(`/api/v1/folders/${folderId}`, mutation('DELETE'));
}

export async function restoreFolder(folderId: string): Promise<FolderDto> {
  return requestJson(
    `/api/v1/folders/${folderId}/restore`,
    mutation('POST'),
    (value) => folderSchema.parse(value),
  );
}

export async function permanentlyDeleteFolder(folderId: string): Promise<void> {
  return requestEmpty(
    `/api/v1/folders/${folderId}/permanent`,
    mutation('DELETE', { confirmation: 'DELETE' }),
  );
}

export async function createDocument(
  input: CreateDocumentRequest,
): Promise<DocumentSummaryDto> {
  return requestJson('/api/v1/documents', mutation('POST', input), (value) =>
    documentSummarySchema.parse(value),
  );
}

export async function loadDocument(
  documentId: string,
): Promise<DocumentContentResponse> {
  return requestJson(`/api/v1/documents/${documentId}`, undefined, (value) =>
    documentContentResponseSchema.parse(value),
  );
}

export async function createCollaborationTicket(
  documentId: string,
): Promise<CollaborationTicketResponse> {
  return requestJson(
    `/api/v1/documents/${documentId}/collaboration-ticket`,
    mutation('POST'),
    (value) => collaborationTicketResponseSchema.parse(value),
  );
}

export async function checkpointCollaboration(
  documentId: string,
): Promise<CollaborationCheckpointResponse> {
  return requestJson(
    `/api/v1/documents/${documentId}/collaboration-checkpoint`,
    mutation('POST', {}),
    (value) => collaborationCheckpointResponseSchema.parse(value),
  );
}

export async function saveDocument(
  documentId: string,
  input: SaveDocumentRequest,
): Promise<SaveDocumentResponse> {
  return requestJson(
    `/api/v1/documents/${documentId}/content`,
    mutation('PUT', input),
    (value) => saveDocumentResponseSchema.parse(value),
  );
}

export async function updateDocument(
  documentId: string,
  input: UpdateDocumentRequest,
): Promise<DocumentSummaryDto> {
  return requestJson(
    `/api/v1/documents/${documentId}`,
    mutation('PATCH', input),
    (value) => documentSummarySchema.parse(value),
  );
}

export async function trashDocument(documentId: string): Promise<void> {
  return requestEmpty(`/api/v1/documents/${documentId}`, mutation('DELETE'));
}

export async function restoreDocument(
  documentId: string,
): Promise<DocumentSummaryDto> {
  return requestJson(
    `/api/v1/documents/${documentId}/restore`,
    mutation('POST'),
    (value) => documentSummarySchema.parse(value),
  );
}

export async function permanentlyDeleteDocument(
  documentId: string,
): Promise<void> {
  return requestEmpty(
    `/api/v1/documents/${documentId}/permanent`,
    mutation('DELETE', { confirmation: 'DELETE' }),
  );
}

async function requestAuth(
  url: string,
  input: LoginRequest | RegisterRequest,
): Promise<AuthResponse> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parseResponse(response, (value) => authResponseSchema.parse(value));
}

function mutation(method: string, input?: unknown): RequestInit {
  return {
    method,
    credentials: 'include',
    headers: {
      ...(input === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(csrfToken === null ? {} : { 'X-CSRF-Token': csrfToken }),
    },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  };
}

async function requestJson<T>(
  url: string,
  init: RequestInit | undefined,
  parse: (value: unknown) => T,
): Promise<T> {
  const response = await fetch(url, init ?? { credentials: 'include' });
  return parseResponse(response, parse);
}

async function requestEmpty(url: string, init: RequestInit): Promise<void> {
  const response = await fetch(url, init);
  if (!response.ok) await throwApiError(response);
}

async function parseResponse<T>(
  response: Response,
  parse: (value: unknown) => T,
): Promise<T> {
  if (!response.ok) await throwApiError(response);
  return parse(await response.json());
}

async function throwApiError(response: Response): Promise<never> {
  const parsed = errorResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new ApiClientError(
      'The server returned an unexpected response.',
      'UNEXPECTED_RESPONSE',
      'unknown',
    );
  }
  throw new ApiClientError(
    parsed.data.error.message,
    parsed.data.error.code,
    parsed.data.error.requestId,
    parsed.data.error.details,
  );
}
