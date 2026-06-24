# Real Documents loop — R-gate log (v5 / `living-docs-realdocs`)

Concise per-iteration log of the "real documents" loop. R-gates (R1–R7) + HOLD design gates (G1–G6) are
defined in `docs/plans/13-real-documents-loop.md`. Verify live on a real folder; re-read disk for every
write (on `code.sh` per Decision #38). One commit per iteration; before/after shots posted as PR comments.

## Iteration 1 — settle + prove (no feature code)

**Surface decided (Decision #38, Tom's call):** web `code-web` + chrome-devtools drives UI iteration (real
reads); desktop `code.sh` proves disk persistence for every write-gate. Rationale: proved live that
`code-web` writes only to in-browser memfs, and the real-disk FSA picker is a native dialog automation
can't drive.

**Proved live on `/Users/tommy/Sites/.realdocs-test`** (`Weekly Update.md` + `Team Notes.md` + `metrics.csv`):

| Check | Result |
|---|---|
| Real-folder discovery (tree-rail) | ✅ `Weekly Update` under REPORTS, `metrics.csv` under SOURCES — real files, no demo data. `Team Notes.md` excluded (no frontmatter → not "living"). |
| Source-read on real CSV | ✅ `bind:metrics.mrr.latest` resolved to the real `49800`, highlighted as a bound figure. |
| Home reflects folder | ❌ Hardcoded demo (4 fake projects, "New project" no-op). → R2 gap. |
| In-app edit applies | ✅ "Edit raw Markdown" sentinel applied, "Saved · v14". |
| Edit persists to **disk** (`code-web`) | ❌ on-disk file byte-identical — memfs only. → drives Decision #38. |
| Desktop `code.sh` boots on the real folder | ✅ Electron app ("Opportunity OS - Living Documents") booted on `.realdocs-test`, workbench started. (One benign console seam: `ExtensionsViewlet.registerViews` complains because the de-IDE work deregistered the Extensions container — not a crash.) Disk-proof surface confirmed viable. Note: its UI isn't chrome-devtools-drivable, so per-write disk proofs open the folder via CLI + re-read the file. |

**R-gate status going in:** R1 missing (no on-ramp), R2 missing (Home demo), R3/R4 engine-real but
surface-gated, R5/R6 missing UI, R7 missing (stretch). Full map + ranked build order in
`13-real-documents-loop.md`. **Design gates G1–G6:** held from v4 (no feature code changed the shell this
iteration).

**Next:** R1 + R2 — the open-folder on-ramp + folder-reflecting Home + empty state, which unblock everything.
