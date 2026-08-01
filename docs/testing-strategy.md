# Testing Strategy

## Goals

Tests protect the highest-risk properties: no unauthorized data access, convergent collaboration, no silent data loss, immutable recoverable checkpoints, safe sharing, and stable editor behavior. Test fidelity matters more than raw count.

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
- existing-account email match, owner-only grants, role changes, room invalidation, and revocation;
- owner-only public-link create/rotate/revoke, hash-only storage, current-revision resolution, hidden-ancestor rejection, and generic invalid-token behavior;
- folder cycles, active-name uniqueness under MySQL null/collation behavior, subtree trash/restore, and limits;
- response schema validation and secret/content log redaction.
- one-time collaboration ticket expiry/reuse, viewer read-only enforcement, two-provider convergence, checkpoint exactness, and restart recovery.

Do not substitute SQLite for MySQL transaction, collation, unique-index, or locking tests.

### Web Component Tests

Use Vitest, Testing Library, and a DOM environment. Mock the HTTP boundary, not React internals. Cover:

- the Milkdown/Yjs adapter initializes once, obtains fresh reconnect tickets, binds one `Y.XmlFragment`, and destroys provider/listeners/instances;
- awareness changes update participant count and trusted ephemeral cursor/selection identity;
- rendered Markdown is directly editable without a second live preview, while Vditor remains read-only for static history/public content;
- read-only mode, IME composition, visible Undo/Redo through the active Yjs or ProseMirror history, clipboard Markdown, tables, code blocks, links, and narrow viewports remain stable;
- rich editor controls expose names and tooltips, pointer-driven block/link actions and code-language search receive semantic keyboard activation and visible focus, language entries use listbox option semantics, and mutation controls stay hidden from viewers;
- exact Mermaid-fence detection, source and line limits, strict SVG sanitization, same-document SVG reference integrity, post-style fitted geometry, Gantt duplicate-label normalization, bounded errors, serialized rapid updates, render timeout, teardown cancellation, source/preview toggling, and source-preserving Markdown serialization;
- browser screenshot checks across flowchart, sequence, class, state, ER, pie, journey, Gantt, and mindmap diagrams for readable labels and marks, contained geometry, preview-local scrolling for wide timelines, and no page overflow;
- full-screen entry and Escape/visible-control exit preserve the mounted Milkdown/Yjs editor, unsaved draft, transport state, and body scroll cleanup;
- shared-draft dirty state, `Ctrl+S`/`Cmd+S`, checkpoint success/failure, transport status, and viewer controls;
- background queries do not replace Yjs state and checkpoint notices do not mark later concurrent edits as saved;
- restore control events force an authorized refetch and a fresh Yjs document while ending at a clean saved revision;
- public fragment routing skips session bootstrap, strips the bearer from the address bar, performs one resolver request under React Strict Mode, and renders no writable controls;
- navigation and tab-close warnings when dirty;
- permission-based presentation while assuming the API remains authoritative;
- keyboard tree navigation, focus restoration, labels, dialog traps, and announcements.

### End-To-End Tests

Use Playwright against built web/API applications and isolated MySQL data. Critical journeys:

1. Register, create folders/document, edit, save, reload, and observe content.
2. Save multiple revisions, inspect history, restore one, and verify a new head.
3. Owner grants an existing account editor access; editor opens the shared document and saves; owner sees the checkpoint.
4. Two browser contexts edit concurrently, converge, and observe the same explicit checkpoint without text loss.
5. Both contexts show the current participant count and authenticated remote selections without accepting spoofed awareness identity.
6. Owner revokes editor; editor's already-open page can no longer save or refetch content.
7. Viewer can read but cannot mutate through UI or direct request.
8. Trash and restore a folder subtree; permanently delete with confirmation.
9. Create a public link, open it in an isolated anonymous context, verify only the current saved revision, rotate/revoke it, and verify the old token becomes generically unavailable.
10. Add and concurrently edit a Mermaid fence, verify both clients converge on identical source, checkpoint it, and confirm editor, history, and public previews derive sanitized diagrams without persisting SVG.

Run Chromium on every pull request and add Firefox/WebKit in scheduled or release workflows. Include desktop and narrow mobile viewport checks even though native mobile is out of scope.

### Security And Operational Tests

- Stored-XSS fixture corpus through Markdown preview and history views
- Public-link token leakage checks across URLs, logs, referrers, caches, error responses, and browser persistence
- CSRF with missing/invalid token and disallowed origin
- Cookie attributes and cache-control for authenticated/private responses
- Credential stuffing and invitation/save rate limits
- Dependency, license, and secret scans
- Migration from previous release schema with rollback/forward-fix rehearsal
- Backup restore drill and point-in-time recovery validation
- Load tests for tree reads, document fetches, saves, and history pagination

## Focused Collaboration Test

Create a document at revision 1 and connect two independent Yjs providers. Apply concurrent edits and assert:

- both clients converge to byte-identical Markdown;
- viewer-originated updates do not mutate the room;
- explicit Save checkpoints the authoritative room snapshot exactly once;
- all clients receive the same new revision metadata;
- operational state reloads after a collaboration-server restart;
- edits after the captured checkpoint remain visibly unsaved.

Repeat enough times in MySQL CI to expose race behavior, but keep one deterministic service-level locking test for fast feedback.

## Rendered Editor Migration Gate

Before converting legacy rooms automatically, run a Markdown corpus through parse/serialize and assert semantic equivalence for headings, emphasis, links, images, blockquotes, nested lists, task lists, tables, fenced code, inline code, escapes, Unicode, and line endings. Verify that a legacy room with an unsaved shared draft converts atomically to `MILKDOWN_XML_V1`, increments generation, rejects legacy clients, converges in two browsers, checkpoints the server serialization, restores into a fresh structured document, and leaves all previous revisions byte-identical.

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
