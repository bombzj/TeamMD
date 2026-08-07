# Document Blackboard Mode Plan

## Objective

Add OneNote-like blackboard mode to each Markdown document. A document can own multiple named, lightweight blackboards. Each captures a read-only copy of the current Markdown when first initialized and holds an independent vector layer on a stable logical sheet. Collaborators explicitly save the main Markdown and complete blackboard collection as one immutable revision.

## Current Implementation Status

In progress. `MILKDOWN_BLACKBOARDS_V1`, the reviewed Prisma migration, shared Zod limits, server transition validation, immutable revision snapshots, atomic checkpoint/restore integration, multiple board tabs, frozen Markdown rendering, pressure-aware pen/highlighter/stroke eraser, line/rectangle/ellipse/arrow gestures, rename/reorder/clear/delete, single and lasso group selection/move/keyboard deletion, client-local Yjs Undo/Redo, per-board zoom and drag-panning, and authorized history rendering are implemented. Full real-device mouse/touch/stylus and visual coverage, performance budgets, feature gating, and rollout remain.

## OneNote Gap Boundary

The classroom blackboard now covers the compatible core of OneNote drawing: multiple page-like boards, pen/highlighter, lasso group manipulation, basic geometric shapes, pressure, pan/zoom, local Undo/Redo, collaboration, and saved history. TeamMD additionally guarantees that each drawing stays paired with the exact immutable Markdown copy used when the board was created.

The next compatible candidates are a point eraser, ruler or snap assistance, ephemeral collaborative laser pointer, paste/import of bounded images, and ink replay. Free-position editable note containers, a truly infinite writable canvas, handwriting-to-text/math recognition, audio recording, file attachments, tags, and notebook-wide search are larger product surfaces rather than incremental blackboard tools. They remain deferred so the main Markdown document stays portable and authoritative.

## Product Boundary

- A blackboard collection belongs to one existing document. Creating a blackboard does not create a canvas file, child document, attachment, or alternate Markdown source.
- Milkdown remains the only writable Markdown surface. Each blackboard drawing layer is a separate typed entry in one collection inside the same authenticated document collaboration room.
- Owners and editors may draw. Viewers and authorized history readers receive a read-only rendering.
- Owners and editors can create, rename, reorder, clear, delete, and switch among blackboards. Stable opaque IDs, not mutable names or positions, identify boards in collaboration and history.
- A blackboard renders its stored Markdown copy. Editing the main document never changes an initialized blackboard background.
- Markdown export remains plain text. Blackboard collection export and public-link publication are deferred decisions and must not be implied by the initial UI.
- Durable offline-first behavior remains out of scope. Normal authenticated reconnect and generation-safe restore are required.

## Interaction Model

The first implementation uses the same fixed-width, viewport-independent logical sheet for every blackboard in a document. The selected board's stored Markdown copy is rendered at that logical width and its transparent vector canvas shares the same document coordinate space. A narrow browser scales or pans the sheet instead of reflowing it to a different drawing coordinate system.

Required collection controls are create, rename, reorder, delete, and switch. Required drawing tools are pen, highlighter, stroke eraser, selection/move, Undo, Redo, pan, zoom, color, and width. Pointer capture must support mouse, touch, and stylus input, including pressure only when it can be normalized deterministically. Switching editor/blackboard mode, switching boards, or entering full screen must preserve the mounted collaboration provider, draft state, and per-board view state where practical.

Creating or first opening an uninitialized blackboard copies the server-authoritative current Markdown into the board in the same serialized room operation. Reopening an initialized board always uses its stored copy. To use newer text, an editor creates another board. Refreshing a background or migrating drawings is deliberately excluded from the first implementation.

## Proposed State Model

- Introduce a negotiated live-state format after `MILKDOWN_XML_V1` that contains the existing `Y.XmlFragment('milkdown')` and one documented blackboard collection root keyed by stable blackboard ID.
- Store bounded name and ordering metadata, immutable canonical background Markdown with its byte size and hash, and an independent stroke structure for each blackboard. Represent strokes as validated vector records with opaque IDs, tool kind, bounded style values, and quantized points in logical sheet coordinates. Do not persist rendered HTML, DOM, SVG, canvas pixels, device coordinates, active-board choice, or transient selection/presence.
- Prefer collaboration operations that update or remove a whole completed stroke. If in-progress point streaming is enabled, batch it and bound frequency and size so one pointer move does not become one unbounded persisted update.
- Keep remote pointer position, active tool, and selection awareness ephemeral.
- Define deterministic blackboard naming, ordering, and deletion semantics and deterministic stroke ordering/deletion so concurrent collection and drawing operations converge without a second last-write-wins document model.

Before implementation, record an ADR selecting the exact Yjs types, stroke encoding, coordinate precision, logical sheet growth behavior, and compatibility strategy.

## Save And Restore Semantics

One explicit Save must serialize the main Markdown and complete blackboard collection, including every immutable background copy, from the same authoritative room state while the room is held at the existing checkpoint serialization boundary. The database transaction creates the `DocumentRevision`, creates zero or more immutable blackboard snapshot rows, advances `Document.currentRevisionId` and `CollaborationState.checkpointRevisionId`, and records the audit event atomically.

A revision without blackboard snapshots has no blackboards. Restoring any revision creates a new revision containing its Markdown and exact named blackboard collection, replaces the operational room state, increments the room generation, notifies clients, and disconnects them so stale collection or drawing updates cannot merge into the restored generation.

The dirty indicator is the union of unsaved Markdown, blackboard metadata, and drawing changes across every board. A checkpoint acknowledgement may mark only the captured state vector as saved; edits made on any board after capture remain visibly unsaved.

## Security And Resource Limits

- Reuse the document authorization policy for HTTP checkpoints, collaboration tickets, room updates, history reads, restore, trash, and revocation.
- Reject viewer-originated drawing mutations server-side and disconnect rooms after access changes.
- Validate copied Markdown, names, finite coordinates, and enums and enforce limits per blackboard and per document for board count, background bytes, logical extent, strokes, points per stroke, total points, style precision, Yjs update size, compacted room size, and aggregate immutable snapshot size.
- Bound render work and memory for current and historical blackboards; virtualize or simplify display only when it does not change saved geometry.
- Do not store raw pointer telemetry, pressure-device identifiers, drawing payloads, or Markdown in logs or analytics.
- Render with application-owned canvas/SVG primitives. Do not accept arbitrary SVG, HTML, scripts, data URLs, or external resources as stroke data.

## Delivery Phases

### Phase 1: ADR, Contracts, And Codec

- Decide coordinate, Yjs, snapshot, and compatibility formats.
- Define authoritative first-initialization, copied-Markdown hashing, immutability, and new-board behavior after main Markdown changes.
- Add shared Zod schemas and stable error codes for blackboard collection metadata, bounded drawing data, and checkpoint responses.
- Add the reviewed Prisma migration for immutable revision snapshots and the new collaboration state format.
- Build deterministic browser/server encoders, validators, hashing, and empty-state compatibility.

**Exit gate:** schema migration, contract tests, codec round trips, malformed-data rejection, and old-revision compatibility pass.

### Phase 2: Local Blackboard Surface

- Add the mode switch, accessible blackboard list, collection controls, and stable logical sheet without remounting Milkdown or the provider.
- Implement drawing tools, pan/zoom, selection, accessible controls, dirty state, and local Undo/Redo.
- Preserve the copied background and stroke geometry across main Markdown edits, viewport size, and device-pixel-ratio changes.

**Exit gate:** component, keyboard, pointer/touch/stylus, responsive visual, and large-canvas performance tests pass with no persistence enabled by default.

### Phase 3: Collaboration And Checkpoints

- Bind the validated blackboard collection and drawing model to the negotiated Yjs root.
- Add awareness-only remote pointer/tool presentation.
- Extend authoritative checkpointing so Markdown and the complete blackboard collection commit atomically.
- Ensure edits after checkpoint capture remain dirty and duplicate Save requests do not create mismatched layers.

**Exit gate:** two browsers converge under concurrent drawing/editing, checkpoint hashes match server projections, and injected transaction failures never advance a partial revision.

### Phase 4: History, Restore, And Authorization

- List and render every immutable blackboard snapshot over its own stored Markdown copy in authorized history views.
- Restore the Markdown and exact board collection through the existing generation reset.
- Cover viewers, revocation, trash, reconnect, revisions with no boards, and fallback behavior.
- Keep drawings absent from anonymous public views.

**Exit gate:** the authorization matrix and end-to-end create, collaborate, save, history, restore, revoke, and old-revision flows pass.

### Phase 5: Performance And Rollout

- Measure pointer latency, update rate, compacted Yjs size, checkpoint time, snapshot size, history render time, and memory across representative devices.
- Add a validated browser/server feature gate that hides mutation UI and rejects unsupported protocol negotiation without deleting stored state.
- Roll out internally, verify backups and restore, then expand after accessibility, privacy, abuse, and load reviews.

**Exit gate:** documented resource ceilings and performance budgets pass, rollback preserves all Markdown and blackboard data, and production recovery rehearsals include blackboard snapshots.

## Required Test Matrix

- Concurrent board creation/rename/reorder/delete, name collisions, drawing on the same and different boards, erase versus move, simultaneous Markdown and drawing edits, local Undo/Redo, reconnect, and stale-client rejection after restore.
- Authoritative first-open copying, concurrent first initialization, immutable background enforcement, later main Markdown edits, new-board-from-newer-copy behavior, and stored-copy history rendering.
- Atomic checkpoint success, injected failure at every write boundary, duplicate Save, edits on any board after capture, complete collection restoration, and per-board snapshot/hash integrity.
- Owner/editor/viewer permissions, revoked open tabs, public-link exclusion, trash/restore, and cross-document isolation.
- Mouse, touch, stylus, pressure normalization, keyboard-operated controls, zoom/pan, narrow layouts, high DPI, and reduced-motion behavior.
- Limit enforcement for board count/name size, non-finite coordinates, extreme bounds, excessive points/strokes, aggregate size, oversized updates/snapshots, malformed persisted data, and render-time/memory exhaustion.

## Definition Of Done

- Every requirement `REQ-BOARD-001` through `REQ-BOARD-013` has focused automated coverage.
- Markdown remains canonical portable text and round-trips unchanged when only the blackboard changes.
- One explicit Save and one restore operate on Markdown and the complete blackboard collection atomically.
- Collaboration, revision immutability, authorization, revocation, generation, privacy, and observability invariants remain intact.
- Contracts, migrations, API documentation, architecture, data model, threat model, tests, and operational runbooks agree with the implementation.
- Focused package tests, repository typecheck, lint, formatting, integration, end-to-end, accessibility, and performance gates pass before rollout.
