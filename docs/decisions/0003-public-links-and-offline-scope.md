# ADR 0003: Hashed Public Links And Deferred Offline-First Editing

- **Status:** Accepted and implemented
- **Date:** 2026-07-29

## Context

TeamMD needs a low-friction way to publish one document without granting an account access. A public link is a bearer credential and must not expose private hierarchy, collaborators, revision history, or unsaved collaborative drafts. The same release considered whether reconnect support should be expanded into durable offline-first editing.

## Decision

1. Allow each document owner to manage at most one active read-only public link.
2. Generate a 256-bit URL-safe token, return it only on create/rotation, and store only its SHA-256 hash.
3. Carry the raw token in `/public#token=...`. The browser removes the fragment and exchanges it through `POST /api/v1/public/documents/resolve`; paths, queries, cookies, logs, and persistent browser storage never contain the token.
4. Return only document name, current saved Markdown, and current revision summary. Never publish the live Yjs draft, history, owner identity, collaborators, or folder metadata.
5. Make rotation and revocation immediate, owner-only, CSRF-protected, origin-validated, rate-limited, and audited. Use one generic unavailable response for invalid, revoked, trashed, or hidden documents.
6. Keep durable offline-first editing out of this release. Online reconnect uses server-persisted Yjs state, but offline-first requires persistent browser state, bounded queues, generation-aware restore handling, offline revocation semantics, and tested multi-device reconciliation.

## Consequences

- Anonymous readers can inspect the latest explicit checkpoint without receiving broader document access.
- Bearer tokens avoid common path/query/referrer leakage and are unrecoverable from the database.
- Public pages cannot expose unsaved collaborative work by design.
- Reloading a token-stripped public page requires the original link, which is an intentional consequence of not persisting the bearer.
- Offline-first remains a separately planned reliability feature rather than an ambiguous extension of reconnect behavior.

## Rejected Alternatives

- **Token in path or query:** rejected because it is more likely to appear in access logs, analytics, browser history, and referrers.
- **Store recoverable raw tokens:** rejected because database read access would disclose active bearer credentials.
- **Publish the live Yjs room:** rejected because public readers must see explicit saved history only and anonymous room access expands abuse and privacy risk.
- **Add IndexedDB caching and call it offline-first:** rejected because caching alone does not define restore generations, revocation, queue limits, or conflict reconciliation.
