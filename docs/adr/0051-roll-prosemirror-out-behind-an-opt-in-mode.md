---
number: 51
status: "**Done (plan 15 iter 3).** `LivingDocViewMode` gains `'pm'`; `renderLivingDocContent` routes the body to the PM surface for `mode==='pm'` (any doc) or a plain rendered doc; `livingDocEditor` merges frontmatter on `pmEdit` for living docs via `withReplacedBody` (TDD, 2 tests). Tier: **our-surface**. 0 core patches. Verified live: a living doc toggles into PM (figures as nodes + provenance accent, same webview - no remount), prose edits persist, and toggling back shows it is **still living** (frontmatter survived); renderDoc default + plain-doc PM both unaffected (80 tests pass)."
provenance: "plan 15"
source: docs/07-decision-log.md
---

# Roll ProseMirror out behind an opt-in mode

**Living docs render in ProseMirror behind an opt-in 'pm' mode, rolled out before the default flips; a PM edit re-attaches frontmatter**

Decision 49 (retire renderDoc, one PM path) can't flip in a single commit without regressing HOLD (F4 inline diff / F6 accept-reject / G5 gutter all live on renderDoc). So living docs get a third view mode, **'pm'** (alongside rendered/raw), reached by an "Edit" toggle in the calm topbar; renderDoc stays the **default**, so F1-F6/G5 keep passing while the renderDoc features are ported into PM across iterations. The PM surface only round-trips the document **body**, so a living-doc PM edit must re-attach the existing `---` frontmatter or it would silently strip `sources:`/`context:` (turning a living doc plain) - handled by a pure `withReplacedBody(text, newBody)` helper. The provenance gutter ships first as a lightweight CSS accent on bound blocks (`p:has(span.bound)`); the exact dot/bar gutter becomes PM decorations in a later iteration.
