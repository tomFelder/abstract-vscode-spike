---
number: 130
status: "**Done (plan 31 iter 2).** 0 core patches; branch `31-review-quality-v2`."
provenance: "plan 31, iter 2"
source: docs/07-decision-log.md
---

# One shared self-explaining review framing

**Every review surface renders one self-explaining framing, built once and shared: kind tag + truthful confidence chip + rationale + source chip**

The proposal model already carried `kind`/`confidence`/`rationale`/`sourceLine`; iteration 2 surfaces them identically on the inline widget, the Review rail and the cross-document cards from a single pure `reviewFraming(change, source)` helper (`common/livingDocsModel.ts`), so the three surfaces can never drift. The framing is: a kind tag (`MEANING CHANGE · needs your call` in attention tokens / `FIGURE` in ok tokens), a confidence chip (`● High` / `◐ Inferred`) following the SAME `reviewConfidence` rule the cross-doc cards already shipped (D24-A: a `meaning` change under 0.8 is Inferred, every other change is High - never decorative), the model's rationale sentence ONLY when present (an empty rationale shows nothing - no "AI suggested this" filler), and a source chip (`metrics.csv · line 12`) that carries a real `sourceLine` where known and NEVER fabricates one. `IPmEditDecoration`/`IPmInsertDecoration` gained `kind`/`rationale`/`newText`/`sourceLine` (host-rendered into the widget strings; the webview just places them - no PM-bundle rebuild, the widgets are host-rendered per decision 47/52). **Tier: our-surface, 0 core patches.** Verified: 4 model unit tests (`reviewFraming`: low-confidence meaning → attention + Inferred; confident meaning → High; figure → ok FIGURE + always High; omits source label / never fabricates a line) + 3 decoration tests (edit carries rationale/kind/newText/real line; omits `sourceLine` when none; insert carries rationale/kind). Live verification of the framing widget was blocked by the unreachable model backend (no credits - Anthropic returns "credit balance too low", OpenRouter key unset), which leaves no pending proposal to render; the app itself builds and runs, and the PR #100 validator served it live on :8080 with Home/editor/rails rendering (esbuild was a resolvable node_modules layout quirk, symlinked from build/node_modules into root, not unbuildable code). Documented at `docs/plans/31-verify/README.md`; no screenshots were fabricated.
