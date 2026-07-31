# Security And Privacy

## Assets And Trust Boundaries

Protected assets include Markdown content and history, account identity, permissions, public-link and invitation bearer tokens, sessions, audit evidence, and backups. The browser, public/email links, reverse proxy, API, MySQL, SMTP provider, logs, CI, and administrator access are separate trust boundaries.

Primary threats are credential stuffing, account/session theft, CSRF, stored XSS through Markdown, broken object-level authorization, bearer-link theft, email/account enumeration, stale-write data loss, denial of service through large content/tree operations, dependency compromise, secret leakage, and destructive operator mistakes.

## Authentication

- Normalize email deterministically for lookup and uniqueness. Avoid provider-specific dot or plus rewriting.
- Hash passwords with Node's built-in `scrypt` using a random 16-byte salt, a 32-byte derived key, and a versioned encoded format. The initial parameters are `N=32768`, `r=8`, `p=1`, and a 64 MiB memory bound; benchmark and increase them while keeping acceptable latency. This avoids a native authentication dependency on the legacy deployment host. Existing Argon2 hashes require an explicit migration before this format is deployed over populated user data.
- Require a minimum password length of 12 and allow at least 128 characters, spaces, paste, and password managers. Do not require composition tricks.
- Check new passwords against a breached-password service or offline corpus before public launch without sending the raw password.
- Return generic registration/login/reset messages where account existence could leak.
- Rate-limit by IP-derived key and normalized account key with progressive backoff. Preserve accessibility and recovery paths.
- Email verification and password reset tokens use at least 256 bits of randomness, are hashed at rest, expire, and are single-use. Implement before public launch unless risk acceptance explicitly says otherwise.

## Sessions And CSRF

- Generate opaque 256-bit session tokens from a cryptographic RNG. Store only a hash and rotate on login, privilege-sensitive events, and password reset.
- Deliver the token in a `__Host-` cookie with `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/` in production.
- Require a session-bound CSRF token and strict `Origin`/`Referer` validation for every mutation. CORS allows only configured origins with credentials.
- Recheck expiry, revocation, disabled user state, and session epoch server-side.
- Support current-session logout, individual session revocation, and logout-all. Password reset revokes all existing sessions.
- Never place session, public-link, invitation, verification, or reset tokens in logs, analytics, referrer-leaking pages, or persistent browser storage.

## Authorization

- Enforce access in domain services for every document query and mutation. Route guards provide authentication context, not complete authorization.
- Query by actor and permission where possible to avoid time-of-check/time-of-use gaps and ID enumeration.
- Owner-only actions: hierarchy changes, trash/permanent delete, grant, role change, and revoke.
- Editor actions: current read, save, permitted history read, and restore.
- Viewer actions: current read only by default.
- Revalidate access inside save and sharing transactions. Cached client data never grants rights.
- WebSocket authentication uses short-lived one-time tickets bound to the authenticated session, user, and document. Access is revalidated when each ticket is consumed.
- Grant, role change, and revocation close the active document room. Every reconnect requires a fresh ticket and current API authorization, so revoked users cannot retain an already-open socket.

## Public-Link Security

- Public links are bearer credentials with at least 256 bits of cryptographic randomness. Store only a SHA-256 token hash and compare by indexed hash lookup.
- Put the raw token in the URL fragment, never the path or query string. The public page removes the fragment from the address bar before sending the token in a JSON POST body to one fixed resolver endpoint.
- Return the raw token only when creating or rotating a link. Status endpoints expose only enabled state and creation time; they cannot recover an existing token.
- Public resolution is read-only, rate-limited, and `private, no-store`. Invalid, revoked, trashed, and hidden resources use one generic not-found response.
- Expose only document name, current saved Markdown, and current revision summary. Never expose Yjs drafts, history, owner identity, collaborators, or folder hierarchy.
- Rotation invalidates the previous token; revocation deletes the token hash. Link management is owner-only, CSRF-protected, origin-validated, and audited.

## Markdown And Browser Security

- Treat Markdown as untrusted content. Disable raw HTML by default and sanitize rendered output with a maintained allowlist sanitizer.
- Block dangerous URL schemes, inline event handlers, executable SVG, iframes, scripts, forms, and style injection.
- Use a restrictive Content Security Policy with no `unsafe-eval`; avoid `unsafe-inline` through nonces/hashes if Vditor permits.
- Set `X-Content-Type-Options: nosniff`, an appropriate `Referrer-Policy`, frame restrictions, and `Permissions-Policy`.
- Avoid rendering collaborator names, filenames, or error details as HTML.
- Pin and audit Vditor behavior when upgrading; add sanitization regression fixtures.
- Treat Milkdown/ProseMirror document content, links, images, code, and plugin attributes as untrusted. Disable raw HTML and unsafe URL schemes in the writable schema, and never persist rendered HTML as a revision.
- Serialize collaborative checkpoints to Markdown on the trusted server using the same pinned schema version as the client. Reject malformed or unsupported structured state rather than accepting client-supplied Markdown projections.
- Treat Mermaid source and generated SVG as untrusted. Initialize Mermaid with strict security and HTML labels disabled, render only exact `mermaid` fences, sanitize SVG again with links, scripts, HTML integration points, event/style attributes, and style elements forbidden, and never persist generated output.

## Input And Abuse Limits

Initial proposals, configurable after measurement:

- Markdown content: 2 MiB UTF-8 per save
- Mermaid preview source: 64 KiB UTF-8 and 500 nonblank lines per diagram, one render at a time per editor, and a 3-second result timeout
- Filename/folder name: 255 Unicode characters after normalization checks
- Save message: 500 characters
- Public-link token: exactly 43 URL-safe base64 characters
- Folder depth: 20
- Page size: default 50, maximum 100
- Active invitations: 100 per owner and 20 per document
- Request body: route-specific; never an unbounded global parser

Enforce limits in Zod and at transport/database boundaries. Rate-limit authentication, public-link resolution/management, invitation, save, tree mutation, and permanent deletion separately. Time out requests and database queries; cap connection pools per API instance.

## Secrets And Development Credentials

- `.env.local` is ignored and may contain local-only credentials. It must never be copied to documentation, tests, screenshots, logs, or commits.
- `.env.example` contains placeholders only.
- Production secrets come from a managed secret store with least-privilege service identities and rotation procedures.
- Database users are environment-specific, are not root, and have only required schema privileges. Migration credentials are separate from runtime credentials in production.
- CI uses short-lived or isolated credentials and secret scanning.

## Logging, Audit, And Privacy

- Application logs omit document content, request bodies, passwords, emails where not needed, cookies, CSRF values, and all raw tokens.
- Use opaque actor/resource IDs and stable action/result codes. Restrict and audit access to logs and audit events.
- Define retention for logs, audit events, invitation metadata, disabled accounts, deleted documents, and backups before production.
- Provide data export and deletion procedures aligned with applicable law and backup retention.
- Do not use document content for analytics or model training without explicit informed consent and a separate policy.

## Database, Backups, And Operations

- Require TLS to production MySQL, encrypted disks/backups, private networking, and least-privilege accounts.
- Use reviewed Prisma migrations; production migrations run through controlled deployment, not API startup.
- Take daily encrypted backups and enable point-in-time recovery. Set target objectives before launch; initial proposal is RPO 15 minutes and RTO 4 hours.
- Perform restore drills at least quarterly and before major destructive migrations.
- Alert on auth spikes, authorization failures, unusual invitation/save rates, elevated conflicts, backup failures, and pool saturation.
- Maintain incident response contacts, token/session revocation procedures, dependency patching cadence, and an audit-preservation process.

## Security Release Gate

Before public production, complete threat-model review, dependency/secret scans, authorization matrix tests, CSRF and stored-XSS tests, rate-limit verification, secure-header review, migration rehearsal, backup restore drill, and an independent penetration test or documented risk-based equivalent.
