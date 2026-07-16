# Bundle E QA - issue #171 (Files tab real tree)

Branch: `feat/171-tree-rail-real-tree`. Worktree: `/Users/tommy/Sites/abstract-wt-bundle-e`.

## Fix round: Assets bucket defaults collapsed on first open

The blocker from validation was that the "Assets (N)" bucket defaulted to EXPANDED, so on first
open of the docs workspace all 399 screenshots still flooded the Files tree - the exact thing
issue #171 forbids. The code comments already claimed the Assets node was "collapsed by default";
the code now matches.

### Approach

The Assets bucket is now seeded collapsed exactly once per workspace, the first time the Files
tree is built (`_seedAssetsCollapsed`, `treeRailView.ts`). A one-time boolean workspace-storage
flag (`livingDocs.treeRail.assetsSeeded`) records that the seed has run. On the first-ever build
that actually contains an Assets bucket, its id (`folder:Sources/Assets`, discovered via the pure
`collectAssetsFolderIds` helper in `treeRail.ts`) is added to the existing collapsed set and
persisted; after that the flag suppresses re-seeding forever. Because the collapsed set stores
COLLAPSED ids, "user expanded Assets" means the id is simply absent - so once the user touches
Assets it behaves exactly like any other folder through the existing `onDidChangeCollapseState`
persistence, and their choice wins on every subsequent restart. This is the least machinery: one
boolean flag reusing the existing collapse persistence, no new storage schema. The seed is only
burned once a real Assets bucket exists, so a first render before any screenshots exist does not
waste the one-shot and leave a later flood expanded.

## Automated verification (all green)

- `npm run typecheck-client`: 0 errors.
- `npm run valid-layers-check`: clean.
- `./scripts/test.sh --grep "treeRail"`: 12 passing (was 11) - added `collectAssetsFolderIds`
  coverage; all pre-existing cases still pass.

## Live E2E (captured this round)

Driven via the launch skill against the real workbench, fresh profile, workspace
`/Users/tommy/Sites/abstract-vscode-spike/docs` (399 loose screenshots). Assets node state read
directly from the tree widget's `aria-expanded` attribute.

- `01-first-open-assets-collapsed-no-flood.png` - **(a)** first open, zero interaction: `Assets (399)`
  renders `aria-expanded=false`, zero png rows rendered. Sources shows only the data files (csv / json
  / txt / pdf / xlsx); no screenshot flood.
- `02-assets-expanded-by-user.png` - user expands Assets manually; png rows appear (`aria-expanded=true`).
- `03-restart-assets-stays-expanded.png` - **(b)** restart same profile: `Assets (399)` stays
  `aria-expanded=true`, png rows visible - user intent respected. Persisted collapsed set confirmed to
  NOT contain the Assets id.
- `04-restart-collapse-persisted.png` - **(c)** collapse Assets again, restart: `aria-expanded=false`,
  zero png rows. Persisted collapsed set confirmed to contain `folder:Sources/Assets`.

The `validator/` subfolder retains the original validation-round screenshots.
