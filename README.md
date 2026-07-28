# MyMD

MyMD is a planned online Markdown workspace built around Vditor. Users will be able to register with email and password, organize Markdown documents in folders, explicitly save immutable revisions, share selected documents, and review or restore history.

The repository now includes a runnable authentication slice: shared Zod contracts, a Fastify API with Argon2id and revocable cookie sessions, MySQL migrations, and responsive React sign-in/register screens. Files, folders, Vditor editing, revisions, and invitations remain planned implementation phases.

## MVP At A Glance

- Email/password registration, login, logout, and revocable sessions
- Personal hierarchical folders and Markdown documents
- Vditor editing with explicit Save and clear dirty/saving/saved/conflict states
- Immutable revision snapshots with history and restore
- Document invitations and `owner`, `editor`, or `viewer` access
- Optimistic concurrency that rejects stale saves instead of overwriting them
- Trash and restore for documents and folders

Live cursors, presence, comments, offline editing, mobile-native apps, public links, and CRDT-based simultaneous editing are later phases.

## Planned Stack

| Area      | Choice                                             |
| --------- | -------------------------------------------------- |
| Web       | React 19, Vite, TypeScript, Vditor, TanStack Query |
| API       | Node.js 22 LTS, Fastify, TypeScript, Zod           |
| Data      | MySQL 8.4, Prisma migrations                       |
| Auth      | Argon2id, opaque cookie sessions, CSRF protection  |
| Tests     | Vitest, Fastify injection, Playwright              |
| Workspace | pnpm monorepo                                      |

## Repository Layout

```text
apps/
  web/                 Browser UI and Vditor integration
  api/                 HTTP API and application services
packages/
  contracts/           Shared Zod contracts and types
  config/              Validated environment configuration
docs/
  decisions/           Architecture decision records
```

See `AGENTS.md` for engineering rules and `docs/roadmap.md` for the delivery sequence.

## Local Setup

Prerequisites are Node.js 22+, pnpm 10+, and access to MySQL 8.4 at the configured host.

```powershell
Copy-Item .env.example .env.local
pnpm install
pnpm --filter @mymd/api prisma:migrate
pnpm dev
```

Set `DATABASE_URL` in the ignored `.env.local` file before running migrations. The local least-privilege database user applies reviewed migrations with `prisma migrate deploy`; it does not need permission to create Prisma shadow databases. Email delivery uses a configurable SMTP service and is not required for the initial authentication slice.

Planned local endpoints:

- Web: `http://localhost:5173`
- API: `http://localhost:3000`

## Documentation

- `docs/product-requirements.md`: scope, requirements, and acceptance criteria
- `docs/architecture.md`: components, flows, and dependency boundaries
- `docs/data-model.md`: entities, constraints, and revision semantics
- `docs/api-contract.md`: planned HTTP contract
- `docs/security.md`: threat model and controls
- `docs/development.md`: setup and contribution workflow
- `docs/testing-strategy.md`: test pyramid and quality gates
- `docs/roadmap.md`: implementation phases
