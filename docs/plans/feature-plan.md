# Rich Editor And Mermaid Feature Plan

## Objective

Make TeamMD's Milkdown editor feel complete for everyday Markdown authoring while preserving the existing collaboration, immutable revision, authorization, and Markdown fidelity guarantees. Add Mermaid diagrams as portable fenced Markdown whose rendered output is derived UI, never a second writable document state.

## Current Baseline

Crepe enables these features in both collaborative and standalone modes: selection toolbar, slash/block editing, headings, bold, emphasis, strikethrough, links, bullet and ordered lists, task lists, blockquotes, tables, fenced code blocks with CodeMirror, placeholders, cursor support, and local KaTeX rendering for inline/display formulas. TeamMD explicitly enables Crepe's top bar and LaTeX feature while disabling AI and image blocks.

The document header also exposes a read-only whole-document Markdown source view and a copy-as-text command. Both read canonical Markdown from the active adapter while Milkdown remains mounted as the only writable Yjs-bound surface. Empty authoritative rooms publish their initial empty state so the first paste is classified as a local unsaved edit.

The current editor renders exact `mermaid` fences through Crepe's existing code preview while keeping fenced source authoritative. Static history and public views intercept Vditor's bundled Mermaid path and use the same bounded TeamMD renderer from preserved code text. Supported flowcharts expose transient source-backed visual controls; all other syntax remains preview/source-only. Browser/server compatibility, collaboration, accessibility, rendering rollback, performance smoke, and desktop/mobile visual gates are covered by the implementation and tests described below.

## Product Requirements

### Rich Editing

- Editors can insert and edit headings, paragraphs, emphasis, strong text, strikethrough, links, blockquotes, horizontal rules, bullet lists, ordered lists, task lists, tables, inline code, and fenced code blocks without leaving the rendered editor.
- The same supported feature profile is used in collaborative and standalone fallback modes.
- Viewers remain read-only and do not see controls that imply write access.
- Toolbar and slash-command actions remain keyboard accessible and do not obscure document content on desktop or mobile.
- The complete editor can enter and exit a distraction-free full-screen layout without remounting the collaborative editor or losing draft state.
- The editor scrolls through the complete document, including a final diagram, with clear end spacing; the revision/character/save-state footer follows the actual document end instead of overlapping content or floating above it.
- Unsupported or lossy Markdown is never silently normalized into a different meaning.

### Mermaid

- Mermaid diagrams are stored as ordinary fenced Markdown with the language `mermaid`.
- The Mermaid source is the only writable and collaborative representation.
- Rendered SVG is disposable UI and is never persisted in Yjs, revisions, APIs, or the database.
- A diagram can switch between rendered preview and source editing without losing source text, cursor ownership, or undo history.
- A first-class Diagram action inserts a valid starter diagram without exposing generic code-block setup.
- Compact diagrams render at their intrinsic viewBox width and scale down responsively. Wide timeline diagrams preserve readable scale in preview-local horizontal scrolling without causing page overflow.
- Invalid diagrams show a local error and retain editable source.
- History and public views render the same saved Mermaid fences under the same security policy.
- Exported Markdown remains portable and contains the original Mermaid fence.

### Math

- Inline `$...$` and display `$$...$$` formula source is the only writable, collaborative, saved, and exported representation.
- The editor, immutable history, and public views render formulas locally with pinned KaTeX and the local `mhchem` extension.
- KaTeX HTML and MathML are disposable UI and never enter Yjs, revisions, APIs, exports, or persistence.
- Static rendering enables digit-leading inline formula parsing, including bounds such as `$1 \\le N \\le 10^5$`, before local KaTeX interception.
- Inline formula editing uses a compact source popover sized to the formula rather than the document width.
- Invalid or oversized formulas show a local bounded result without changing surrounding content.
- Wide display formulas scroll within their own preview and do not cause page overflow.

## Architectural Constraints

1. Milkdown remains the sole writable editor and continues to bind one versioned `Y.XmlFragment('milkdown')` to Yjs.
2. Mermaid must extend the existing fenced-code node or decorate it; it must not introduce a parallel writable root or separate collaborative diagram model.
3. The browser and server keep a pinned, compatible Milkdown parser/schema/serializer. Any schema change requires a compatibility assessment and may require a new collaboration state format.
4. Server checkpoints continue to serialize canonical Markdown from authoritative room state.
5. Standalone fallback continues to save through `baseRevisionId` and stale-write rejection.
6. Vditor remains read-only. Mermaid support in Vditor-based views must be configured as sanitized rendering rather than made writable.
7. Visual node/connector editing must deterministically rewrite the same Mermaid source node and fall back to source mode for unsupported syntax; it must never introduce parallel writable graph state.
8. Browser and server install the same math parser and ProseMirror node contract so authoritative checkpoints preserve formula semantics.

## Security And Resource Limits

- Use Mermaid with `securityLevel: 'strict'`.
- Disable raw HTML, unsafe links, click handlers, external scripts, and HTML labels.
- Sanitize generated SVG before insertion even when strict Mermaid rendering is enabled.
- Render into an isolated host; never assign unsanitized diagram output to application-level HTML.
- Bound Mermaid source size, node/edge count where practical, render duration, and concurrent render count.
- Cancel or ignore stale asynchronous renders when source changes or a node unmounts.
- Do not log Markdown or Mermaid source in errors or telemetry.
- Preserve the current 2 MiB revision boundary; introduce a smaller per-diagram limit before enabling Mermaid publicly.
- Use local KaTeX with `trust: false`, strict errors, and a 64 KiB source limit per formula; never invoke Vditor's CDN math renderer.

## Implementation Phases

### Phase 1: Explicit Rich Feature Profile

- Create one shared Crepe configuration used by collaborative and standalone editors.
- Explicitly enable the supported rich features instead of relying on library defaults.
- Keep AI and image blocks disabled until their storage/security requirements are designed. KaTeX support is complete with a shared browser/server schema and local-only rendering.
- Add source-level or adapter tests proving both editor modes use the same profile.
- Extend the server Markdown round-trip corpus to include horizontal rules, nested lists, task lists, tables, code language metadata, and a Mermaid fence.

**Exit gate:** editor tests, codec tests, web/API typecheck, lint, and formatting pass with no schema-format change.

### Phase 2: Rich Editing UX And Accessibility

- Audit the top bar, selection toolbar, slash menu, table controls, link tooltip, and CodeMirror language picker at desktop and mobile widths.
- Add concise tooltips and accessible names where Crepe defaults are insufficient.
- Ensure read-only mode suppresses mutation controls.
- Add keyboard tests for formatting, link insertion, list conversion, table insertion, code fences, undo, and redo.
- Add visual checks for overflow, focus visibility, and editor content not being occluded by controls.

**Exit gate:** supported operations are discoverable, keyboard accessible, collaborative, and round-trip without semantic loss.

### Phase 3: Mermaid Rendering Prototype

- Add pinned `mermaid` and SVG sanitization dependencies. Complete.
- Detect fenced code nodes whose language is exactly `mermaid`. Complete.
- Use Crepe's fenced-code preview hook to keep the code node authoritative and render disposable sanitized SVG. Complete.
- Provide source/preview modes without replacing the underlying ProseMirror node. Complete.
- Debounce and serialize rendering, ignore work after teardown, and display bounded syntax errors locally. Complete.
- Add unit tests for valid diagrams, invalid source, rapid updates, teardown cancellation, limits, sanitization, source preservation, read-only mode, and collaborative convergence. Complete for the editor prototype.

**Exit gate:** two collaborative clients can edit Mermaid source and converge while previews update independently; generated SVG never enters Markdown or Yjs state.

### Phase 4: Static History And Public Rendering

- Add the same strict Mermaid policy to `MarkdownPreview` for immutable history and public documents. Complete.
- Keep Vditor sanitization enabled and post-process only explicit `language-mermaid` fences through the bounded renderer. Complete.
- Prevent external navigation or embedded active content from generated diagrams. Complete through the shared SVG sanitizer.
- Add tests proving public rendering exposes no editor controls and invalid diagrams do not break the page. Complete.

**Exit gate:** current editor, history, and public views render the same saved Mermaid source consistently and securely.

### Phase 4A: Source-Backed Visual Diagram Editing

- Enhance the existing Milkdown code-block node view with derived visual controls while preserving the same fenced source node and Yjs binding. Complete.
- Start with a constrained flowchart subset: add/rename/delete nodes, create/delete directed edges, and choose layout direction.
- Parse supported source into transient UI state and serialize every visual operation back to deterministic Mermaid source in one ProseMirror transaction.
- Keep source mode available at all times and disable visual mutations, without rewriting content, when syntax falls outside the supported subset.
- Route visual operations through Milkdown/Yjs history so collaboration, Undo/Redo, checkpoints, and conflict behavior remain unchanged.

**Exit gate:** two clients can visually edit the supported flowchart subset, converge on identical portable Mermaid source, undo local operations, and switch to source mode without loss.

### Phase 5: Compatibility, Performance, And Rollout

- Add a shared Markdown corpus covering all supported constructs and Mermaid examples.
- Test parse/serialize/parse semantic equivalence in the browser and server codec.
- Measure large-document typing, Yjs update size, checkpoint latency, Mermaid render latency, and memory use.
- Add a feature flag for Mermaid rendering while keeping source editing available.
- Roll out to internal documents first, then enable broadly after security and performance gates pass.
- Document rollback: disable rendering without rewriting source, revisions, or collaboration state.

Completed with one shared rich GFM/nine-family Mermaid corpus, real browser and server codec round trips, opt-in bounded performance smoke tests, and validated `VITE_MERMAID_RENDERING_ENABLED` rollback. Local smoke results and exclusions are recorded in the testing strategy. Broad rollout still follows the normal release gate and must use a freshly built web artifact for any flag change.

**Exit gate:** compatibility corpus, security review, accessibility checks, and measured performance limits pass.

## Testing Strategy

- **Unit:** shared feature configuration, Mermaid fence detection, render cancellation, sanitization, and error states.
- **Codec:** browser/server semantic round trips for every supported Markdown construct and Mermaid source preservation.
- **Component:** toolbar/read-only behavior, source-preview switching, history/public rendering, and invalid diagram handling.
- **Collaboration:** concurrent edits inside and around Mermaid fences, awareness cursors, undo, reconnect, and checkpoint serialization.
- **End to end:** create a rich document, add a Mermaid diagram, collaborate, save, inspect history, open a public link, restore, and verify source remains unchanged.
- **Visual:** desktop/mobile screenshots for long tables, code blocks, slash menu, toolbars, and a Mermaid matrix covering flowchart, sequence, class, state, ER, pie, journey, Gantt, and mindmap diagrams with readable labels, contained geometry, and no page overflow.

## Definition Of Done

- Collaborative and standalone editors share one explicit supported feature profile.
- All supported Markdown constructs preserve semantics through browser and server round trips.
- Mermaid source is portable fenced Markdown and remains the only writable state.
- Generated diagrams are strict, sanitized, bounded, cancellable, and never persisted.
- Read-only, history, and public views enforce the same security policy.
- Focused tests, package tests, typecheck, lint, formatting, production build, and browser visual checks pass.
- The validated change is committed and pushed before any production deployment.

## Task Checklist

- [x] Phase 1: Add shared Crepe feature profile.
- [x] Phase 1: Use shared profile in collaborative and standalone adapters.
- [x] Phase 1: Add feature-profile drift tests.
- [x] Phase 1: Extend codec round-trip corpus with Mermaid fences and rich constructs.
- [x] Phase 2: Audit and test rich controls and accessibility.
- [x] Phase 2: Add semantic keyboard support for pointer-driven block and link actions.
- [x] Phase 2: Correct code-language picker search, clear-action, and option semantics.
- [x] Phase 2: Add full-screen editor mode with Escape and state-preservation tests.
- [x] Phase 2: Add visible Yjs-aware undo and redo controls.
- [x] Phase 3: Add secure Mermaid renderer dependencies and limits.
- [x] Phase 3: Implement fenced-code Mermaid preview through Crepe's source-preserving preview hook.
- [x] Phase 3: Add collaboration and source-preservation tests.
- [x] Phase 3: Add first-class Diagram insertion and compact responsive preview sizing.
- [x] Phase 4: Add strict Mermaid rendering to history/public previews.
- [x] Phase 4A: Add source-backed visual flowchart editing.
- [x] Phase 5: Complete compatibility, security, performance, and visual gates.
- [x] Math: Enable inline and display KaTeX in collaborative and standalone editors.
- [x] Math: Preserve formula source through browser/server codecs, Yjs convergence, checkpoints, and reload.
- [x] Math: Render formulas locally in history/public views with security and resource bounds.
- [x] Editor: Add read-only whole-document Markdown source and copy-as-text controls without creating a second writable root.
- [x] Editor: Mark the first paste into an authoritative empty collaboration room as unsaved.
- [x] Math: Render digit-leading inline formulas in immutable history/public views and compact the inline formula edit popover.
