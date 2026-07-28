# API Contract

All endpoints are under `/api/v1`, use JSON, and validate request and response payloads with schemas from `packages/contracts`. Times are ISO 8601 UTC strings. IDs are opaque strings. Unknown fields are rejected for mutation bodies.

## Conventions

- Session cookie: `__Host-mymd_session` in production, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`.
- State-changing requests require an `X-CSRF-Token` header tied to the session and an allowed `Origin`.
- List endpoints use cursor pagination: `{ "items": [], "nextCursor": null }`.
- `requestId` is returned in every error and response header.
- `Idempotency-Key` is required for invitation creation and may be introduced for other retry-prone mutations.

Error envelope:

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "The document has a newer revision.",
    "details": {},
    "requestId": "req_opaque"
  }
}
```

Stable initial codes include `VALIDATION_ERROR`, `AUTHENTICATION_REQUIRED`, `INVALID_CREDENTIALS`, `CSRF_INVALID`, `FORBIDDEN`, `RESOURCE_NOT_FOUND`, `NAME_CONFLICT`, `REVISION_CONFLICT`, `INVITATION_INVALID`, `INVITATION_EXPIRED`, `RATE_LIMITED`, and `INTERNAL_ERROR`.

## Authentication

| Method   | Path                        | Purpose                                         |
| -------- | --------------------------- | ----------------------------------------------- |
| `POST`   | `/auth/register`            | Create user and session                         |
| `POST`   | `/auth/login`               | Authenticate and rotate session                 |
| `POST`   | `/auth/logout`              | Revoke current session                          |
| `POST`   | `/auth/logout-all`          | Increment session epoch and revoke all sessions |
| `GET`    | `/auth/me`                  | Return current user and CSRF bootstrap metadata |
| `GET`    | `/auth/sessions`            | List active sessions                            |
| `DELETE` | `/auth/sessions/:sessionId` | Revoke one owned session                        |

Registration body: `{ "email": "user@example.com", "password": "..." }`. Responses never include password hashes or session tokens. Login failures use one generic status/message.

## Folders

| Method   | Path                           | Purpose                                                   |
| -------- | ------------------------------ | --------------------------------------------------------- |
| `GET`    | `/workspace/tree`              | Fetch owned active hierarchy, optionally rooted at folder |
| `POST`   | `/folders`                     | Create folder                                             |
| `PATCH`  | `/folders/:folderId`           | Rename or move folder                                     |
| `DELETE` | `/folders/:folderId`           | Move folder subtree to trash                              |
| `POST`   | `/folders/:folderId/restore`   | Restore subtree                                           |
| `DELETE` | `/folders/:folderId/permanent` | Permanently delete after confirmation                     |

Create body: `{ "name": "Notes", "parentId": null }`. Patch body accepts at least one of `name` or `parentId`; moving beneath a descendant is rejected.

Permanent folder and document deletion requires the JSON body `{ "confirmation": "DELETE" }`. The resource must already be in trash; active content cannot be permanently deleted directly.

## Documents And Revisions

| Method   | Path                                                   | Purpose                                       |
| -------- | ------------------------------------------------------ | --------------------------------------------- |
| `POST`   | `/documents`                                           | Create document with initial empty revision   |
| `GET`    | `/documents/:documentId`                               | Get metadata, permission, and current content |
| `PATCH`  | `/documents/:documentId`                               | Owner renames or moves document               |
| `PUT`    | `/documents/:documentId/content`                       | Legacy non-collaborative immutable save       |
| `DELETE` | `/documents/:documentId`                               | Owner moves document to trash                 |
| `POST`   | `/documents/:documentId/restore`                       | Owner restores document                       |
| `DELETE` | `/documents/:documentId/permanent`                     | Owner permanently deletes after confirmation  |
| `GET`    | `/documents/:documentId/revisions`                     | List authorized revision metadata             |
| `GET`    | `/documents/:documentId/revisions/:revisionId`         | Get authorized historical content             |
| `POST`   | `/documents/:documentId/revisions/:revisionId/restore` | Create new head from historical content       |
| `POST`   | `/documents/:documentId/collaboration-ticket`          | Issue a one-time room ticket                  |
| `POST`   | `/documents/:documentId/collaboration-checkpoint`      | Save the authoritative room as a new revision |

Save request:

```json
{
  "baseRevisionId": "rev_7",
  "content": "# Updated Markdown\n",
  "saveMessage": "Clarify introduction"
}
```

Successful save returns `200` with document ID and new revision metadata. A stale save returns `409 REVISION_CONFLICT`:

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "The document has a newer revision.",
    "details": {
      "submittedBaseRevisionId": "rev_7",
      "currentRevision": {
        "id": "rev_8",
        "ordinal": 8,
        "createdAt": "2026-07-27T12:00:00.000Z",
        "author": { "id": "user_a", "displayName": "Alice" }
      }
    },
    "requestId": "req_opaque"
  }
}
```

The conflict response omits content to keep response size and accidental exposure bounded. The authorized client may fetch the current document and present reload, copy-local-content, and compare workflows. A force-save flag is not provided in MVP.

Restore requires the caller's current `baseRevisionId` as well as the historical path revision, preventing a restore from racing with a newer save.

Collaboration ticket creation requires the authenticated session, CSRF token, and allowed origin. The response contains a random one-time token, WebSocket URL, document ID, current permission, and expiry. Tickets expire after one minute, are bound to one document and session, and are consumed atomically during WebSocket authentication. The raw ticket is never stored or logged.

## Sharing And Invitations

| Method   | Path                                               | Purpose                                    |
| -------- | -------------------------------------------------- | ------------------------------------------ |
| `GET`    | `/shared-with-me`                                  | List active document grants                |
| `GET`    | `/documents/:documentId/collaborators`             | Owner lists grants and pending invitations |
| `POST`   | `/documents/:documentId/invitations`               | Owner invites email as editor/viewer       |
| `DELETE` | `/documents/:documentId/invitations/:invitationId` | Owner revokes pending invitation           |
| `POST`   | `/invitations/accept`                              | Authenticated target accepts raw token     |
| `POST`   | `/invitations/decline`                             | Authenticated target declines raw token    |
| `PATCH`  | `/documents/:documentId/collaborators/:userId`     | Owner changes role                         |
| `DELETE` | `/documents/:documentId/collaborators/:userId`     | Owner revokes access                       |

Invitation body: `{ "email": "collaborator@example.com", "role": "editor" }`. Accept body: `{ "token": "raw-token-from-link" }`. The API never returns token hashes. Invitation lookup and acceptance use constant-time comparisons where applicable and generic invalid/expired responses.

## Trash And Health

| Method | Path            | Purpose                                               |
| ------ | --------------- | ----------------------------------------------------- |
| `GET`  | `/trash`        | List owned trashed roots/items with cursor pagination |
| `GET`  | `/health/live`  | Process liveness                                      |
| `GET`  | `/health/ready` | Dependency readiness without secret details           |

## Status Rules

- `200`: successful read/update
- `201`: resource created
- `204`: successful logout/delete with no body
- `400`: malformed or semantically invalid input
- `401`: no valid session or generic credential failure
- `403`: authenticated action that may safely reveal denial; private-resource checks usually use `404`
- `404`: absent or not visible resource
- `409`: name, state, or revision conflict
- `413`: request/document size limit exceeded
- `429`: rate limit exceeded with `Retry-After`

Contracts must specify maximum string lengths, collection counts, valid enums, and pagination bounds. Route tests verify both successful and rejected response bodies against shared schemas.
