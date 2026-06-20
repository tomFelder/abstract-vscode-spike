# 07 — Decision log

ADR-style record of decisions taken during the spike, with rationale and current status. "Revisit"
means the decision was pragmatic for the spike and is expected to change for production.

| # | Decision | Rationale | Status |
|---|---|---|---|
| 1 | **Spike on a VS Code fork** before committing to an architecture | The agent->diff->approve->provenance loop is ~70% pre-built; cheap way to prove the engine | Done; engine proven |
| 2 | **Direction 01 "The Workbench"** as the design | Fastest 1:1 map onto VS Code's 3-pane layout | Locked |
| 3 | **Thin, purpose-built agent orchestration** (reuse model/tools/diff, not the generic session handler) | The generic handler is code-edit-shaped; our loop is "re-derive bound blocks -> classify -> propose -> fan out" | Done; validated |
| 4 | **Reuse VS Code primitives for rich text; no TipTap** | Avoid a heavy 3rd-party dep; build on notebook-cell / text-buffer / decorations | Holds for fork path; **revisit** for greenfield (Q2) |
| 5 | **Back documents with portable Markdown (`.living.md`)** rather than bespoke JSON | Editable, shareable, Obsidian-openable, agent-native, git-diffable | **Revisit** — see [05](05-open-questions.md) Q1 |
| 6 | **Claim `*.md` as the default editor** (not just `*.living.md`) | The product is a word processor; plain `.md` should open rendered, with text editor one click away | Done |
| 7 | **Generic Markdown via VS Code's `renderMarkdown`** | Correct, sanitized, no hand-rolled parser | Done |
| 8 | **WYSIWYG only on non-bound prose**; bound blocks stay source-driven | Preserve the provenance guarantee — you can't hand-edit a value that's owned by a source | Done |
| 9 | **`file \| api \| mcp` source-kind abstraction**; implement `api` for real, stub `mcp` | "Bound to an API/CRM" is the differentiator; api via `IRequestService` is demonstrable now, mcp needs a server | Done (api real, mcp stub) |
| 10 | **Export to a self-contained HTML page** (over Google Docs / .docx) | Self-contained, no runtime auth; a Drive/MCP exporter drops in behind the same call | Done; **extend** with "Download as Markdown" (ITEM G) |
| 11 | **Calm shell via workspace settings, not core patches** | ~80% calm for free, reversible, zero merge-tax | Done; the hard 20% is the next pass |
| 12 | **`product.json` rebrand: display-only** (`nameShort`/`nameLong`); leave `applicationName`/`dataFolderName` | Those control the user-data dir; changing them is a footgun | Done |
| 13 | **Verify on the web build via chrome-devtools MCP**, unit-test the service headlessly | No GUI needed; fast iteration; the core loop is covered by mocked-service tests | Done; standing practice |

## Decisions still open (tracked in [05-open-questions.md](05-open-questions.md))

- **Canonical file format** — Markdown-primary vs JSON/LDOC-primary vs hybrid sidecar (Q1).
- **How real the editor must be**, and on what substrate (Q2).
- **Fork vs greenfield for production** (Q3) — the decision the whole spike serves; to be informed
  by the upcoming Studio de-IDE pass and its merge-tax ledger.
