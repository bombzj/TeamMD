# AGENTS.md

This file is the authoritative engineering guide for humans and coding agents working in MyMD.

## Mission

Build a secure, reliable online Markdown workspace with live Yjs collaboration, explicit immutable checkpoints, file sharing, and recoverable revision history. CodeMirror is the writable collaborative surface; Vditor renders sanitized preview.

## Read Before Changing Code

- Product scope or user behavior: `docs/product-requirements.md`
- System boundaries or dependencies: `docs/architecture.md`
- Persistence or migrations: `docs/data-model.md`
- HTTP routes or payloads: `docs/api-contract.md`
- Authentication, authorization, or user data: `docs/security.md`
- Tooling and local setup: `docs/development.md`
- Tests and release gates: `docs/testing-strategy.md`
- Architectural tradeoffs: `docs/decisions/`

When code and documentation disagree, stop and resolve the discrepancy in the same change.

## Repository Boundaries

```text
apps/web              Browser application and Vditor adapter
apps/api              Fastify HTTP API, authorization, services, persistence
packages/contracts    Shared Zod request/response schemas and inferred types
packages/config       Validated environment and shared tool configuration
docs                  Product and engineering decisions
```

Dependency direction is one way:

- `apps/web` may depend on `packages/contracts`.
- `apps/api` may depend on `packages/contracts` and `packages/config`.
- Shared packages must not import from either app.
- Browser code must never import Prisma or server-only configuration.

## Architectural Invariants

1. The API is the authorization boundary. UI permission checks are convenience only.
2. Every successful content save creates an immutable `DocumentRevision` and advances the document head atomically.
3. A save includes `baseRevisionId`. If it is not the current head, return `409 REVISION_CONFLICT`; never silently overwrite newer content.
4. Reverting history creates a new revision copied from the selected revision. Existing history is never changed.
5. Passwords use Argon2id. Sessions use opaque, revocable tokens stored hashed at rest and delivered in secure HttpOnly cookies.
6. All untrusted request, response, environment, and persisted JSON boundaries use Zod validation where applicable.
7. Document roles are `owner`, `editor`, and `viewer`. Exactly one owner exists in MVP. Ownership transfer is out of scope.
8. Current sharing directly grants document access to an existing registered account by normalized email. Future pending-email invitations must be document-scoped, expiring, and single-use.
9. Database changes use reviewed Prisma migrations. Never use schema push in shared environments.
10. Yjs operational state uses the authenticated collaboration protocol and separate persistence. Collaborative Save reads the authoritative room and creates an immutable revision; clients never submit whole-document content for a collaborative checkpoint.

## Engineering Workflow

1. Find the requirement and owning module.
2. Add or update a focused test that demonstrates the behavior.
3. Make the smallest implementation change at the owning boundary.
4. Run the narrowest test, typecheck, and lint commands for the changed package.
5. Update contracts and relevant documentation in the same change.

Prefer explicit domain services over business logic in route handlers or React components. Use transactions for writes spanning permissions, revisions, head pointers, invitations, or audit records.

## API And Error Rules

- Mount versioned routes under `/api/v1`.
- Use JSON except health responses where JSON is still preferred.
- Return errors as `{ "error": { "code", "message", "details?", "requestId" } }`.
- Use stable machine-readable codes from `packages/contracts`; do not branch on error messages.
- Do not expose password hashes, session tokens, invitation token hashes, internal stack traces, or resource existence to unauthorized callers.
- Mutations require CSRF protection and origin validation in addition to authentication.

## Testing Expectations

- Contracts: schema success/failure and backward compatibility tests.
- API services: authorization matrix, stale-save conflict, transaction behavior, and data isolation tests.
- API routes: authentication, validation, status codes, and error envelope tests using Fastify injection.
- Web: editor lifecycle, dirty state, conflict handling, navigation guards, and permission presentation tests.
- End to end: register, create, edit concurrently, checkpoint, invite, accept, inspect history, restore, revoke.

Never weaken or delete a failing test merely to make CI pass. Record unrelated failures in the handoff.

## Security And Privacy

- Never log credentials, raw tokens, document content, or full request bodies.
- Normalize email for identity lookup while preserving a display form if needed.
- Rate-limit authentication and sharing endpoints.
- Render Markdown with sanitization; raw HTML is disabled by default.
- Keep secrets out of source control and update `.env.example` when configuration changes.
- Enforce size, depth, and count limits at API boundaries.

## Definition Of Done

A change is done when behavior, shared contracts, authorization, migrations, focused tests, relevant documentation, and observability are consistent. The narrow test suite and package typecheck must pass. Cross-cutting changes also require the repository-wide checks.
