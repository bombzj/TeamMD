# API Contract

All endpoints are under `/api/v1`, use JSON, and validate request and response payloads with schemas from `packages/contracts`. Times are ISO 8601 UTC strings. IDs are opaque strings. Unknown fields are rejected for mutation bodies.

## Conventions

- Session cookie: `__Host-teammd_session` in production, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, no `Domain`.
- State-changing requests require an `X-CSRF-Token` header tied to the session and an allowed `Origin`.
- List endpoints use cursor pagination: `{ "items": [], "nextCursor": null }`.
- `requestId` is returned in every error and response header.
- Retry-prone mutations may gain explicit idempotency keys when pending-email invitations or external delivery are introduced.

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

Stable current codes include `VALIDATION_ERROR`, `AUTHENTICATION_REQUIRED`, `INVALID_CREDENTIALS`, `CSRF_INVALID`, `FORBIDDEN`, `RESOURCE_NOT_FOUND`, `NAME_CONFLICT`, `REVISION_CONFLICT`, `RATE_LIMITED`, and `INTERNAL_ERROR`. Invitation-specific codes are added with the pending-email invitation API.

## Authentication

| Method   | Path                        | Purpose                                         |
| -------- | --------------------------- | ----------------------------------------------- |
| `POST`   | `/auth/register`            | Create user and session                         |
| `POST`   | `/auth/login`               | Authenticate and rotate session                 |
| `POST`   | `/auth/password`            | Change password and rotate all sessions         |
| `POST`   | `/auth/logout`              | Revoke current session                          |
| `POST`   | `/auth/logout-all`          | Increment session epoch and revoke all sessions |
| `GET`    | `/auth/me`                  | Return current user and CSRF bootstrap metadata |
| `GET`    | `/auth/sessions`            | List active sessions                            |
| `DELETE` | `/auth/sessions/:sessionId` | Revoke one owned session                        |

Registration body: `{ "email": "user@example.com", "password": "..." }`. Password change body: `{ "currentPassword": "...", "newPassword": "..." }`; both values are 12 to 128 characters and must differ. The route requires an active session, matching CSRF token, allowed origin, and current-password verification. Success atomically updates the versioned scrypt hash, increments the session epoch, revokes all old sessions, creates one replacement session, and returns the standard user/CSRF bootstrap response with fresh cookies. Responses never include password hashes or session tokens. Login failures use one generic status/message.

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
        "createdAt": "2026-07-27T12:00:00.000Z"
      }
    },
    "requestId": "req_opaque"
  }
}
```

The conflict response omits content to keep response size and accidental exposure bounded. The authorized client may fetch the current document and present reload, copy-local-content, and compare workflows. A force-save flag is not provided in MVP.

Restore requires the caller's current `baseRevisionId` as well as the historical path revision, preventing a restore from racing with a newer save.

History lists at most 200 revisions newest-first in the current release. Each item includes revision ID, ordinal, timestamp, author ID/email, UTF-8 byte size, optional save message, and optional restore lineage. Historical content is returned only by the individual revision endpoint and only to owners/editors. A restore returns the same checkpoint response shape as collaborative Save, resets the Yjs room generation, and forces connected clients to rebuild from the new authoritative head.

Collaboration ticket creation requires the authenticated session, CSRF token, allowed origin, and an editor protocol identifier. During migration, supported protocols are `legacy-text-v1` and `milkdown-xml-v1`. The response contains a random one-time token, WebSocket URL, document ID, current permission, negotiated state format, and expiry. Tickets expire after one minute, are bound to one document, session, and negotiated format, and are consumed atomically during WebSocket authentication. A client incompatible with the room format receives a stable upgrade-required error and is never allowed to create a second writable Yjs root. The raw ticket is never stored or logged.

## Sharing Registered Accounts

| Method   | Path                                           | Purpose                          |
| -------- | ---------------------------------------------- | -------------------------------- |
| `GET`    | `/shared-with-me`                              | List active document grants      |
| `GET`    | `/documents/:documentId/collaborators`         | Owner lists active grants        |
| `POST`   | `/documents/:documentId/collaborators`         | Owner grants an existing account |
| `PATCH`  | `/documents/:documentId/collaborators/:userId` | Owner changes role               |
| `DELETE` | `/documents/:documentId/collaborators/:userId` | Owner revokes access             |

Grant body: `{ "email": "collaborator@example.com", "role": "editor" }`. The target must already have an active TeamMD account. Sharing does not return owner folder metadata. Grant, role-change, and revoke routes are owner-only, audited, and invalidate active collaboration-room connections so reconnects must pass current authorization.

Tokenized pending-email invitations, acceptance/decline routes, and email delivery are planned extensions and are not part of the current API.

## Public Read-Only Links

| Method   | Path                                 | Purpose                                     |
| -------- | ------------------------------------ | ------------------------------------------- |
| `GET`    | `/documents/:documentId/public-link` | Owner reads enabled state and creation time |
| `POST`   | `/documents/:documentId/public-link` | Owner creates or rotates the bearer link    |
| `DELETE` | `/documents/:documentId/public-link` | Owner revokes the current bearer link       |
| `POST`   | `/public/documents/resolve`          | Anonymous browser resolves one bearer token |

Management routes require owner authorization; create/delete also require CSRF and an allowed origin. Creation returns the raw 43-character URL-safe token once with `createdAt`. Status never returns an existing raw token. Creating again rotates the token and immediately invalidates the previous value.

The web client places the raw token in `/public#token=...`. URL fragments are not sent in HTTP requests or referrers. The public page reads the fragment, removes it from the address bar, and sends `{ "token": "..." }` to the fixed resolver endpoint. The resolver is rate-limited, sends `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`, and returns only:

```json
{
  "name": "Published notes.md",
  "content": "# Current saved Markdown\n",
  "currentRevision": {
    "id": "rev_12",
    "ordinal": 12,
    "createdAt": "2026-07-29T01:42:28.684Z"
  }
}
```

The response never includes unsaved collaborative state, history, owner identity, collaborators, or folder metadata. Invalid, revoked, trashed, or hidden-ancestor links all return the same `404 RESOURCE_NOT_FOUND` behavior.

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
