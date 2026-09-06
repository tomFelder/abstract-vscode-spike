# Abstract

Abstract is a living-documents product built on a private VS Code fork: documents whose figures and claims stay bound to their sources, kept current by agents whose every change passes through human review. This file is the canonical glossary (established 1 Sep 2026, seeded from doc 26's vocabulary and doc 30's editing vocabulary); the ID systems (journeys, decisions, F/T/VP/X...) and per-term home-doc links live in [docs/26-glossary-and-id-index.md](docs/26-glossary-and-id-index.md), and full specs live in the home docs it points to.

## Language

### The product and the bet

**Living document**:
A `.md` file whose figures and claims are bound to sources and kept current by agents under review.

**ITE**:
Integrated Thinking Environment - the category Abstract exists to define; the mission behind the v1 wedge.

**The wedge**:
Provenance, diff and approval on recurring data-fed documents - the v1 spearhead into the ITE category.

**The aha (T4)**:
A user's first approved agent change on their own file. The beta gate's central event.

**All-clear**:
The morning inbox driven to zero - the habit moment the product is paced around.

**Thinking-skills pack**:
The default skills (interview-me, stress-test, ...) seeded into new projects; the ITE story in v1.

**Doc-set test**:
The VP4 dogfood benchmark: this repo's own `docs/` folder loaded as an Abstract project and worked on for real.

### The document substrate

**Lock**:
The generated `.lock.json` sidecar beside each document: bindings, provenance, audit, snapshots. Rebuildable; travels with the file.

**Binding**:
A value in prose anchored to a source cell, e.g. `[18%](bind:metrics.mrr.delta)`.
_Avoid_: link (reserved for hyperlinks and wikilinks)

**Source**:
Where bound values come from - a file (CSV), an API, or an MCP server; listed in Knowledge.

**`.abstract/`**:
The hidden in-project app home: skills, knowledge metadata, run log, config, indexes, the change store.

**`~/.abstract/`**:
The localhost model helper's own home in the user's home directory: sign-in bundle, API secrets, spend and event logs. Owner-only; never document text.

**Tidy verb**:
"Tidy this project" - an agent proposing file moves through review, atomic on locks.

### The primitives

**Skill / agent / source / template**:
The four user-facing primitives; an agent is a skill plus a trigger, scope and policy.

### Review

**Change**:
The unit of review: one hunk of one document, persisted with a stable id, base revision, span, stacked versions and an optional comment thread. Presented as a diff in place with a card; approving it is the commit. Authored by an agent or by a human, since the review grammar is the same for both.
_Avoid_: proposal, suggestion, edit request. The verb is correct and canonical ("the agent proposes changes"); the noun is not, because upstream VS Code already owns "proposal" for its extension API proposal system (`enabledApiProposals`), and the two must not collide in one tree.

**Change set**:
The Changes produced by one run, reviewed and receipted as a unit.

**Change store**:
The append-only persisted authority for every Change - the single source of truth for counts, verbs, receipts and the audit trail; every other surface is a derived view.

**Review grammar**:
The one path every change takes, human or agent alike: propose, diff, approve/tweak/reject, receipt.

**Figure vs meaning**:
The central review mechanic: low-risk figure changes may auto-apply per the autonomy dial; meaning changes always wait for a human.

**Provenance peek**:
Hovering or clicking a bound figure to see its source, exact row, freshness and then-vs-now. The wedge in one gesture.

**Receipt**:
The host-composed record of what actually landed, reconciled from store outcomes - never composed from model claims.

**Comment (verb)**:
The third review verb beside approve and reject: opens a thread on a Change and structurally excludes it from every bulk sweep while discussion is open.

**Golden path / off-path**:
A journey's happy frames versus its empty, error, cancel and recovery states; walkable means surviving both.

### The editing loop

**Loop kernel**:
The pure tool-use state machine driving agentic editing. Models author content, never coordinates; the host owns all geometry.

**Segment list**:
The wire for targeted edits: keep/replace/insertAfter instructions over ordinal-labelled blocks, expanded deterministically by the host.
_Avoid_: patch, search-and-replace

**Ordinal addressing**:
Referring to blocks by printed position labels (B1, B8-B9) rather than quoted text or content-derived ids.

**Rewrite**:
A whole-document change authored as a full new body by the planner, landing progressively and decided document-first (the `rewrite` change class, versus `targeted`).

**Scope**:
The set of documents a run may write. Explicit attachments fix it fails-closed at the store's write boundary; anything else the planner must declare visibly before proposing. Reads outside scope are permitted but ledgered.

**Scope strip**:
The visible rendering of a run's declared scope, with a consent gate before wide runs.

**Document catalogue**:
The per-workspace index (titles, headings, tags, links, sizes) the planner plans against and search runs over.

**Intent journal**:
The append-only record of declared intent, with expected post-hashes, written before any mutation - crash recovery becomes proof rather than suspicion.

**Fan-out**:
One instruction across many documents via parallel per-document work, landing as cross-document review.

**Wave**:
A batch of parallel rewrite calls priced against remaining budget before dispatch, so a budget pause happens before burning and overshoot is bounded to one wave.

### Serving and spend

**Broker**:
The stateless localhost proxy that owns model serving: doors, metering, the spend cap and the audit trail. The product's one economic control point.

**Door**:
One authenticated route to models (ChatGPT OAuth, or the included OpenRouter tier). The model id implies the door, pinned per request; failure is loud - never a silent cross-door substitution.

**Purpose**:
The advisory per-request field (`plan | apply | chat`) that resolves per-lane serving defaults and stamps the spend audit.

**Data-flow one-pager**:
The plain-words statement of what leaves the user's machine, when, and to whom; surfaced in-product on the Model access screen.

### The fork

**Merge tax**:
The running cost of core patches against upstream VS Code; the 0-core-patch discipline keeps the ledger at zero.
