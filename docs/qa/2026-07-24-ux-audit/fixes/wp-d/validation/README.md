# WP-D (#258) - adversarial validation evidence

Independent live-desktop re-walk of PR #271 at HEAD `c2036fd57ad6fd57e16323b6466ae42be225b232`. The validator did not see the implementation conversation. Every claim traces to a live action in the running app or a byte read off disk.

## Verdict: PASS

The negative-verb persistence floor from issue #258 is met live. Reject rows, their optional reasons, the cleared reviewed-context, and the This-Was-Wrong flag all write through to the on-disk lock and survive a full quit + relaunch. A flagged row renders a static "Flagged Wrong" badge with no re-flag button.

## The walk (Weekly Operating Summary + Board Note)

Two documents with a bound source. Across them: 1 approve (then flagged wrong), 6 rejects total (2 with typed reasons, 2 empty, 2 via Reject-all), 1 flag with a comment.

- `00-launch.png` - Home, fresh workspace.
- `01-weekly-open.png` - Weekly Operating Summary open in the editor.
- `04-reject-reason-prompt.png` - the IQuickInputService reason prompt fired by the native review-rail Reject ("Why reject this change? optional - Enter to reject, Escape to cancel").
- `05-flag-comment-prompt.png` - the This-Was-Wrong comment quick-input on the History Approved row.
- `02-history-before-relaunch.png` - in-session History: 6 rows (Current + 4 Rejected + 1 Approved), reasons rendered beneath their reject rows, the Approved row shows a "Flagged Wrong" badge + comment.
- `03-history-after-relaunch.png` - after a full quit + relaunch: IDENTICAL 6 rows, reasons survive, the "Flagged Wrong" badge survives with NO re-flag button.

## On-disk proof (the relaunch-survival core)

- `lock-weekly-pre-relaunch.json` / `lock-weekly-after-relaunch.json` - byte-identical (diff clean). 5 audit rows: 1 approved (with `wrong:{at,comment:"the wording overstated the result"}`), 4 rejected (reasons "too pessimistic, does not match the numbers" and "changes the emphasis too much" where given; `reason:null` on the empty rejects). `docTitle:"Weekly Operating Summary"` on every row (WP-B not regressed).
- `lock-board-pre-relaunch.json` / `lock-board-after-relaunch.json` - Board Note reject persisted independently with `docTitle:"Board Note"`, `reason:"board prefers the current framing"`. The two docs' flags/rows are keyed in separate locks - time-key independence confirmed.

## Probes

- Empty reason (Enter on blank prompt): rejects cleanly, persists a reject row with `reason:null`. PASS.
- Escape at the reason prompt: CANCELS the reject entirely (change stays pending, no audit row). This is the PR's documented behaviour ("Escape cancels"), not "Escape rejects". PASS.
- Reject-all: both pending changes rejected and persisted (5 -> 7 rows on disk). PASS.
- Approve after relaunch: still works, persists (7 -> 8 rows). PASS.
- Double-flag: the button is replaced by a static badge once flagged, so the UI cannot re-flag; the second-flag no-op is also pinned by the service unit test. PASS.
- Privacy split (`events-flag-privacy-proof.jsonl`): the `this_was_wrong_reported` analytics event fired exactly once, carrying only a hashed `ref_id` (`d8228576a`) - the plaintext comment "wording overstated" appears 0 times in `~/.abstract/events.log`. The founder product log keeps the plaintext comment locally, keyed by the row's ISO time. PASS.

## Tests (run by the validator, broker on 8090 held down for hermeticity)

- `scripts/test.sh --grep 'livingDocs Service'` - 176 passing, incl. the #258 regression test.
- `scripts/test.sh --grep 'livingDocs History'` - 22 passing, incl. the 3 new WP-D render tests.

Note: with the shared broker UP on 8090, 8 model-chat tests fail because the service's streaming path raw-fetches `http://localhost:8090/v1/messages` and gets real (non-scripted) content. This is a pre-existing test-harness non-hermeticity, not a WP-D regression; holding 8090 down restores 176/176.

## Console

Clean of new errors during the walk. Only pre-existing noise: the `/event` analytics CORS failure (tracked separately) and benign Electron `NODE_OPTIONS` startup warnings.
