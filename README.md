# TeamMD

TeamMD is an online Markdown workspace with email/password accounts, personal folders, explicit immutable revision checkpoints, and document sharing. TeamMD uses Milkdown for rendered-in-place Markdown editing with a native Yjs collaboration binding. Vditor remains the sanitized static renderer for immutable history and public documents.

The repository includes a runnable React application, shared Zod contracts, a Fastify API with built-in versioned scrypt and revocable cookie sessions, reviewed MySQL migrations, and a Yjs/Hocuspocus collaboration gateway. Registered users can organize documents, edit the same document concurrently, create and restore explicit revision checkpoints, share documents directly with other registered accounts, and publish revocable read-only links to the current saved revision. Tokenized invitations for unregistered email recipients remain planned.

## MVP At A Glance

- Email/password registration, login, logout, and revocable sessions
- Personal hierarchical folders and Markdown documents
- Rendered-in-place Milkdown/Yjs editing with rich formatting, Undo/Redo, full-screen mode, and explicit Save states
- Immutable revision snapshots with history and restore
- Direct document sharing with `owner`, `editor`, or `viewer` access
- Owner-managed, revocable public links to the current saved revision
- CRDT convergence without whole-document last-write-wins replacement
- Trash and restore for documents and folders

CRDT-based simultaneous editing is implemented. The current CodeMirror binding is being replaced by Milkdown's ProseMirror/Yjs binding so formatting renders in the writable surface without a separate live preview. The Yjs awareness channel provides an ephemeral participant count and remote selections/cursors. Public links are read-only, expose no private hierarchy or collaborator metadata, and never publish unsaved Yjs drafts. Comments, durable offline-first editing, pending-email invitations, and native applications remain later phases.

Transient network interruptions are handled by Hocuspocus reconnect and durable server-side Yjs state. True offline-first editing is intentionally deferred: it requires persistent browser-side Yjs storage, bounded offline queues, generation-aware restore and revocation handling, and tested reconciliation before it can meet TeamMD's no-data-loss standard.

## Stack

| Area          | Choice                                                       |
| ------------- | ------------------------------------------------------------ |
| Web           | React 19, Vite, TypeScript, Milkdown, Vditor, TanStack Query |
| Collaboration | Yjs, Hocuspocus, Milkdown collaboration plugin               |
| API           | Node.js 22 LTS, Fastify, TypeScript, Zod                     |
| Data          | MySQL 8.4, Prisma migrations                                 |
| Auth          | Argon2id, opaque cookie sessions, CSRF protection            |
| Tests         | Vitest and Fastify injection                                 |
| Workspace     | pnpm monorepo                                                |

## Repository Layout

```text
apps/
  web/                 Browser UI, collaborative editor, and Vditor preview
  api/                 HTTP API, collaboration gateway, and services
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
pnpm --filter @teammd/api prisma:migrate
pnpm dev
```

Set `DATABASE_URL` in the ignored `.env.local` file before running migrations. The local least-privilege database user applies reviewed migrations with `prisma migrate deploy`; it does not need permission to create Prisma shadow databases.

Local endpoints:

- Web: `http://localhost:5173`
- API: `http://localhost:3000`
- Collaboration WebSocket: `ws://localhost:3001`

## Documentation

- `docs/product-requirements.md`: scope, requirements, and acceptance criteria
- `docs/architecture.md`: components, flows, and dependency boundaries
- `docs/data-model.md`: entities, constraints, and revision semantics
- `docs/api-contract.md`: HTTP and collaboration contract
- `docs/security.md`: threat model and controls
- `docs/development.md`: setup and contribution workflow
- `docs/testing-strategy.md`: test pyramid and quality gates
- `docs/roadmap.md`: implementation phases
