---
number: 38
status: "**Decided (v5 iter 1) — Tom's call.** Primary UI-iteration surface = **`code-web` + chrome-devtools** (real reads; memfs writes are fine for interaction + in-app round-trip checks). Disk-persistence proof for every write-gate = **desktop `code.sh`** (real disk, folder opened via CLI, re-read the file). The R1 product on-ramp is still built on the real FSA path so the shipped app is real-disk on web + desktop. Rejected: one-time manual FSA pick per session (not unattended); Electron-CDP loop (unproven tooling). Recorded in `docs/plans/13-real-documents-loop.md`."
provenance: "v5"
source: docs/07-decision-log.md
---

# Web drives, desktop proves disk

**The Real Documents loop's build + verification surface — "web drives, desktop proves disk"**

Iteration-1 proof (real folder `/Users/tommy/Sites/.realdocs-test`): `code-web` reads real files (discovery + CSV source-read both worked live — `bind:metrics.mrr.latest` resolved to the real `49800`) but an in-app edit that showed "Saved" was **byte-identical on disk** — `@vscode/test-web` serves the mount read-only over HTTP and overlays writes in an in-browser memfs. So the loop goal's premise (web round-trips to disk) is **false**. VS Code web *does* have a real-disk path (`fileDialogService.ts:206` `showDirectoryPicker()` → `htmlFileSystemProvider`), but that picker is a **native OS dialog chrome-devtools/CDP cannot drive**, so "web + FSA + fully-unattended automation" is self-contradictory.
