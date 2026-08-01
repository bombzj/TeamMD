# Development Guide

The repository contains runnable web, API, and collaboration services. Product and production-readiness work continues against the phased roadmap.

## Prerequisites

- Node.js 22 LTS or newer supported 22.x release
- pnpm 10 through Corepack
- MySQL 8.4 with an empty development schema

Enable the pinned package manager:

```powershell
corepack enable
corepack prepare pnpm@10.13.1 --activate
```

## Local Configuration

Use `.env.local` for workstation settings. It is ignored by Git. Start from `.env.example` on a new machine and set a complete Prisma MySQL URL:

```text
DATABASE_URL=mysql://USER:PASSWORD@localhost:3306/teammd
```

URL-encode reserved characters in username/password. Do not use a production credential, commit the file, or print it in diagnostics. Use a non-root MySQL account with privileges limited to the local `teammd` schema.

`DATABASE_URL` is Prisma's connection source. The individual `MYSQL_*` fields are available to local tooling and must describe the same database.

`VITE_MERMAID_RENDERING_ENABLED` is public build-time web configuration and accepts only `true` or `false`. It defaults to `true`. Set it to `false` and rebuild the web artifact to suppress derived Mermaid diagrams and visual controls while leaving every Mermaid fence editable and unchanged. This rollback does not require a database migration or collaboration-state conversion.

## Bootstrap

```powershell
pnpm install
pnpm --filter @teammd/api prisma:generate
pnpm --filter @teammd/api prisma:migrate
pnpm dev
```

Local endpoints are web `http://localhost:5173`, API `http://localhost:3000`, and collaboration WebSocket `ws://localhost:3001`.

## Commands

| Command                          | Purpose                                |
| -------------------------------- | -------------------------------------- |
| `pnpm dev`                       | Run workspace development processes    |
| `pnpm build`                     | Build all packages in dependency order |
| `pnpm typecheck`                 | Typecheck all packages                 |
| `pnpm lint`                      | Lint all packages                      |
| `pnpm test`                      | Run package tests                      |
| `pnpm format:check`              | Check formatting                       |
| `pnpm --filter @teammd/api test` | Run API tests only                     |
| `pnpm --filter @teammd/web test` | Run web tests only                     |

Prefer the narrowest package command while iterating, followed by root checks for cross-cutting changes.

Opt-in editor, Mermaid, Yjs-size, and codec performance smoke tests run with `TEAMMD_PERFORMANCE_SMOKE=true` against the focused performance test files. They are intentionally skipped by ordinary unit-test runs because timings depend on the host. Run them on the release environment before broad rollout and compare metrics without logging document content.

## Database Workflow

1. Update `apps/api/prisma/schema.prisma` and the data-model documentation together.
2. Generate a named migration against local MySQL.
3. Review SQL for collation, indexes, foreign keys, locking, table rewrites, and destructive operations.
4. Run migration and integration tests against a clean schema and an upgraded representative schema.
5. Commit schema and migration together; never edit an already-applied shared migration.

The local runtime account is intentionally unable to create Prisma shadow databases. Generate migration SQL for review with `prisma migrate diff`, check it into a timestamped migration directory, and apply it with `prisma migrate deploy`. If a separate development migration account is introduced later, it may use `prisma migrate dev` with an isolated shadow database. Never use `prisma db push` outside disposable experimentation.

## Implementation Conventions

- Keep route handlers thin: parse contract, call one use case, serialize contract.
- Keep authorization and transaction logic in API domain services.
- Pass explicit dependencies such as clock, token generator, hasher, email sender, and repositories to services where useful for deterministic tests.
- Keep Milkdown, Yjs, and Hocuspocus behind a React adapter that owns connection, awareness, binding, reconnect tickets, read-only transitions, Markdown serialization, and teardown.
- Route visible editor commands through the mounted Milkdown/ProseMirror command path. Collaborative Undo/Redo must use the active Yjs history, while standalone fallback uses ProseMirror history; never maintain a parallel React content history.
- Use Milkdown's collaboration plugin and one versioned `Y.XmlFragment` as the only writable live surface. Do not synchronize whole Markdown strings or mount a second writable editor.
- Use Vditor only for sanitized static history/public rendering. It must not be writable in a collaborative room.
- Pin the Milkdown schema, parser, serializer, and collaboration packages together. A schema change requires a state-format compatibility review and Markdown round-trip corpus.
- Keep Mermaid rendering behind the existing fenced-code preview hook. First-class Diagram controls must insert the same code node with exact lowercase `mermaid` identity and canonical starter source; the code-language picker may display `Mermaid`. Markdown source remains authoritative; generated SVG is compact, responsive, strict, sanitized, bounded, disposable, and must never enter Yjs, API payloads, revisions, or logs. Any visual diagram node view must update that source node rather than maintain parallel writable graph state.
- Keep the API's hidden Milkdown codec editor and JSDOM globals alive for the process lifetime. Milkdown serializers and delayed lifecycle work retain that context; early teardown can crash later requests.
- Use TanStack Query for HTTP server state. Yjs owns the shared draft; never replace it from a background refetch.
- Use stable error codes and exhaustive client handling for save conflicts and authentication expiry.
- Validate environment once at startup and fail with names of invalid variables, never their secret values.

## Pull Request Checklist

- Requirement and owning module are identified.
- Shared contract changed before or with consumers.
- Authorization and negative tests cover the changed action.
- Persistence writes are atomic and migration implications are reviewed.
- Logs and errors contain no content or secrets.
- Accessibility behavior is tested for UI changes.
- Relevant docs, `.env.example`, and ADRs are current.
- Narrow tests, package typecheck/lint, and required root checks pass.

## Production Deployment

Production releases are anchored to Git but do not fetch mutable branch state directly into the live application directory.

1. Run the required tests, typecheck, lint, formatting, and production build locally or in CI.
2. Commit the complete release change and push it to the canonical remote.
3. Verify the local worktree is clean, the local commit equals the remote branch commit, and record the full commit SHA.
4. Build from that exact commit in a clean checkout or CI workspace. Do not deploy artifacts built from uncommitted files.
5. Stage the artifact outside the live path, verify its file count and cryptographic hash, then atomically replace the live release while retaining the previous release for rollback.
6. Apply reviewed database migrations before starting code that requires them. Never use schema push in production.
7. Verify health, readiness, static assets, WebSocket upgrades, and service state after the release.
8. Record the source commit, artifact hash, migration state, and rollback path in a non-secret deployment manifest.

The server should not require GitHub during normal startup or rollback. Git provides source provenance and reproducibility; immutable built artifacts, checksums, configuration management, and retained releases provide runtime reliability. Never place production credentials in Git or in deployment manifests.

## Troubleshooting Principles

- Reproduce database behavior against MySQL, not an in-memory substitute.
- Include request ID and stable error code in bug reports, but redact headers, cookies, tokens, email addresses, and Markdown content.
- Do not “fix” a conflict by adding force overwrite. Confirm the submitted and current revision IDs and preserve both users' text.
- If documentation and code disagree on authorization, saving, or retention, stop implementation and resolve the design discrepancy explicitly.
