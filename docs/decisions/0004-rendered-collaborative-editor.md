# ADR 0004: Milkdown Rendered Collaborative Editor

- **Status:** Accepted; migration in progress
- **Date:** 2026-07-29
- **Supersedes:** The editor-surface choice in ADR 0002; its Yjs, authorization, awareness, checkpoint, and generation decisions remain in force

## Context

Users expect formatting to render in the writable surface as they type, without a separate source/preview canvas. Vditor's IR and WYSIWYG modes provide that visual behavior, but Vditor 3.11.2 exposes whole-document Markdown and private transformed `contenteditable` internals rather than a stable positional transaction API. Binding Yjs to those internals would make selection, IME, undo, and concurrent merge behavior version-specific and unsafe.

Milkdown is a Markdown-focused ProseMirror editor with an official Yjs collaboration plugin. It supports rendered-in-place editing, awareness cursors, collaborative undo, read-only mode, Markdown parsing/serialization, tables, task lists, links, code blocks, and extensible controls.

## Decision

1. Use Milkdown as the sole writable live editor and bind its ProseMirror document to one versioned Yjs `XmlFragment`.
2. Keep Hocuspocus, one-time authenticated tickets, server-owned awareness identity, explicit immutable checkpoints, and room-generation resets.
3. Keep immutable revisions as canonical Markdown. The server serializes the authoritative structured room; clients never submit checkpoint Markdown or HTML.
4. Add `stateFormat` and editor-protocol negotiation. Existing rooms are `LEGACY_TEXT_V1`; the target is `MILKDOWN_XML_V1`.
5. Convert a legacy room only while serialized at the room boundary. Preserve its complete shared draft, verify Markdown fidelity, create a fresh Yjs document, increment generation, and reject incompatible clients.
6. Pin the Milkdown schema/parser/serializer across browser and server. Schema changes require compatibility review and a new state format when needed.
7. Keep Vditor only for sanitized static history and public-document rendering during this migration.
8. Disable raw HTML and unsafe URL schemes in the writable schema. Rendered DOM is never revision or API data.

## Consequences

- Editing becomes rendered-in-place while retaining native character/block convergence and remote selections.
- Live state becomes structured and larger than plain `Y.Text`; socket and persistence limits require measurement and enforcement.
- Markdown serialization can normalize insignificant syntax. The supported flavor needs a semantic round-trip corpus, and unsupported documents cannot be converted silently.
- The API must understand the pinned document schema to checkpoint and validate authoritative rooms.
- Existing revisions remain untouched and portable.

## Rejected Alternatives

- **Use Vditor IR as the collaborative editor:** rejected because it lacks a supported Yjs transaction/selection binding and would require whole-document replacement or private DOM integration.
- **Synchronize Vditor's whole Markdown value through `Y.Text`:** rejected because concurrent rich-editor replacements disrupt merge, cursor, composition, and undo semantics.
- **Decorate CodeMirror to imitate WYSIWYG:** rejected as the primary direction because complex blocks such as tables, nested lists, and media remain source-oriented and do not meet the requested editing experience.
- **Run both source and rich editors as writable surfaces:** rejected because two projections create feedback loops, ambiguous undo, selection loss, and divergent state ownership.
