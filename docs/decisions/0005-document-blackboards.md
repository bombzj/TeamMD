# ADR 0005: Document-Scoped Blackboard Snapshots

## Status

Accepted for incremental implementation.

## Context

Classroom users need to annotate a rendered Markdown lesson without turning those marks into Markdown content. One document may need several boards, and a board must remain understandable even when the source document is edited after class.

Using the current document as a live background would make old drawings drift away from the text they reference. Storing all boards in one opaque JSON value would also turn concurrent drawing into last-write-wins replacement and make checkpoint validation difficult.

## Decision

- A document may have multiple blackboards, each identified by a stable UUID.
- Creating a board captures the room's canonical Markdown as that board's immutable background. It is rendered read-only and is never refreshed from the document head.
- Blackboard metadata and strokes live beside the Milkdown fragment in the negotiated `MILKDOWN_BLACKBOARDS_V1` Yjs state format. Boards and strokes use separately addressable Yjs maps so independent edits can converge.
- The server validates that a newly observed background equals the room's authoritative canonical Markdown and rejects any later background change.
- Explicit Save serializes canonical Markdown and the complete blackboard collection under the existing checkpoint boundary. The revision and its `DocumentRevisionBlackboard` rows are committed atomically.
- Restore copies both Markdown and the exact saved board collection into a new immutable revision, rebuilds the operational room, advances its generation, and disconnects stale clients.
- Older revisions have an empty board collection. Existing revisions are never rewritten.
- Authorized revision history may render frozen backgrounds and validated vector strokes. Anonymous public views do not expose boards in this phase.

## Consequences

- Editing Markdown after board creation cannot create a mismatch inside that board; its copied background and drawing remain paired.
- Users create another board when they want a newer Markdown background.
- Copies increase revision storage, so per-board, per-document, point, stroke, and payload limits are enforced at shared validation boundaries.
- Clients that do not negotiate the blackboard format cannot join a blackboard room. Converting a structured Milkdown room advances the room generation and removes incompatible live clients.
- Board creation requires an online authoritative room. Offline board creation and merging independently edited background copies are out of scope.

## Alternatives Rejected

- **Always render the current Markdown:** old marks can point at the wrong text after edits.
- **Store a revision reference only:** it couples live drawing availability to historical lookup and does not make a checkpoint self-contained.
- **Store the whole collection as one JSON value in Yjs:** unrelated collaborators overwrite one another's strokes and metadata.
- **Make the copied background editable:** this creates a second document model with ambiguous save, permission, and merge semantics.
