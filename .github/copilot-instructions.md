# TeamMD Copilot Instructions

- Treat `AGENTS.md` as the authoritative engineering guide.
- Read the relevant file in `docs/` before changing architecture, APIs, security, or persistence.
- Keep the TypeScript monorepo boundaries intact: `apps/web`, `apps/api`, `packages/contracts`, and `packages/config`.
- Validate all request and response boundaries with shared Zod schemas.
- Enforce authorization in the API; client-side checks are presentation only.
- Model every successful document save as an immutable revision and reject stale writes.
- Preserve Yjs real-time collaboration while keeping explicit immutable checkpoints as the only saved-history boundary.
- Add focused tests for changed behavior and run the narrowest relevant validation command.
- Do not commit secrets or real credentials. Keep `.env.example` synchronized with required settings.
