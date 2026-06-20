# Living Documents — Raw-Markdown format & dependency model (design spec)

**Date:** 2026-06-21 · **Status:** approved direction, pre-implementation · **Resolves:** Q1 in
`docs/05-open-questions.md`; supersedes the framing in `docs/plans/04-file-format-options.md`.
**Companion visual:** `docs/option-10-living-docs-format.html`.

---

## 1. Context — why this change

The original hope for Living Documents was to **"just work on top of Markdown"**: a persistent
`.md` you can read, hand-edit, share, and hand to an agent. The spike's `.living.md` broke that
promise — it smuggles bindings into HTML comments, shows `{cell}` placeholders on disk, and keeps
provenance in a sidecar `.audit.json`. It is neither clean Markdown nor a good home for rich
structure (Q1).

This spec settles the format **and** the harder thing the format exists to serve: how a document
stays *current* when its sources change. That splits into two genuinely different problems —
exact **value bindings** (a number from a cell) and diffuse **influence dependencies** (a source
that shapes the *sentiment* of prose). The influence case — a shifting product principle, a new
competitor that should ripple through a document — is the real product moat, not token insertion.

**Intended outcome:** a clean-Markdown-primary format with a generated lock file, a dependency
graph that handles both kinds of change, and a trust-first review flow — buildable on the existing
spike for **$0**, and architected so nothing here is a dead-end at tens-of-thousands of users /
millions of documents.

## 2. Priorities (locked, in order)

1. **Trust** — non-technical users churn the instant something silently breaks.
2. **UX** — must match or beat Google Docs / Notion; good model output is itself part of trust.
3. **LLM / agent-native** — the document is legible to agents, skills, and connectors.
4. **Scale** — lowest priority to *implement* now, but a hard *architectural constraint*: no choice
   may be a dead-end at large scale.

## 3. The design

### 3.1 Two files per document (the package-manager pattern)

- **`<doc>.md`** — canonical, ~99% pure Markdown the user owns. The only departure from plain
  Markdown: where a value is bound to a source, the author (or agent) writes a **bind link** instead
  of a hardcoded value.
- **`<doc>.lock.json`** — generated and maintained by the app. The provenance ledger and dependency
  graph. **Source of truth for resolved values and freshness.** Deletable/rebuildable from sources.

The pair is a single *logical* unit. In the spike it persists as two files on disk; in production it
persists in the platform store (the user does not use git/Obsidian). The model is identical either
way.

### 3.2 Bind-link syntax (value bindings)

Resolved value and binding both live inline, as a real Markdown link with a `bind:` scheme:

```markdown
Revenue grew [18%](bind:metrics.mrr.delta) week-on-week to [$48.6k](bind:metrics.mrr) MRR,
carried by [427](bind:metrics.signups) new signups.
```

- The **bind link IS the anchor** — survives reorder/insert/paste; no line numbers to drift.
- The visible link text is a **rendered cache** of the value, so the `.md` reads correctly on its
  own and an LLM sees both the value and its origin. On any render/save the cache is reconciled to
  the lock's `resolved` value (lock wins).
- In the rendered editor the link displays as plain text with a **blue gutter dot**; the `bind:`
  URL is never shown to the reader.

### 3.3 Lock-file schema (the dependency graph)

```jsonc
{
  "version": 14,
  "bindings": {                       // exact value edges (token → cell)
    "metrics.mrr": {
      "resolved": "$48.6k",
      "source": "metrics.csv#week=24,col=mrr",
      "sourceHash": "a1b2c3",         // hash of the source value at last sync
      "syncedAt": "2026-06-21T09:02Z",
      "appliedBy": "agent",
      "kind": "figure"
    }
  },
  "context": {                        // influence edges (source → prose framing)
    "market-research.md": {
      "reviewedHash": "9f0e1d",       // hash of the source at last review
      "reviewedAt": "2026-06-19T…",
      "scope": "document"             // v1: whole-doc; later: section/claim
    }
  },
  "claims": {                         // prose bound to sources, anchored by text
    "commentary-tone": {
      "anchor": "Growth accelerated sharply this week.",
      "boundTo": ["metrics.mrr", "metrics.signups"],
      "kind": "meaning",
      "state": "applied"
    }
  },
  "pins": []                          // optional: freeze doc to a source version (snapshots)
}
```

`sources:` declarations live in the `.md` frontmatter; `context:` files are also listed there so the
document is self-describing.

### 3.4 The two dependency kinds & the architecture

| | Value binding | Influence dependency |
|---|---|---|
| Maps | token → cell, 1:1 | source → prose framing, 1:many |
| "Changed?" | hash compare (cheap, exact) | a model's **judgment** |
| Lock home | `bindings` | `context` (+ affected `claims`) |

**Core architectural move** (the pattern behind incremental build systems — Make/Bazel/Salsa):
generalize the binding *table* into a dependency *graph*, then **split two phases**:

- **Staleness detection — cheap, always-on.** A correlated file watcher (or source poll) notices a
  context/source changed → flips a **dirty bit** → the document and affected sources show a
  *"may be affected"* flag. Costs nothing; never touches prose.
- **Impact computation — expensive, on-demand.** Only when the user clicks **"Review impact"**
  (v1 trigger) does a model pass run: it reads the *diff* of the changed source against the document
  and returns **candidate edits with provenance and confidence**.

**All results flow into the existing review rail** — figure auto-applies, meaning/influence changes
queue as red/green inline diffs with Approve/Reject and an audit entry. No new UX grammar.

### 3.5 Influence dependencies — v1 behaviour (decided)

- **Granularity:** **whole-document context list.** Each doc declares the sources it draws on; the
  left **Context** panel lists them with a freshness status (✓ current / ⚠ changed since last
  review). "Review impact" scans the whole doc against a changed source. (Grows into
  section/claim-level edges later without rework.)
- **Trigger:** **flag + on-demand review.** Passive staleness flag; a model call only when the user
  asks. (A scheduled "freshness agent" operating on the dirty bits is a later, opt-in extension —
  it must still route through the review rail, never auto-edit.)

### 3.6 Trust guardrails

1. **No silent breakage of values** — bind links are self-anchoring; they cannot drift to the wrong
   place.
2. **Prose claims fail loudly** — claims are relocated by fuzzy match on `anchor`+context; low
   confidence surfaces a *"re-link?"* prompt rather than silently re-attaching.
3. **No eager rewrites** — influence changes are flagged, never auto-applied; the user (or an opt-in
   agent) initiates the pass.
4. **Confidence-gated routing** — high-confidence factual ripples may auto-stage; sentiment shifts
   always wait. (Generalizes the existing figure-vs-meaning split.)
5. **Semantic-change gating** — before flagging "may be affected", prefer a salient-fact check over
   raw mtime so trivial edits don't nag (reduces false-alarm churn). v1 may start with hash/mtime and
   add salient-fact gating as the model path matures.
6. **Pinning / snapshots** — a published doc can be pinned to a source version so later changes don't
   silently rewrite history (critical for the LP-letter / audit beachhead).
7. **Reverse provenance** — "why is this here?" on any paragraph lists the context that informs it.

### 3.7 Multiplayer posture (locked): identity-keyed now, CRDT-ready

Keep the **binding/provenance layer orthogonal to the text layer** by keying everything on
**binding identity, never text position**. Ship file/save-level collaboration first; keep full
**CRDT (Yjs/Automerge)** as a clean drop-in later — going (a)→(c) swaps only how text bytes merge;
the binding/provenance/review model never moves. (Position-anchoring, the rejected option, is exactly
what would have been CRDT-incompatible.)

## 4. Migration (do it now, in the spike)

Migrate the sample `.living.md` documents to the new format to learn from it:

- `<!-- bind id=… cells=… -->` comment → inline `[value](bind:…)` links; resolved values inlined.
- `{cell}` api templates → bind links resolved from the live fetch (kept resolvable next refresh).
- `.audit.json` sidecar → merged into `.lock.json` (`bindings`/`claims` carry state + audit).
- Add a `context:` frontmatter list + a context source (e.g. a `market-research.md`) to exercise the
  influence path end-to-end.

This is a learning exercise; we expect it to surface issues that inform a future real build.

## 5. Cost — $0 to build and demo

- Deterministic, local, free: format parse/serialize, lock-file machinery, bind-link resolution,
  hash-based staleness, dependency graph, Context panel, review rail, migration, the GitHub-API item.
- The only model-dependent piece (semantic impact / commentary rewrite) reuses the spike's existing
  **heuristic fallback** when no model is present, and otherwise routes through `ILanguageModelsService`
  / the Agent Host on **existing subscription auth** — not a metered API key. No new spend.

## 6. Scope for the spike implementation

**In:** the `.md` bind-link format + parser/serializer; the `.lock.json` schema + read/write;
bind-link resolution & rendered-cache reconciliation; hash-based staleness + dirty-bit; the Context
panel with freshness status; "Review impact" wired to the model-or-heuristic pass; results into the
existing review rail; migration of the sample docs.

**Deferred (named, not built):** section/claim-level influence edges; scheduled freshness agent;
CRDT text layer; salient-fact semantic gating; entity index for "mentioned everywhere"; pinning UI
(schema field reserved). Cloud/platform persistence (spike stays on sidecar files).

## 7. Verification

- `npm run typecheck-client` clean; `./scripts/test.sh --grep "LivingDocsService"` green, extended
  with: bind-link round-trip, lock read/write, staleness dirty-bit, impact-pass heuristic path,
  migration of a `.living.md` fixture.
- Web build (`./scripts/code-web.sh ./living-docs-sample`) driven via chrome-devtools MCP: migrated
  doc renders with blue dots; change a value source → figure auto-applies; change a `context:` source
  → Context panel flags ⚠ → "Review impact" → candidates appear in the review rail → approve →
  flag clears + lock updates.

---

## 8. Decision log — options considered

> Captured in full because this architectural decision is expected to recur. Each axis lists the
> options weighed and why the chosen one won under **trust > UX > LLM > scale**.

### 8.1 Canonical format / anchoring (10 options)

| # | Option | Verdict |
|---|--------|---------|
| 1 | Line-number sidecar (the literal first idea) | **Rejected.** Line numbers are the most fragile key — any insert above drifts them; CRDT-incompatible. |
| 2 | Content-hash anchoring | Rejected as primary. Breaks when bound text changes (which is when updates happen). |
| 3 | Fuzzy re-anchoring sidecar | **Adopted for the prose-claim case only** (with loud "re-link?"); too soft as the sole anchor. |
| 4 | Invisible ID anchors (HTML comments / zero-width) | Rejected. Robust but smuggled; agents/editors can strip them. |
| 5 | Markdown attribute/directive syntax | Considered; bind-link (#10's syntax) preferred for graceful foreign rendering. |
| 6 | JSON/LDOC canonical, MD as projection | Rejected for now; departs most from "just a file"; revisit if a real block editor lands. |
| 7 | Git as provenance engine | Rejected — target users won't use git; folded in only as an optional audit substrate. |
| 8 | CRDT + MD serialization | **Deferred, not exclusive** — adopted as the future text layer under the identity-keyed model. |
| 9 | Semantic/embedding anchoring | Rejected as primary — non-deterministic, probabilistic provenance hurts trust; used only inside the impact pass. |
| **10** | **Clean file + lock file (package-manager pattern)** | **Chosen.** Token-anchored values, lock-file provenance, loud fuzzy fallback for prose. |

### 8.2 Multiplayer posture

- (a) File/save-level — **chosen for v1.**
- (b) Block-level presence/soft-lock — possible middle step.
- (c) Full CRDT — **chosen as the upgrade path**, enabled by identity-keyed bindings.
- Single-player only — rejected (collaboration is a modern-editor expectation).

### 8.3 Influence-dependency granularity

- **Whole-doc context list — chosen for v1.**
- Section/paragraph edges — deferred (more precise, more anchoring cost).
- Both day one — deferred.

### 8.4 Reaction trigger

- **Flag + on-demand "Review impact" — chosen for v1.**
- Flag + scheduled freshness agent — deferred opt-in extension.
- Eager on-change — rejected (cost + false-alarm fatigue erodes trust).

### 8.5 Resolved sub-decisions

- **Token syntax:** inline-link `[value](bind:source.field)` chosen over `{{token}}` and
  `[v]{src=…}` — renders as the value in any viewer, shows value+origin to an LLM.
- **Lock-file location:** platform-stored (users don't use git/Obsidian); spike uses sidecar files.
- **Migration:** migrate the existing `.living.md` now, as a learning exercise.

## 9. This will recur

The canonical-format question is coupled to two bigger calls still open — **how "real" the WYSIWYG
editor becomes (Q2)** and **fork-vs-greenfield (Q3)**. If/when the editor becomes a true block editor
or we go greenfield, options **6/8** (structured/CRDT canonical with Markdown as a projection) become
materially more attractive. The identity-keyed dependency model in this spec is deliberately chosen
to survive that transition: it is the same graph whether the text lives in Markdown, a block tree, or
a CRDT.
