# ADR 0002: Yjs Collaboration With Immutable Checkpoints

- **Status:** Accepted for incremental implementation
- **Date:** 2026-07-28

## Context

Simultaneous same-document editing is now a product requirement. The existing explicit-save model safely rejects stale full-document writes, but it cannot merge concurrent character edits. Vditor 3.11.2 exposes whole-document values and a transformed `contenteditable` surface; it does not expose a stable positional transaction API suitable for a CRDT binding.

## Decision

1. Use Yjs as the convergence model and persist collaboration state separately from user-visible document revisions.
2. Use CodeMirror 6 with `y-codemirror.next` as the writable collaborative Markdown editor. Retain Vditor as a sanitized rendered preview; never mount Vditor as a second writable editor for a collaborative room.
3. Add an authenticated WebSocket collaboration gateway behind a CSRF-protected, one-time room ticket. The gateway rechecks document authorization and origin at connection time and on sensitive operations.
4. Keep awareness and cursor presence ephemeral. Never store presence as revision history.
5. Keep explicit Save. A save captures the server-authoritative Yjs text and state vector, creates one immutable `DocumentRevision`, advances the document head, and records an audit event atomically.
6. Treat restore, trash, deletion, and incompatible external saves as room-generation changes that disconnect stale clients.
7. Ship the first gateway as single-instance. Horizontal deployment requires room affinity or shared pub/sub for updates and revocation before adding API instances.

## Consequences

- Concurrent character edits converge without last-write-wins replacement.
- Immutable revision history remains understandable, attributable, and portable Markdown.
- Collaborative editing uses a source editor rather than Vditor's instant-rendering mode; Vditor remains the preview renderer and sanitization boundary.
- Document sharing and one reusable owner/editor/viewer policy are prerequisites for rooms.
- Yjs updates need durable storage, compaction, size limits, observability, and restart recovery in addition to revision snapshots.

## Rejected Alternatives

- **Broadcast whole Markdown strings:** rejected because overlapping edits do not converge and remote replacement disrupts selection and undo.
- **Bind Yjs to Vditor internals:** rejected because the required DOM, selection, composition, and undo APIs are private and version-specific.
- **Create a revision per keystroke:** rejected because it conflates operational synchronization with user-visible history and creates unbounded revision churn.
