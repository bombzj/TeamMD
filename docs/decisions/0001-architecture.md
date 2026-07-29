# ADR 0001: TypeScript Modular Monolith With Explicit Revision Saves

- **Status:** Accepted; real-time deferral superseded by ADR 0002
- **Date:** 2026-07-27

## Context

TeamMD needs browser editing, identity, hierarchical organization, document-level sharing, and trustworthy history. The product may later support Google Docs-style simultaneous editing, but the first version intentionally uses a Save button. Introducing CRDT synchronization, presence, durable updates, and offline reconciliation now would materially increase operational and product complexity before core authorization and recovery behavior are proven.

## Decision

1. Use a pnpm TypeScript monorepo with React/Vite/Vditor in `apps/web`, Fastify in `apps/api`, and shared Zod schemas in `packages/contracts`.
2. Build the API as a modular monolith backed by MySQL 8.4 and Prisma migrations.
3. Store every successful Markdown save as an immutable full snapshot. The document points to its current revision.
4. Require `baseRevisionId` on saves and reject a stale base with `409 REVISION_CONFLICT`.
5. Scope sharing to individual documents with `owner`, `editor`, and `viewer` roles.
6. Use opaque server-side sessions in secure HttpOnly cookies rather than browser-stored bearer tokens.
7. Initially defer real-time collaboration while preserving a boundary for future Yjs/WebSocket checkpoints. ADR 0002 later accepts and implements that boundary.

## Consequences

### Positive

- One language and contract model across the main codebase.
- Simple local development and deployment while domain modules stay separable.
- Revision restore and audit behavior are straightforward and testable.
- Stale writes are visible instead of silently losing content.
- A future real-time transport does not need to redefine ownership, history, or permissions.

### Costs

- Full snapshots consume more storage than deltas; quotas and measured compaction may be needed later.
- Explicit saves do not merge concurrent changes. Users must reconcile conflicts manually.
- Prisma and MySQL-specific transaction/locking behavior requires integration tests against real MySQL.
- Document-only sharing is less flexible than inherited folder sharing but substantially easier to reason about securely.

## Alternatives Considered

- **Real-time CRDT from day one:** deferred because it expands persistence, protocol, testing, and operational scope before demand is validated.
- **Last write wins:** rejected because it permits silent data loss.
- **Mutable document body plus audit diffs:** rejected because reconstruction and restore become fragile and diffs may not be independently valid Markdown.
- **Microservices:** rejected because current scale and team boundaries do not justify distributed transactions and operational overhead.
- **JWTs in local storage:** rejected because revocation is harder and browser-readable tokens amplify XSS impact.

## Revisit When

- Simultaneous editing becomes a validated product requirement.
- Revision storage cost exceeds agreed limits.
- A module needs independent scaling or ownership backed by operational evidence.
- Folder-level sharing or organization workspaces become required.
