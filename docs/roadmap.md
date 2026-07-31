# Delivery Roadmap

Each phase ends with usable behavior, focused automated tests, updated documentation, and a deployable migration state.

## Phase 0: Decisions And Foundation

- Confirm requirements and close launch-blocking open decisions.
- Pin supported Node.js, pnpm, MySQL, Vditor, and browser versions.
- Add lockfile, ESLint, CI, health checks, and environment validation.
- Establish shared Zod contracts and typed API client conventions.
- Add observability, request IDs, redaction rules, and migration workflow.

**Exit:** clean install, build, lint, unit tests, and a local MySQL connection succeed in a fresh checkout.

## Phase 1: Identity And Sessions

- Implement registration, login, logout, session rotation, logout-all, and current-user endpoint.
- Add memory-hard password hashing, opaque token storage, secure cookies, CSRF protection, and auth rate limits.
- Add email normalization and generic authentication errors.
- Decide and implement email verification/password reset launch gates.

**Exit:** authentication integration tests and abuse controls pass; no token or password material appears in logs.

## Phase 2: Personal Workspace

- Implement folders, documents, tree queries, rename, move, trash, restore, and permanent deletion.
- Enforce name uniqueness, ownership, cycle prevention, and depth/count limits.
- Build the accessible application shell and tree interactions.

**Exit:** users cannot observe or mutate another user's private tree; subtree operations are transactional.

## Phase 3: Collaborative Editor And Revision Recovery

- Bind CodeMirror to Yjs as the only writable surface and keep Vditor as sanitized preview. Complete.
- Add dirty-state navigation protection, keyboard save, optional checkpoint messages, save status, and read-only mode. Complete.
- Implement atomic immutable revision saves using `baseRevisionId` conflict detection. Complete.
- Add attributable history listing, sanitized revision preview, restore-as-new-revision, and generation-safe live-room reset. Complete.

**Exit:** concurrent stale saves never overwrite newer content; revision and restore end-to-end tests pass.

## Phase 4: Sharing And Shared Editing

- Implement owner-managed direct grants to registered accounts, role changes, and revocation. Complete.
- Add a Shared with me view without exposing owner folder structure. Complete.
- Re-check authorization on every HTTP read/save and WebSocket ticket. Complete.
- Disconnect active rooms after access changes so every client reauthorizes. Complete.
- Add pending-email token invitations and email delivery through an adapter when external invitations are prioritized.
- Add owner-managed, revocable read-only public links to the current saved revision. Complete.

**Exit:** the complete role/action matrix passes at service, route, and end-to-end layers.

## Phase 5: Production Readiness

- Add quotas, pagination, database query review, retention controls, and administrative abuse tooling.
- Complete WCAG review, browser coverage, load tests, backup restore drill, and security review.
- Add deployment manifests, secret management, TLS, alerts, dashboards, and runbooks.

**Exit:** launch checklist, threat model, recovery objectives, and operational ownership are approved.

## Phase 6: Real-Time Collaboration

- Record the validated requirement and define online/checkpoint semantics. Complete.
- Reuse one document authorization policy for HTTP and WebSocket access. Complete for registered-account grants; pending-email invitations remain Phase 4 follow-up work.
- Introduce Yjs documents and a Hocuspocus WebSocket collaboration boundary. Complete.
- Authenticate socket upgrades with short-lived, one-time room tickets and authorize each room server-side. Complete.
- Persist compacted CRDT state and materialize immutable Markdown checkpoints on explicit Save. Complete.
- Bind collaborative source editing through CodeMirror 6 and render sanitized preview through Vditor. Complete.
- Keep awareness, participant counts, and remote cursor/selection data ephemeral. Complete with generic collaborator identities rather than exposed account details.

Real-time work must not weaken explicit snapshots, auditability, revocation, or Markdown export.

**Exit:** two authorized accounts converge on the same document, explicit Save creates one immutable server-authoritative revision, viewers cannot edit, and access changes force room reauthorization. Complete.

## Phase 7: Rendered-In-Place Collaborative Editing

- Replace the split CodeMirror/Vditor live canvas with Milkdown as the sole writable rendered Markdown surface. Complete.
- Introduce versioned collaboration-state formats and editor protocol negotiation.
- Add a pinned server/client Markdown codec for Milkdown's Yjs `XmlFragment`.
- Convert legacy rooms atomically while preserving unsaved shared drafts and incrementing room generation.
- Keep Vditor only for sanitized immutable history and public-document rendering.
- Add discoverable rich-formatting controls, visible Yjs-aware Undo/Redo, and a full-screen layout that preserves the mounted collaborative editor. In progress.
- Gate conversion on a supported-Markdown round-trip corpus and leave lossy documents on the legacy editor.
- Add two-browser tests for convergence, awareness, collaborative undo, checkpoint, restore, reconnect, revocation, read-only mode, IME, and mobile layout.

**Exit:** users edit rendered Markdown directly with no separate preview, two clients converge through the structured Yjs document, server checkpoints remain canonical Markdown, existing drafts and immutable revisions are preserved, and incompatible clients cannot create divergent live roots.

## Deferred: Durable Offline-First Editing

Online reconnect and durable server-side Yjs state are complete. True offline-first editing remains a separate milestone requiring IndexedDB-backed Yjs persistence, bounded offline queues/storage, collaboration-generation handling after restore, revocation semantics while disconnected, and deterministic multi-device reconciliation tests. It must not ship as a partial cache feature that weakens explicit-save or no-data-loss guarantees.
