# WP-D live verification - negative verbs persist (#258)

Desktop walk on the fork build (Code OSS from sources), workspace `/tmp/wpd-ws` (a copy of `living-docs-sample`), broker up and signed in.

## The walk

1. Opened **Weekly Operating Summary**, opened the chat rail.
2. Asked the agent to tighten the commentary -> a real **MEANING CHANGE** proposal (via: model). **Approved** it via the Review rail (`02-history-before-relaunch.png` shows the resulting History row).
3. In History, clicked **This Was Wrong** on that approved row -> the reason quick-input appeared; entered "the wording overstated the result". The row switched to a static **Flagged Wrong** badge (the re-flag button is gone).
4. Asked the agent to rewrite the commentary to emphasise risks -> a second proposal. **Rejected** it via the Review rail -> the new **reject-reason** quick-input appeared ("Why reject this change?"); entered "too pessimistic, does not match the numbers".
5. `cat` the on-disk lock: the approved row carries `wrong: { at, comment }`, the rejected row carries `reason`. (Before the fix, `reject()` never persisted and the flag was never written.)
6. **Full quit** (killed the process tree, confirmed DOWN) then **relaunched** a fresh instance on the same workspace.
7. Reopened the document's History: the **Rejected** row + its reason and the **Approved** row + **Flagged Wrong** badge + its comment are all still there. History counts stable across relaunch. The flagged row shows **no** re-flag button (count of "This Was Wrong" buttons after relaunch: 0 - no infinite re-flag).

## Evidence

- `02-history-before-relaunch.png` - History showing the rejected row (+reason), the flagged approved row (+comment), in-session.
- `03-history-after-relaunch.png` - the same History after a full quit + relaunch: rows, reason and flag all survived.
- `lock-after-relaunch.json` - the on-disk `Weekly Summary.lock.json` audit after relaunch: `approved` row with `wrong`, `rejected` row with `reason`.
- `disk-proof.txt` - `df -h /System/Volumes/Data` (disk was critically low throughout; one instance at a time, runDirs cleaned each cycle).
