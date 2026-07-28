# Security And Privacy

## Assets And Trust Boundaries

Protected assets include Markdown content and history, account identity, permissions, invitations, sessions, audit evidence, and backups. The browser, email links, reverse proxy, API, MySQL, SMTP provider, logs, CI, and administrator access are separate trust boundaries.

Primary threats are credential stuffing, account/session theft, CSRF, stored XSS through Markdown, broken object-level authorization, invitation theft, email/account enumeration, stale-write data loss, denial of service through large content/tree operations, dependency compromise, secret leakage, and destructive operator mistakes.

## Authentication

- Normalize email deterministically for lookup and uniqueness. Avoid provider-specific dot or plus rewriting.
- Hash passwords with Argon2id using parameters benchmarked on production hardware and stored in the encoded hash. Initial target: at least 19 MiB memory, 2 iterations, parallelism 1; increase toward OWASP guidance while keeping acceptable latency.
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
- Never place session, invitation, verification, or reset tokens in logs, analytics, referrer-leaking pages, or browser storage.

## Authorization

- Enforce access in domain services for every document query and mutation. Route guards provide authentication context, not complete authorization.
- Query by actor and permission where possible to avoid time-of-check/time-of-use gaps and ID enumeration.
- Owner-only actions: hierarchy changes, trash/permanent delete, invite, role change, and revoke.
- Editor actions: current read, save, permitted history read, and restore.
- Viewer actions: current read only by default.
- Revalidate access inside save/invitation transactions. Cached client data never grants rights.
- Revocation takes effect immediately at the API. Future WebSocket rooms must also disconnect revoked users.

## Markdown And Browser Security

- Treat Markdown as untrusted content. Disable raw HTML by default and sanitize rendered output with a maintained allowlist sanitizer.
- Block dangerous URL schemes, inline event handlers, executable SVG, iframes, scripts, forms, and style injection.
- Use a restrictive Content Security Policy with no `unsafe-eval`; avoid `unsafe-inline` through nonces/hashes if Vditor permits.
- Set `X-Content-Type-Options: nosniff`, an appropriate `Referrer-Policy`, frame restrictions, and `Permissions-Policy`.
- Avoid rendering collaborator names, filenames, or error details as HTML.
- Pin and audit Vditor behavior when upgrading; add sanitization regression fixtures.

## Input And Abuse Limits

Initial proposals, configurable after measurement:

- Markdown content: 2 MiB UTF-8 per save
- Filename/folder name: 255 Unicode characters after normalization checks
- Save message: 500 characters
- Folder depth: 20
- Page size: default 50, maximum 100
- Active invitations: 100 per owner and 20 per document
- Request body: route-specific; never an unbounded global parser

Enforce limits in Zod and at transport/database boundaries. Rate-limit authentication, invitation, save, tree mutation, and permanent deletion separately. Time out requests and database queries; cap connection pools per API instance.

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
