# 04 — Risks & predictions (what will get painful)

Predictions of where this becomes problematic, roughly ordered by how much they should influence
the fork-vs-greenfield decision. "Spike-grade" means: fine for a throwaway demo, not for production.

## The strategic risk (the big one)

**Users may still feel this is too technical.** This is Tom's standing assumption and the spike did
not retire it. The target audience (Word / Google Docs / Notion users) expects *less* surface, not
more: little UI chrome, little customization, no draggable panes/splits, no command palette, no
"reopen editor with." VS Code's entire value proposition to developers — flexibility,
configurability, density — is the *opposite* of what this audience wants. We can hide chrome, but:
- The interaction grammar underneath is still an IDE (panes, groups, view containers, the palette).
- Every hidden affordance is one upstream merge away from coming back (Cursor's tax).
- "Calm by subtraction" (hiding things) is fragile; "calm by construction" (a shell built for the
  job) is what the audience actually compares against.

**Prediction:** the fork can get to a convincing *demo* of calm, but holding a genuinely
Word/Docs/Notion-grade simplicity in production — across upgrades, on a shell never designed for it
— will be a continuous fight. This is the strongest argument for greenfield. See
[05](05-open-questions.md).

## Technical-debt / correctness risks (fork-specific)

- **Merge tax.** Anything achieved by patching core workbench parts re-breaks on every upstream
  merge. The whole de-IDE strategy ([plans/02](plans/02-studio-de-ide-handoff.md)) is built around
  counting these patches precisely, because their number *is* the cost of keeping the fork.
- **The file-format trap.** `.living.md` smuggles metadata into HTML comments + a sidecar
  `.audit.json`, and api blocks store `{cell}` placeholders on disk. Round-tripping through a foreign
  editor (Obsidian) or an agent could strip/mangle the comments, and block identity isn't stable
  across external edits. This will not scale to rich documents. See [05](05-open-questions.md).
- **No real persistence/dirty model.** Raw edits and WYSIWYG edits write straight through
  `IFileService` — they bypass VS Code's text-model/dirty/undo/autosave machinery. There's no undo
  stack for document edits, no conflict handling, no "unsaved" state. Spike-grade only.
- **Provenance is shallow.** `revealSource` opens the bound CSV and selects the synced-week row.
  For api/mcp blocks there's no real provenance target (it falls back to the CSV). True provenance
  (which API field / which CRM record / point-in-time value) isn't modelled.
- **Multi-open active-doc edge.** The service is keyed by resource (good), but status messages are
  global and the "recently applied" highlight is per-doc-but-reset-on-open. Two docs open in split
  groups could show slightly stale cross-talk. Fine for the slice; needs care later.
- **mcp source kind is a stub.** It parses and round-trips but doesn't resolve — "bound to a CRM via
  MCP" is asserted, not proven (unlike the api kind, which is real).
- **The agent loop is heuristic-backed.** When no model is available it falls back to a fixed
  "Growth accelerated sharply..." sentence regardless of input — every doc gets identical text. Fine
  for a no-model demo; obviously not production classification.

## Scaling / performance predictions

- **Refresh is O(all docs x all blocks) and serial**, with a network call per api block and a model
  call per narrative block. A workspace with dozens of bound docs would be slow and rate-limited.
  Needs batching, concurrency limits, caching, and incremental (changed-source-only) derivation.
- **Webview re-render is whole-document on every change.** Editing re-serializes and re-renders the
  entire webview (resetting cursor/focus — currently masked by editing-on-blur). A real editor needs
  incremental DOM updates.
- **Discovery is a directory scan** of loaded docs' folders. A large workspace would want indexing.
- **API rate limits** (e.g. unauthenticated GitHub: 60/hr/IP) will bite any real multi-source doc.

## Security / trust predictions

- **Webview + Markdown.** Generic Markdown is rendered via VS Code's sanitizing `renderMarkdown`
  (good), and our structured render escapes everything. But api responses are substituted into
  templates as text — a hostile API returning markup is only safe because we escape on render; keep
  that invariant. The export HTML inlines values similarly.
- **Untrusted sources.** Binding a document to an arbitrary URL/MCP tool is an injection surface for
  the *content* of a trusted-looking document. Provenance + approval is the mitigation, but the
  meaning-vs-figure classifier deciding what auto-applies is security-relevant, not just UX.
- **Auth.** No source auth story yet (the api demo used a public endpoint). Real CRMs/sheets need
  OAuth/secrets handling — which on a fork means either the user-data dir or a bespoke secret store.

## What is explicitly fine for now (don't over-engineer the spike)

Spike-grade persistence, the heuristic fallback, shallow provenance, the stub mcp kind, and the
serial refresh are all acceptable *for a throwaway evaluation*. The point of listing them is so the
production effort (fork or greenfield) budgets for them — not to fix them in the spike.
