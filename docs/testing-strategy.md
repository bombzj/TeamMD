# Testing Strategy

## Goals

Tests protect the highest-risk properties: no unauthorized data access, no silent overwrite, immutable recoverable history, safe invitation use, and stable editor behavior. Test fidelity matters more than raw count.

## Layers

### Contract Tests

In `packages/contracts`, test every request/response schema with valid examples, boundary values, unknown fields, malformed IDs, oversized text, invalid roles, pagination limits, and error-envelope compatibility.

### Domain Unit Tests

Test pure permission policies, email/name normalization, size checks, invitation state transitions, error mapping, and Vditor-independent editor state. Inject clocks and token generators; do not mock the behavior under test.

### API Integration Tests

Use Fastify injection with the real application composition and a disposable real MySQL schema. Cover:

- registration/login generic errors, session rotation/revocation, CSRF, origin checks, and rate limits;
- owner/editor/viewer/unauthenticated action matrix;
- cross-user tree and document isolation;
- atomic save creation and head advancement;
- two concurrent saves from one base, with exactly one success and one `409`;
- restore creating a new revision without changing old revisions;
- invitation expiry, email match, single use, duplicate/revoked invitations, and role changes;
- folder cycles, active-name uniqueness under MySQL null/collation behavior, subtree trash/restore, and limits;
- response schema validation and secret/content log redaction.

Do not substitute SQLite for MySQL transaction, collation, unique-index, or locking tests.

### Web Component Tests

Use Vitest, Testing Library, and a DOM environment. Mock the HTTP boundary, not React internals. Cover:

- Vditor initializes once per mount, switches documents safely, and destroys listeners/instances;
- dirty state, `Ctrl+S`/`Cmd+S`, saving, success, failure, and disabled/read-only controls;
- background queries do not replace unsaved text;
- conflict dialog preserves local text and offers reload/copy/compare paths;
- navigation and tab-close warnings when dirty;
- permission-based presentation while assuming the API remains authoritative;
- keyboard tree navigation, focus restoration, labels, dialog traps, and announcements.

### End-To-End Tests

Use Playwright against built web/API applications and isolated MySQL data. Critical journeys:

1. Register, create folders/document, edit, save, reload, and observe content.
2. Save multiple revisions, inspect history, restore one, and verify a new head.
3. Owner invites editor; editor accepts and saves; owner sees attribution.
4. Two browser contexts edit one base; first save succeeds and second gets conflict without text loss.
5. Owner revokes editor; editor's already-open page can no longer save or refetch content.
6. Viewer can read but cannot mutate through UI or direct request.
7. Trash and restore a folder subtree; permanently delete with confirmation.

Run Chromium on every pull request and add Firefox/WebKit in scheduled or release workflows. Include desktop and narrow mobile viewport checks even though native mobile is out of scope.

### Security And Operational Tests

- Stored-XSS fixture corpus through Markdown preview and history views
- CSRF with missing/invalid token and disallowed origin
- Cookie attributes and cache-control for authenticated/private responses
- Credential stuffing and invitation/save rate limits
- Dependency, license, and secret scans
- Migration from previous release schema with rollback/forward-fix rehearsal
- Backup restore drill and point-in-time recovery validation
- Load tests for tree reads, document fetches, saves, and history pagination

## Focused Concurrency Test

Create a document at revision 1. Start two independent API requests with the same `baseRevisionId` and different content. Synchronize them close enough to overlap. Assert:

- one response is `200`, one is `409 REVISION_CONFLICT`;
- the document head points to the successful revision;
- only one new ordinal exists;
- the losing content is not persisted as head or silently substituted;
- all committed revisions remain immutable.

Repeat enough times in MySQL CI to expose race behavior, but keep one deterministic service-level locking test for fast feedback.

## Quality Gates

### Pull Request

- Formatting, lint, typecheck, contract/unit tests
- Affected API integration tests against MySQL
- Affected web tests
- Critical Playwright subset for cross-cutting user flows
- Migration and generated-client consistency

### Main And Release

- Full integration and end-to-end suite
- Browser matrix and accessibility scan
- Dependency/secret scan
- Migration rehearsal on representative data
- Performance smoke thresholds

### Production Launch

- Complete authorization matrix and conflict suite
- Threat-model sign-off and stored-XSS/CSRF verification
- Backup restore drill meeting approved RPO/RTO
- Alerts, dashboards, runbooks, and rollback/forward-fix procedure
- No unresolved critical/high security issues

## Test Data Rules

Use factories with synthetic users and Markdown. Never import production documents, emails, tokens, or credentials. Each test owns its records and cleanup strategy. Make time deterministic where expiry matters and use cryptographically shaped but non-secret fixture tokens.

## Coverage Guidance

Coverage is a signal, not the gate by itself. Require branch coverage on authorization policies, revision conflict paths, invitation transitions, and error mapping. A risk path without a meaningful assertion is a release blocker even if line coverage is high.
