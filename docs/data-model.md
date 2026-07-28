# Data Model

MySQL 8.4 with `InnoDB` and `utf8mb4` is the system of record. Prisma schema and reviewed migrations will implement this logical model. IDs are opaque UUIDs or CUID2 values; APIs never expose sequential database keys.

## Relationship Overview

```mermaid
erDiagram
  User ||--o{ Session : has
  User ||--o{ Folder : owns
  User ||--o{ Document : owns
  Folder ||--o{ Folder : contains
  Folder ||--o{ Document : contains
  Document ||--|{ DocumentRevision : versions
  User ||--o{ DocumentRevision : authors
  Document ||--o{ DocumentAccess : grants
  User ||--o{ DocumentAccess : receives
  Document ||--o{ Invitation : invites
  User ||--o{ Invitation : sends
  Document ||--o{ AuditEvent : records
```

## Entities

### `User`

| Field                                  | Notes                                            |
| -------------------------------------- | ------------------------------------------------ |
| `id`                                   | Opaque primary key                               |
| `email`                                | Display form, never used directly for uniqueness |
| `normalizedEmail`                      | Lowercased, trimmed identity key; unique         |
| `passwordHash`                         | Argon2id encoded hash                            |
| `emailVerifiedAt`                      | Nullable until verification is implemented       |
| `sessionEpoch`                         | Increment to invalidate all sessions             |
| `createdAt`, `updatedAt`, `disabledAt` | UTC timestamps                                   |

### `Session`

| Field                                               | Notes                                                             |
| --------------------------------------------------- | ----------------------------------------------------------------- |
| `id`, `userId`                                      | Identity and owner                                                |
| `tokenHash`                                         | SHA-256 or keyed hash of 256-bit random token; unique             |
| `sessionEpoch`                                      | Must equal the user's current epoch                               |
| `expiresAt`, `lastSeenAt`, `revokedAt`, `createdAt` | Lifecycle                                                         |
| `userAgentSummary`, `ipPrefixHash`                  | Optional bounded security metadata, never raw fingerprinting data |

Indexes: unique `tokenHash`; `(userId, revokedAt, expiresAt)` for session management and cleanup.

### `Folder`

| Field                                 | Notes                                              |
| ------------------------------------- | -------------------------------------------------- |
| `id`, `ownerId`                       | Identity and owner                                 |
| `parentId`                            | Nullable self-reference; parent has the same owner |
| `name`, `normalizedName`              | Display and case-insensitive comparison values     |
| `createdAt`, `updatedAt`, `trashedAt` | Lifecycle                                          |

Constraint: unique `(ownerId, parentId, normalizedName)` for active siblings. Because MySQL unique indexes permit multiple `NULL` values and soft-deleted rows complicate uniqueness, implementation must use a deterministic parent sentinel/materialized scope key or an active-name reservation table. This must be proven by integration tests rather than assumed from Prisma declarations.

Cycle prevention and maximum depth are domain-service checks inside a transaction. A maximum depth of 20 is proposed.

### `Document`

| Field                                 | Notes                                                             |
| ------------------------------------- | ----------------------------------------------------------------- |
| `id`, `ownerId`                       | Identity and exactly one owner                                    |
| `folderId`                            | Nullable root location; folder belongs to owner                   |
| `name`, `normalizedName`              | Include `.md` consistently according to the final naming decision |
| `currentRevisionId`                   | Non-null after creation; references this document's head          |
| `createdAt`, `updatedAt`, `trashedAt` | Lifecycle                                                         |

Document name uniqueness follows the same active sibling strategy as folders. Folder and document namespaces may be independent in MVP; the UI should make type clear.

### `DocumentRevision`

| Field                     | Notes                                                           |
| ------------------------- | --------------------------------------------------------------- |
| `id`, `documentId`        | Identity and document                                           |
| `ordinal`                 | Monotonically increasing per document, unique with `documentId` |
| `authorId`                | User who saved or restored                                      |
| `content`                 | Immutable canonical Markdown text (`LONGTEXT`)                  |
| `byteSize`, `contentHash` | Validated UTF-8 size and SHA-256 digest                         |
| `saveMessage`             | Optional bounded user note                                      |
| `restoredFromRevisionId`  | Nullable lineage for restore operations                         |
| `createdAt`               | Immutable timestamp                                             |

No update or delete operation is exposed for a revision. Creation and document-head advancement occur in one transaction. `contentHash` helps integrity and deduplication analysis but does not replace authorization or revision identity.

### `DocumentAccess`

| Field                                   | Notes                                                                 |
| --------------------------------------- | --------------------------------------------------------------------- |
| `documentId`, `userId`                  | Composite identity                                                    |
| `role`                                  | `EDITOR` or `VIEWER`; owner is represented only by `Document.ownerId` |
| `grantedById`, `createdAt`, `updatedAt` | Provenance                                                            |

Constraints prohibit access rows for the owner. Deleting or trashing a document suspends access through query policy; permanent deletion cascades access rows only after retention policy permits.

### `Invitation`

| Field                                                             | Notes                                            |
| ----------------------------------------------------------------- | ------------------------------------------------ |
| `id`, `documentId`, `inviterId`                                   | Scope and actor                                  |
| `targetEmail`, `normalizedTargetEmail`                            | Recipient identity                               |
| `role`                                                            | `EDITOR` or `VIEWER`                             |
| `tokenHash`                                                       | Unique hash; raw token is never stored           |
| `expiresAt`, `acceptedAt`, `declinedAt`, `revokedAt`, `createdAt` | State timestamps                                 |
| `acceptedById`                                                    | Must match normalized target email at acceptance |

Only one active invitation per `(documentId, normalizedTargetEmail)` is allowed. State transitions are single-use and transactionally guarded.

### `AuditEvent`

Append-only security and collaboration facts such as login success/failure summary, session revocation, document create/trash/restore/delete, save, revision restore, invitation lifecycle, role change, and access revocation.

Fields include opaque `id`, `actorId`, `documentId`, stable `action`, bounded validated metadata JSON, `requestId`, and `createdAt`. Metadata excludes content, credentials, and raw tokens. Audit retention and administrator access require a separate policy before production.

## Save Transaction

1. Begin a transaction and select/lock the document.
2. Verify the actor is owner or active editor and the document is not trashed.
3. Compare `currentRevisionId` with submitted `baseRevisionId`.
4. On mismatch, roll back and return current head ID, ordinal, author summary, and timestamp, but not content unless a separate authorized fetch is made.
5. Compute the next ordinal, validate byte size, insert revision, update the head, and append audit event.
6. Commit and return the new head.

A unique `(documentId, ordinal)` constraint is the final guard against duplicate ordinals. Retry only known transient transaction errors; never retry a semantic revision conflict automatically.

## Deletion And Retention

- Trash is soft deletion and reversible by the owner.
- A trashed folder makes owned descendants unavailable through normal APIs without rewriting every descendant immediately; subtree policy must be consistent in reads and writes.
- Permanent deletion requires explicit confirmation, authorization, a retention decision, and transactional cleanup or a durable background job.
- Production backups are encrypted and may retain deleted data until the backup retention window expires; user-facing policy must disclose this.
- Expired sessions and invitations are cleaned by an idempotent scheduled task.

## Migration Rules

- Use named Prisma migrations reviewed in source control.
- Never use `prisma db push` in shared or production environments.
- Test migrations on production-like MySQL collation and SQL mode.
- Destructive migrations require backup/restore evidence and a rollback or forward-fix plan.
- Seed scripts use synthetic data only and are safe to rerun.
