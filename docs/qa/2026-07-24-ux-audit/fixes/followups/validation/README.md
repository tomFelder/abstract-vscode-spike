# Wave follow-ups (PR #274) - adversarial validation evidence

Independent adversarial validation of PR #274 (branch `wave-followups`, HEAD `d104a2f`) against the audit fix wave (plan 50, umbrella #263). All eight checklist items verified. Verdict: PASS.

Live desktop run: Code OSS from sources compiled with `npm run compile`, launched against a throwaway `/tmp` copy of `living-docs-sample` that added an UNOPENED `Backup Policy.md` (`policy: never`, 296 bytes, md5 `0a275cd489ad34f6bb5411329ad42bdc`). A dummy refusing broker served `/healthz {ok:false}` on 8090 for the pre-flight no-model case; killed after. Unit suites, `typecheck-client`, `valid-layers-check`, `check-seams.sh` all green.

## Per-item verdicts

| Item | Method | Verdict | Evidence |
|------|--------|---------|----------|
| CR-1 header opens idle, no auto-launch | Live | PASS | `cr1-01-agents-header.png`, `cr1-02-projectrun-idle-after-header.png`; dummy broker log showed zero model calls after the header click |
| CR-1 explicit button launches a real run | Live | PASS | `cr1-03-explicit-launch-fanout.png` (idle -> "Model unreachable for 8 of 9 documents") |
| CR-1 composer path (1j) intact | Code + Live-partial | PASS | `askProject -> _openProjectRun(text)` unchanged; composer accepts input and posts. Change-request-vs-question classification needs a live model (broker down here), so the run-surface open via composer was not driveable end-to-end; the header fix is the target and is proven |
| CR-2 Enter/Space on nested Run Now runs, stays on roster | Live | PASS | `cr2-01-enter-on-runnow-stays-roster.png`, `cr2-03-space-on-runnow-stays-roster.png` - ledger gained "Weekly refresh swept 0 documents", all 5 cards stayed, synthetic bubbled keydown on the button returned `defaultPrevented:false` (card guard did not swallow it) |
| CR-2 Enter on card opens canvas | Live | PASS | `cr2-02-enter-on-card-opens-canvas.png` - agent detail canvas opened (RUN LOG 1) |
| sev-3 unloaded never-doc tiled "left alone" | Live | PASS | `sev3-preflight-no-model-never-doc-left-alone.png` - Backup Policy tiled "left alone (policy: never)", summary "8 failed - 1 left alone"; bytes untouched (md5 unchanged post-run) |
| CR-3 catch-return before wordPaste post | Unit | PASS | render test "#269 CR-3: a failed pasteHTML returns before posting wordPaste" passes; source line 820 `catch (err) { return; }` |
| CR-4 detector mirrors normaliser | Unit + spot-read | PASS | Word paste test "loss detector mirrors the normaliser" passes; `styleStrikeDeletion` uses the same per-span `line-through` + `mso` test as `stripTrackedChanges` (livingDocWordPaste.ts:301-306); comments matched by structural markers only |
| CR-5 h5/h6 fixtures | Unit | PASS | Word paste "maps heading level ... (h1-h6)" passes with `MsoHeading5` + `mso-outline-level:6` |
| CR-6 heading-only fragment recognised | Unit + Live | PASS | Word paste "a heading-ONLY Word fragment passes the isWordHtml gate and round-trips to a real h1" passes; live paste of a `MsoHeading1` heading-only fragment gated `isWordHtml=true`, `defaultPrevented=true`, and rendered as a real `<h1>` (`cr6-heading-only-pasted-as-h1.png`) |
| Threads resolved with fix replies | GraphQL | PASS | 2 threads on #265, 4 on #269 all `isResolved:true` with `tomFelder` fix-sha replies (incl. the CR-6 corrective reply on the previously auto-resolved thread) |

## Unit suite counts (all green)

LivingDoc Word paste 35, livingDocs Service 185, screenRender 71, livingDocs render 20, LivingDoc model 36. `typecheck-client` 0 errors, `valid-layers-check` 0 errors, `check-seams.sh` OK.
