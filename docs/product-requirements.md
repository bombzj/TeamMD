# Product Requirements

## Product Goal

MyMD gives individuals and small teams a dependable place to organize, edit, share, and recover Markdown documents. It should feel familiar to users of collaborative office tools while preserving Markdown as the canonical content format.

## Product Principles

- No silent data loss.
- Sharing is explicit, scoped, and revocable.
- Markdown remains portable plain text.
- The MVP favors understandable explicit saves over premature real-time complexity.
- History is immutable and attributable.
- Keyboard and screen-reader workflows are first-class.

## Personas

- **Owner:** creates documents, organizes them, invites collaborators, changes roles, revokes access, and controls deletion.
- **Editor:** reads and explicitly saves shared documents but cannot manage ownership or delete the owner's document.
- **Viewer:** reads a shared document and its current rendered result but cannot change content.

## MVP Requirements

### Identity

- **REQ-AUTH-001:** A visitor can register with a unique normalized email and password.
- **REQ-AUTH-002:** A registered user can log in, log out of the current session, and log out of all sessions.
- **REQ-AUTH-003:** Authentication failures do not reveal whether an email exists.
- **REQ-AUTH-004:** Password reset and email verification are planned for the first public release. A private local MVP may gate them behind email infrastructure readiness.

### Workspace

- **REQ-TREE-001:** A user can create, rename, move, trash, restore, and permanently delete folders they own.
- **REQ-TREE-002:** A user can create, rename, move, trash, restore, and permanently delete documents they own.
- **REQ-TREE-003:** Folder names are unique within the same owner and parent folder. Document names are unique within the same owner and parent folder, case-insensitively.
- **REQ-TREE-004:** The tree prevents cycles, caps nesting depth, and treats shared documents as a separate virtual view rather than inserting them into the recipient's owned hierarchy.
- **REQ-TREE-005:** Trashing a folder hides its owned descendants. Restoring or permanently deleting it applies transactionally to that subtree.

### Editing And Saves

- **REQ-EDIT-001:** An authorized editor can edit Markdown in Vditor and see dirty, saving, saved, failed, read-only, and conflict states.
- **REQ-EDIT-002:** Save is explicit through a button and `Ctrl+S` or `Cmd+S`; leaving with unsaved changes triggers a navigation warning.
- **REQ-EDIT-003:** Each successful save atomically creates one immutable revision and makes it the document head.
- **REQ-EDIT-004:** A save must identify the revision from which editing began. A stale base receives a conflict response containing safe head metadata, never an automatic overwrite.
- **REQ-EDIT-005:** Content is bounded by a configurable UTF-8 byte limit. The initial proposal is 2 MiB per revision.

### Sharing

- **REQ-SHARE-001:** An owner can invite an email address to one document as editor or viewer.
- **REQ-SHARE-002:** An invitation has a random single-use token, expiry, inviter, target email, and intended role.
- **REQ-SHARE-003:** A matching registered user can accept or decline. An unregistered recipient can register first and then accept using the same normalized email.
- **REQ-SHARE-004:** An owner can change a collaborator role or revoke access immediately.
- **REQ-SHARE-005:** Sharing a document does not grant access to its parent folder, siblings, descendants, or historical invitation data.

### History

- **REQ-HIST-001:** Authorized users can list revision metadata. Owners and editors can read revision content; viewer history access is an explicit product setting, defaulting to current revision only for MVP privacy.
- **REQ-HIST-002:** Revision metadata includes author, timestamp, ordinal version, byte size, and optional save message.
- **REQ-HIST-003:** Restoring an old revision creates a new head revision attributed to the restoring user.
- **REQ-HIST-004:** Revision retention is unlimited in MVP subject to documented storage limits; a future policy may archive or compact history without mutating visible audit facts.

## Critical Acceptance Scenarios

1. Two editors open revision 7. Alice saves revision 8. Bob's save against revision 7 returns `409 REVISION_CONFLICT`; revision 8 remains unchanged and Bob can copy, compare, reload, or retry after intentionally reconciling.
2. An owner invites an unregistered email. A user registering with that normalized email can accept before expiry; another account cannot use the token.
3. Revoking a collaborator invalidates subsequent document reads and saves immediately, including from an already-open browser tab.
4. Restoring revision 3 when revision 9 is current creates revision 10 with revision 3 content; revisions 3 and 9 remain immutable.
5. A viewer cannot mutate content even by calling the API directly.
6. Trashing a folder removes its descendants from normal listings without deleting revision history. Restore returns the subtree when its parent is valid.

## Non-Functional Requirements

- API p95 under 300 ms for metadata operations and under 800 ms for typical document saves, excluding network latency, at the initial target load.
- Initial target: 10,000 users, 1 million documents, 20 million revisions, and 100 concurrent requests per API instance. Revisit with measured usage.
- WCAG 2.2 AA for authentication, tree navigation, editor controls, dialogs, and history workflows.
- All mutation endpoints are idempotent where practical or protected from accidental duplicate effects.
- Structured logs include request ID, actor ID, action, result, and latency without document content or secrets.
- Daily encrypted backups with tested point-in-time recovery before production launch.

## Explicit Non-Goals For MVP

- Character-level real-time co-editing, live cursors, or presence
- Offline-first synchronization
- Comments, suggestions, mentions, and notifications beyond invitation email
- Public or anonymous links
- Folder-level sharing or inherited access control
- Rich-text round-trip guarantees beyond Vditor's Markdown behavior
- Binary attachments, image hosting, publishing, plugins, or arbitrary HTML execution
- Native mobile or desktop applications

## Success Metrics

- No confirmed silent-overwrite incidents.
- At least 99.9% successful save requests excluding validation and conflict responses.
- Median time from invitation email to accepted access can be measured.
- Restore flow succeeds in end-to-end tests and quarterly recovery exercises.
- Authorization matrix has complete automated coverage for document actions.

## Open Product Decisions

- Whether viewers may inspect full revision history after MVP.
- Whether public launch requires email verification before any document creation.
- Storage quotas by user and revision count.
- Whether collaborator access survives an owner's trash action or remains suspended until restore.
- Exact Markdown flavor and which Vditor modes are exposed initially.
