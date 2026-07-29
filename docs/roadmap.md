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
- Add Argon2id hashing, opaque token storage, secure cookies, CSRF protection, and auth rate limits.
- Add email normalization and generic authentication errors.
- Decide and implement email verification/password reset launch gates.

**Exit:** authentication integration tests and abuse controls pass; no token or password material appears in logs.

## Phase 2: Personal Workspace

- Implement folders, documents, tree queries, rename, move, trash, restore, and permanent deletion.
- Enforce name uniqueness, ownership, cycle prevention, and depth/count limits.
- Build the accessible application shell and tree interactions.

**Exit:** users cannot observe or mutate another user's private tree; subtree operations are transactional.

## Phase 3: Vditor And Revision Saves

- Wrap Vditor in an isolated React adapter with cleanup and controlled document switching.
- Add dirty-state navigation protection, keyboard save, save status, and read-only mode.
- Implement atomic immutable revision saves using `baseRevisionId` conflict detection.
- Add history listing, revision preview, and restore-as-new-revision.

**Exit:** concurrent stale saves never overwrite newer content; revision and restore end-to-end tests pass.

## Phase 4: Sharing And Shared Editing

- Implement owner-managed direct grants to registered accounts, role changes, and revocation. Complete.
- Add a Shared with me view without exposing owner folder structure. Complete.
- Re-check authorization on every HTTP read/save and WebSocket ticket. Complete.
- Disconnect active rooms after access changes so every client reauthorizes. Complete.
- Add pending-email token invitations and email delivery through an adapter when external invitations are prioritized.

**Exit:** the complete role/action matrix passes at service, route, and end-to-end layers.

## Phase 5: Production Readiness

- Add quotas, pagination, database query review, retention controls, and administrative abuse tooling.
- Complete WCAG review, browser coverage, load tests, backup restore drill, and security review.
- Add deployment manifests, secret management, TLS, alerts, dashboards, and runbooks.

**Exit:** launch checklist, threat model, recovery objectives, and operational ownership are approved.

## Phase 6: Real-Time Collaboration

- Record the validated requirement and define online/offline/checkpoint semantics.
- Complete document access roles and invitation workflows using one HTTP/WebSocket authorization policy.
- Introduce Yjs documents and WebSocket collaboration as a separate service boundary or API module.
- Authenticate socket upgrades and authorize each room server-side.
- Persist CRDT updates and periodically materialize immutable Markdown checkpoints compatible with revision history.
- Bind collaborative source editing through CodeMirror 6 and render sanitized preview through Vditor.
- Add awareness/presence as ephemeral data; never persist cursor positions as document history.

Real-time work must not weaken explicit snapshots, auditability, revocation, or Markdown export.
