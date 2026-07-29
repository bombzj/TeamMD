# Milkdown Collaboration Migration Plan

## Goal

Replace the live split source/preview canvas with one rendered-in-place Milkdown editor while preserving Yjs convergence, authenticated awareness, immutable Markdown checkpoints, restore safety, and every existing revision.

## Delivery Slices

1. **State contract:** add `stateFormat`, editor protocol negotiation, legacy detection, and stable incompatibility errors.
2. **Codec:** implement pinned server/client parsing and serialization for `MILKDOWN_XML_V1`; lock supported Markdown with a round-trip corpus and size benchmarks.
3. **Conversion:** serialize room access, preserve the complete legacy draft, create fresh structured state, atomically persist format plus generation, and disconnect old clients.
4. **Editor adapter:** replace CodeMirror/Vditor live preview with Milkdown, bind the negotiated fragment and awareness, preserve connection/permission/dirty/checkpoint/restore behavior, and add rendered editing controls.
5. **Checkpoint and restore:** serialize authoritative structured state on the server, restore Markdown into a fresh structured document, and retain hash/checkpoint broadcasts.
6. **Rollout:** reject lossy conversions without changing the legacy room, surface the incompatibility instead of opening a second writable root, instrument conversion failures/state sizes, and run two-browser and accessibility gates before default rollout.

## Non-Negotiable Gates

- No client-submitted Markdown or HTML in collaborative Save.
- No mixed writable roots in one room.
- No automatic conversion when semantic Markdown fidelity fails.
- No mutation of existing immutable revisions.
- Viewer updates remain server-rejected; revocation and restore force reauthorization.
- Full lint, typecheck, unit/integration tests, production build, two-browser convergence, IME, and narrow viewport validation pass before default rollout.
