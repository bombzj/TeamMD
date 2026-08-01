export type MarkdownCompatibilityCase = {
  name: string;
  markdown: string;
  mermaidSources: readonly string[];
};

const richMarkdown = `# Rendered editing

This has **bold**, *emphasis*, ~~strike~~, [a link](https://example.test), \`inline code\`, and escaped \\*text\\*.

Unicode remains meaningful: naive cafe and 日本語.

- [x] Complete
- [ ] Pending
  - Nested detail

1. First
2. Second

---

| Feature | Status |
| --- | --- |
| Collaboration | Working |

> Shared quote

\`\`\`ts
const answer = 42;
\`\`\`
`;

const mermaidExamples = [
  {
    name: 'flowchart',
    source: `flowchart LR
  Browser --> API
  Browser --> Collaboration`,
  },
  {
    name: 'sequence',
    source: `sequenceDiagram
  Browser->>API: Save
  API-->>Browser: Revision`,
  },
  {
    name: 'class',
    source: `classDiagram
  Document <|-- SharedDocument`,
  },
  {
    name: 'state',
    source: `stateDiagram-v2
  [*] --> Draft
  Draft --> Saved`,
  },
  {
    name: 'entity relationship',
    source: `erDiagram
  DOCUMENT ||--o{ REVISION : contains`,
  },
  {
    name: 'pie',
    source: `pie title Document roles
  "Owners" : 1
  "Collaborators" : 2`,
  },
  {
    name: 'journey',
    source: `journey
  title Save a document
  section Editing
    Write: 5: Editor
    Save: 4: Editor`,
  },
  {
    name: 'gantt',
    source: `gantt
  title Release
  dateFormat YYYY-MM-DD
  section Editor
  Validate :done, 2026-08-01, 2d`,
  },
  {
    name: 'mindmap',
    source: `mindmap
  root((TeamMD))
    Editor
    History`,
  },
] as const;

export const markdownCompatibilityCorpus: readonly MarkdownCompatibilityCase[] =
  [
    {
      name: 'rich GFM',
      markdown: richMarkdown,
      mermaidSources: [],
    },
    ...mermaidExamples.map(({ name, source }) => ({
      name: `Mermaid ${name}`,
      markdown: `${richMarkdown}\n\`\`\`mermaid\n${source}\n\`\`\`\n`,
      mermaidSources: [source],
    })),
  ];
