# Product Requirements

## Product Goal

TeamMD gives individuals and small teams a dependable place to organize, edit, share, and recover Markdown documents. It should feel familiar to users of collaborative office tools while preserving Markdown as the canonical content format.

## Product Principles

- No silent data loss.
- Sharing is explicit, scoped, and revocable.
- Markdown remains portable plain text.
- Real-time drafts and explicit durable saves have distinct, understandable states.
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
- **REQ-AUTH-005:** An authenticated user can change their password from account settings by confirming the current password. A successful change rotates the current session, revokes every previous session, and is audited without storing or logging either password.

### Workspace

- **REQ-TREE-001:** A user can create, rename, move, trash, restore, and permanently delete folders they own.
- **REQ-TREE-002:** A user can create, rename, move, trash, restore, and permanently delete documents they own.
- **REQ-TREE-003:** Folder names are unique within the same owner and parent folder. Document names are unique within the same owner and parent folder, case-insensitively.
- **REQ-TREE-004:** The tree prevents cycles, caps nesting depth, and treats shared documents as a separate virtual view rather than inserting them into the recipient's owned hierarchy.
- **REQ-TREE-005:** Trashing a folder hides its owned descendants. Restoring or permanently deleting it applies transactionally to that subtree.
- **REQ-TREE-006:** The authenticated workspace uses one compact navigation surface instead of a separate top banner. The TeamMD identity appears at the top of the persistent desktop sidebar, account controls appear at its bottom, and narrow layouts preserve the same actions in one non-wrapping sticky tool rail. The account menu identifies the current user and provides keyboard-accessible Settings, current-session logout, and all-session logout actions.

### Editing And Saves

- **REQ-EDIT-001:** An authorized editor can edit rendered Markdown directly in one Milkdown/Yjs surface without a separate live preview and can see dirty, saving, saved, failed, read-only, and connection states.
- **REQ-EDIT-002:** Save is explicit through a button and `Ctrl+S` or `Cmd+S`; leaving with unsaved changes triggers a navigation warning.
- **REQ-EDIT-003:** Each successful save atomically creates one immutable revision and makes it the document head.
- **REQ-EDIT-004:** A legacy whole-document save must identify the revision from which editing began and receives a conflict response for a stale base. A collaborative Save checkpoints the server-authoritative Yjs room after pending updates are synchronized; neither path silently overwrites newer content.
- **REQ-EDIT-005:** Content is bounded by a configurable UTF-8 byte limit. The initial proposal is 2 MiB per revision.
- **REQ-EDIT-006:** Authorized editors connected to the same collaborative document converge on the same Markdown text without whole-document last-write-wins replacement.
- **REQ-EDIT-007:** Collaborative operational updates are distinct from immutable revisions. Explicit Save captures a durable server-authoritative checkpoint; presence and cursors are ephemeral.
- **REQ-EDIT-008:** The collaborative editor stores structured operational state in a versioned Yjs `XmlFragment`, while every immutable revision remains canonical portable Markdown serialized by the server.
- **REQ-EDIT-009:** Migrating an existing collaborative room preserves its complete shared draft, increments the room generation, and rejects incompatible editor protocols. Migration never rewrites existing immutable revisions.
- **REQ-EDIT-010:** Supported Markdown constructs round-trip through the rendered editor without semantic loss. Documents containing unsupported or lossy syntax remain on the legacy source editor until the user can resolve the incompatibility explicitly.
- **REQ-EDIT-011:** If collaboration cannot initialize, an authorized user can edit the current saved revision without presence or live merging and save through the stale-base whole-document endpoint. The UI clearly identifies this degraded mode and does not claim offline-first behavior.
- **REQ-EDIT-012:** An authorized user can expand the complete document editor into a distraction-free full-screen layout and exit with the visible control or Escape without recreating the editor, losing draft state, or disconnecting collaboration.
- **REQ-EDIT-013:** Owners and editors have visible Undo and Redo controls that invoke the active editor history. Collaborative rooms use the client-local Yjs undo manager, standalone fallback uses ProseMirror history, and viewers receive no mutation controls.
- **REQ-EDIT-014:** Rich editor actions expose accessible names, visible keyboard focus, and keyboard activation even when the underlying Milkdown control is pointer-driven. Block tools target the containing block rather than inline formula atoms and remain fully visible outside document text at supported desktop and mobile widths. Read-only viewers do not receive mutation controls.
- **REQ-EDIT-015:** A fenced code block whose language is exactly `mermaid` can show a disposable diagram preview while its original fence remains the only editable, collaborative, saved, and exported representation. Invalid or oversized diagrams retain editable source and show a bounded local error instead of changing document content.
- **REQ-EDIT-016:** Editors can insert a starter Mermaid diagram through a first-class Diagram control without creating a generic code block or selecting a code language. Compact diagram previews use intrinsic sizing and scale down within narrow editor widths; wide timeline diagrams retain readable scale inside preview-local horizontal scrolling without causing page overflow.
- **REQ-EDIT-017:** For the supported flowchart subset, editors can add, rename, and delete rectangular nodes; add and delete unlabeled directed edges; and choose layout direction. Each visual operation deterministically updates the same fenced Mermaid source in one Milkdown/ProseMirror/Yjs transaction. Unsupported syntax remains available in source/preview mode without normalization, and no parallel writable graph state is introduced.
- **REQ-EDIT-018:** Operators can disable derived Mermaid rendering and visual controls through validated browser configuration without rewriting or hiding Mermaid source, revisions, or collaboration state.
- **REQ-EDIT-019:** Editors can create and edit portable inline `$...$` and display `$$...$$` formulas rendered locally with KaTeX, including the local `mhchem` extension. Formula source remains the only writable, collaborative, saved, and exported representation; generated KaTeX HTML and MathML are disposable UI.
- **REQ-EDIT-020:** History and public views render saved formulas locally without loading renderer scripts from a CDN. Untrusted KaTeX commands cannot create links or executable DOM, oversized formulas show a bounded local error, and wide display formulas scroll within their preview without causing page overflow.
- **REQ-EDIT-021:** An authorized user can inspect the current canonical Markdown in a read-only whole-document source view and copy it as plain text. Switching views does not recreate Milkdown or introduce a parallel writable document root.
- **REQ-EDIT-022:** The first local edit to an authoritative empty collaboration room, including pasted Markdown, immediately marks the draft unsaved and enables Save. Static history/public rendering recognizes inline formulas whose source begins with a digit under the same bounded local KaTeX policy.

### Planned Blackboard Mode

Blackboard mode is a document-scoped collection of lightweight visual workspaces. When a blackboard is first created, it receives a read-only copy of the document's current Markdown as its background. Blackboards are intended primarily for short-lived teaching, meeting, and explanation sessions. It is a planned post-rendered-editor capability and is not part of the current release.

- **REQ-BOARD-001:** An authorized user can switch one Markdown document between the normal editor and any of its blackboards without creating another Markdown document, replacing the Markdown source, remounting the collaboration session, or losing unsaved work.
- **REQ-BOARD-002:** Owners and editors can create multiple blackboards for the same Markdown document and rename, reorder, clear, or delete them. Each blackboard has a stable opaque ID and a bounded display name that is unique case-insensitively within the document; collection changes participate in Undo/Redo and dirty state.
- **REQ-BOARD-003:** When a blackboard is created or first opened if it has not yet been initialized, the server-authoritative current Markdown is copied into that blackboard as an immutable read-only background. Later openings reuse the stored copy; later edits to the main Markdown do not change it.
- **REQ-BOARD-004:** Every blackboard renders its copied Markdown on a stable logical sheet and owns an independent transparent vector drawing layer above it. Zooming, panning, resizing, switching blackboards, and device-pixel-ratio changes do not alter the copied background or saved stroke geometry.
- **REQ-BOARD-005:** Owners and editors can draw with a pressure-aware pen and highlighter, create straight lines, rectangles, ellipses, and arrows, choose bounded colors and widths, erase strokes, select individual strokes or lasso a group, move or delete the selection as one undoable operation, and undo or redo their own blackboard operations. Viewers can navigate, zoom, pan, and inspect saved blackboards but receive no durable mutation controls.
- **REQ-BOARD-006:** Authorized collaborators in the same document see blackboard collection and drawing changes converge in real time through the authenticated document room, including when they work on different blackboards. Active-board choice and drawing presence may be ephemeral, but copied backgrounds, blackboard metadata, and strokes are durable operational state and use the same authorization, revocation, generation, and reconnect rules as Markdown edits.
- **REQ-BOARD-007:** The main Markdown and all blackboards share one dirty state and one explicit Save action. A successful Save atomically creates one immutable document revision containing canonical Markdown plus the matching versioned snapshot of the complete blackboard collection, including every copied background; a partial checkpoint must not advance the document head.
- **REQ-BOARD-008:** Restoring a revision restores both its main Markdown and its complete blackboard collection, including copied backgrounds, as a new head revision. Revisions created before blackboard support behave as having no blackboards and are never rewritten.
- **REQ-BOARD-009:** Switching modes or blackboards, entering full screen, reconnecting, or navigating within the document does not rasterize strokes, flatten them into Markdown, refresh a copied background, or silently discard either content type. Plain Markdown export returns the main document source and does not claim to contain supplementary blackboards or their copies.
- **REQ-BOARD-010:** Blackboard input accepts pointer, mouse, touch, and stylus events where the browser exposes them, normalizes available pressure into bounded vector points, and provides a drag-pan mode that does not mutate saved geometry. Blackboard tabs and drawing controls have accessible names, visible keyboard focus, and keyboard activation; non-pointer users can create, rename, switch, reorder, clear, and delete blackboards and remove selected strokes.
- **REQ-BOARD-011:** The client and server enforce documented per-blackboard and per-document limits for blackboard count, copied-Markdown bytes, logical canvas bounds, stroke count, points per stroke, coordinate precision, update size, and aggregate saved blackboard bytes. Invalid background or geometry data is rejected without corrupting the last saved revision, and copied Markdown, blackboard names, and drawing content are not written to logs.
- **REQ-BOARD-012:** Initial blackboard history views list the blackboards captured by the selected revision and render each saved layer read-only over its stored Markdown copy. Anonymous public links continue to expose only the current saved main Markdown and revision summary until blackboard publication receives a separate privacy and abuse review.
- **REQ-BOARD-013:** Updating the main Markdown never updates an existing blackboard copy. To use newer Markdown, an editor creates another blackboard; background refresh and drawing migration are intentionally excluded from the initial workflow.

### Sharing

The current release supports direct sharing to an existing registered account and revocable read-only public links. Tokenized pending-email invitations and email delivery remain planned follow-up work.

- **REQ-SHARE-001:** An owner can grant one existing registered account editor or viewer access to one document by normalized email.
- **REQ-SHARE-002:** Direct grants are document-scoped, attributable to the granting owner, and never expose the owner's private folder hierarchy.
- **REQ-SHARE-003:** The recipient sees the grant in a virtual Shared with me view; no invitation acceptance step is required for a direct grant.
- **REQ-SHARE-004:** An owner can change a collaborator role or revoke access immediately.
- **REQ-SHARE-005:** Sharing a document does not grant access to its parent folder, siblings, descendants, or historical grant data.
- **REQ-SHARE-006:** An owner can create or rotate one bearer public link for a document and revoke it immediately.
- **REQ-SHARE-007:** A public link shows only the document name, current saved Markdown, and current revision summary. It never exposes unsaved collaborative drafts, history, owner identity, collaborators, or folder metadata.
- **REQ-SHARE-008:** Public links are read-only. The raw token is shown only when created or rotated, is stored hashed at rest, and is carried in the URL fragment rather than the path or query string.

### History

- **REQ-HIST-001:** Authorized users can list revision metadata. Owners and editors can read revision content; viewer history access is an explicit product setting, defaulting to current revision only for MVP privacy.
- **REQ-HIST-002:** Revision metadata includes author, timestamp, ordinal version, byte size, and optional save message.
- **REQ-HIST-003:** Restoring an old revision creates a new head revision attributed to the restoring user.
- **REQ-HIST-004:** Revision retention is unlimited in MVP subject to documented storage limits; a future policy may archive or compact history without mutating visible audit facts.

## Critical Acceptance Scenarios

1. Two collaborative editors make concurrent changes, converge on the same Yjs text, and explicitly checkpoint one server-authoritative revision without losing either change. A legacy whole-document save against a stale base still returns `409 REVISION_CONFLICT`.
2. An owner grants an existing registered account editor access; another account cannot observe the grant or the owner's folder hierarchy.
3. Revoking a collaborator invalidates subsequent document reads and saves immediately, including from an already-open browser tab.
4. Restoring revision 3 when revision 9 is current creates revision 10 with revision 3 content; revisions 3 and 9 remain immutable.
5. A viewer cannot mutate content even by calling the API directly.
6. Trashing a folder removes its descendants from normal listings without deleting revision history. Restore returns the subtree when its parent is valid.
7. An owner creates a public link, an anonymous browser reads only the current saved revision, and the same token returns a generic unavailable response after revocation.
8. Two editors create and draw on different blackboards over the same Markdown document, converge on the same named collection, and Save one matching Markdown-and-blackboard revision. A later main Markdown edit does not change either stored blackboard background; a newly created board receives the newer Markdown copy. Restoring an earlier revision restores its main Markdown and exact blackboard collection.

## Non-Functional Requirements

- API p95 under 300 ms for metadata operations and under 800 ms for typical document saves, excluding network latency, at the initial target load.
- Initial target: 10,000 users, 1 million documents, 20 million revisions, and 100 concurrent requests per API instance. Revisit with measured usage.
- WCAG 2.2 AA for authentication, tree navigation, editor controls, dialogs, and history workflows.
- All mutation endpoints are idempotent where practical or protected from accidental duplicate effects.
- Structured logs include request ID, actor ID, action, result, and latency without document content or secrets.
- Daily encrypted backups with tested point-in-time recovery before production launch.

## Explicit Non-Goals For The First Collaborative Release

- Offline-first synchronization
- Comments, suggestions, mentions, and notifications beyond invitation email
- Folder-level sharing or inherited access control
- Byte-for-byte preservation of insignificant Markdown formatting such as equivalent list markers or whitespace; semantic preservation of the supported Markdown flavor remains required
- General-purpose binary attachments, image hosting, publishing, plugins, or arbitrary HTML execution. The planned blackboard stores bounded vector operations associated with a document revision, not uploaded binary files.
- Native mobile or desktop applications

## Success Metrics

- No confirmed silent-overwrite incidents.
- At least 99.9% successful save requests excluding validation and conflict responses.
- Median time from direct grant to first successful recipient access can be measured.
- Restore flow succeeds in end-to-end tests and quarterly recovery exercises.
- Authorization matrix has complete automated coverage for document actions.

## Open Product Decisions

- Whether viewers may inspect full revision history after MVP.
- Whether public launch requires email verification before any document creation.
- Storage quotas by user and revision count.
- Whether collaborator access survives an owner's trash action or remains suspended until restore.
- Exact Markdown flavor and Milkdown extension set; the migration must define these before automatic room conversion is enabled.
- Whether later demand justifies refreshing an existing blackboard from newer Markdown and migrating its strokes; the initial workflow creates a new blackboard instead.
- Whether blackboard content should have a separate export format and whether an owner may opt it into public-link rendering after privacy, sanitization, and resource-limit review.

## Deferred Offline-First Decision

Ordinary online reconnect is required and implemented through durable server-side Yjs state. Durable offline-first editing is not part of the current release because browser persistence alone is insufficient: the design must define bounded IndexedDB storage, offline queue limits, collaboration-generation changes after restore, revocation while offline, and deterministic reconciliation without silent data loss. Treat offline-first as a separate milestone with its own threat model and multi-device recovery tests.
