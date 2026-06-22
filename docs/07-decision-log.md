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
| 14 | **Model calls go through a localhost OAuth proxy**, not from the renderer | `livingDocsService` runs in the browser; a credential must never be embedded there. The proxy holds the dev's OAuth token (via `ant`) server-side. The sources build sets no `connect-src` CSP, so renderer->proxy works via CORS with zero core changes | Done (PR #11); see [10-model-integration.md](10-model-integration.md) |
| 15 | **OAuth (Console billing), not a static API key or Pro/Max sub** | No key in the repo; auto-refreshing token; the claude.ai subscription flow is first-party only. OAuth bills the Anthropic Console org, which needs API credits | Done; **org credits outstanding** |
| 16 | **Optional OpenRouter test backend in the proxy** | Verify the live renderer->proxy->model->render flow against a cheap model without Anthropic credits; default path stays Anthropic OAuth, key never committed | Done; dev-only |
| 17 | **Chat agent built on `livingDocsService._callModel`** (reuse the proxy transport, not a new provider); proposed prose edits route through the existing Review rail (`IProposedChange` -> approve/reject) | One model transport; the agent's edits inherit the proven approve/apply/audit loop for free | Done (plan 09, PR #13) |
| 18 | **v1 functionality landed inside the livingDocs contrib with 0 core patches** (Chat agent, Apply-fix, source-peek + Sync-across, Context kinds, dynamic subtitle) | Prove the product is *functional*, not just visual, while holding merge-tax at zero | Done (plan 09, PR #13); all 7 v1 criteria >= 85 |
| 19 | **v1 source-peek / Sync-across opened a VS Code `SIDE_GROUP` editor group** | Cheapest way to put the source beside the doc without new UI | **Reversed by 20** - it produced the abrasive split-pane / blank-pane that violates "no split editors" ([06](06-design-notes.md)) |
| 20 | **(v2) Source-peek + Sync-across become in-surface panels, never editor splits** | The product is one calm surface (Word/Docs/Notion); a second editor group + blank pane reads as an IDE, not a document tool | Decided (plan 11); to build |
| 21 | **(v2) Build the design's left tree-rail** (Files/Context/Outline/Search + folder tree), departing from the spike-era activity-bar-per-view nav | The current left rail has far less than the comp's IA; the comp's single tree-rail is the intended model | Decided (plan 11); **revises the decision-4-era nav**; to build |
| 22 | **(v2) Core patches permitted where the design genuinely needs them, logged in the merge-tax ledger** | A faithful single-surface shell (bespoke rail, removing IDE optionality, calm header) may not be reachable with contrib-only seams; each core patch is also evidence toward greenfield (Q3) | Decided (plan 11); **relaxes decision 11** for the v2 shell only; prefer the cheapest tier first |

## Decisions still open (tracked in [05-open-questions.md](05-open-questions.md))

- **Canonical file format** — Markdown-primary vs JSON/LDOC-primary vs hybrid sidecar (Q1).
- **How real the editor must be**, and on what substrate (Q2).
- **Fork vs greenfield for production** (Q3) — the decision the whole spike serves; to be informed
  by the upcoming Studio de-IDE pass and its merge-tax ledger.
