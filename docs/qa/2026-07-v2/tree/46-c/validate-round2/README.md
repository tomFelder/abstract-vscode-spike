# Bundle 46-c validate round 2 (#225)

Adversarial re-validation of PR #235 after the round-1 P6.5 fix (sticky pending-panel replay, head `7967945f7ef`). Fresh-eyes stance: refute, not confirm.

## Automated checks

| Check | Result |
| --- | --- |
| `typecheck-client` | clean (0 errors) |
| `valid-layers-check` | clean (all projects) |
| `check-seams.sh` | OK, all shell seams intact |
| `test.sh --grep "livingDoc"` | 333 passing / 0 failing (was 330 + 3 replay tests) |

The three replay tests were read critically and are honest:

- request-before-mount is recorded, consumed once on mount, second read `undefined`.
- request-while-mounted reaches the sync listener AND leaves the request pending until the next mount consumes it (the test asserts this explicitly rather than claiming it clears on the sync path).
- last-request-wins overwrite (history then chat -> chat).

Design note (not a defect): after a `focusPanel` on an already-mounted rail, `_pendingPanel` lingers until the next rail mount consumes it. A collapse+reopen after a request would replay the last tab. Benign for P6.5 and is the intended deep-link reuse; flagged for awareness only.

## P6.5 live re-test (both settle timings)

Driven with Playwright against `code-web` on 8082 (bare URL). Context-menu items were clicked with real `mousedown`/`mouseup` at the item centre (Playwright `.click()` does not commit native menu items). Boot state confirmed the review rail tab strip is NOT mounted (`button.ldp-tab` absent) - the closed-doc / quiet-shell precondition.

| Scenario | Settle | Active tab after | History content |
| --- | --- | --- | --- |
| Closed doc (Weekly Operating Summary) | 1.5s | History | VERSION HISTORY · WEEKLY OPERATING SUMMARY |
| Closed doc (Board Note) | 4.0s | History | VERSION HISTORY · BOARD NOTE |
| Already-open (Market research) | 2.5s | History | VERSION HISTORY · MARKET RESEARCH |
| Quiet shell (plain open, Executive Summary) | 3.0s | rail NOT popped | (no ldp-tab strip; rail stays collapsed) |

`Bind Sources...` opens the doc and switches the left rail to Context with the add-source flow expanded (LINKED SOURCES / REFERENCED FILES / + Add context). `Present` opens the Present & export modal (Web page / Markdown / PDF / Word / Google Docs/Sheets / Excel). Both fire.

## Regression spot-check

- Menu geometry: width 210px (208 popover + hairline border), radius 12px, 30px rows, 3 hairline separators, exact four-group order. Delete colour `rgb(181, 81, 75)` (#B5514B).
- Blank-group attack: Open to the Right -> 2 groups; close both (right group first, then left) collapses to 1 group, no blank group left behind.
- Inline rename: `input.rail-rename-input` renders in place on the row. Esc cancels (input gone, name intact). Enter commits (Wrap Rule Fixture -> Wrap Rule Renamed, old gone).
- PN.1 nudge: a crafted `template: <name>` + no-source doc renders the blue "Bind sources" chip (`fromTemplate && !isLiving`, #233).

## Verdict

PASS - 10/10. P6.5 verified at both timings on the closed-doc path plus the already-open and quiet-shell paths.

Sample folder was restored to its pristine state after the rename/PN.1-fixture mutations; temp driver scripts removed.
