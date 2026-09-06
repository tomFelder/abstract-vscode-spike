# Offline build for the vendored ProseMirror bundle

This directory builds `src/vs/workbench/contrib/livingDocs/browser/prosemirrorBundle.ts`, the
ProseMirror editor the Living Document surface runs on (decision 43, decision 46, plan 14/15).

**This is not part of the fork's build.** Nothing in the VS Code build pipeline reads it, and
`npm run compile` never enters it. It is kept in the repository only so the vendored bundle can be
rebuilt from its real sources, and it is excluded from the repo's hygiene gates for that reason -
see "Why it is excluded" below.

## Provenance

Until 6 Sep 2026 these sources lived at `/Users/tommy/Sites/.lwd-pm-build`, outside the repository,
on a single machine. `docs/lwd-pm-bundle-build.md` reproduced them inline but that copy had drifted:
it was missing the decorations plugin, the `table_block` atom and the `wikilink` atom. When that
machine was retired the directory survived only on the `wip/mac-migration-2026-09` branch, which made
the shipping bundle unrebuildable from truth. This is that directory, recovered.

Verified on recovery: `bundle.iife.js` here is **byte-identical** to the payload currently
base64-encoded into `prosemirrorBundle.ts` - 381,357 bytes, sha256 `0cec41d1…`. What is here is what
ships.

## Rebuilding

```sh
cd build/lwd-pm-build
npm install          # esbuild + the prosemirror-* packages pinned in package.json
node build.mjs
```

`build.mjs` bundles `lwdpm-entry.js` with `esbuild --format=iife --minify --charset=ascii`, escapes
the non-ASCII regex-literal bytes esbuild leaves behind, and writes the base64-encoded `.ts` into the
workbench contrib. The ASCII pass is not cosmetic - the fork's hygiene gate rejects non-ASCII sources,
which is what the encoding step exists to satisfy.

## Files

| File | What it is |
|---|---|
| `lwdpm-entry.js` | the real entry point - schema, the `bound_figure` / `table_block` / `wikilink` atoms, the decorations plugin, the toolbar commands, and the headless `roundTrip` / `docJSON` helpers |
| `build.mjs` | the esbuild invocation, the ASCII escape pass, and the `.ts` emit |
| `bundle.iife.js` | the last built artifact, kept so a rebuild can be diffed against it |
| `package.json` / `package-lock.json` | the pinned ProseMirror and esbuild versions |
| `lwdpm-entry.js.orig-pre-r7` | the entry point as it stood before plan 55's R7 (ordinal decorations). Kept because it was never in git, so this file is its only history |

## What depends on the artifact

`livingDocRender.ts` decodes the bundle once and inlines it, defining `window.LWDPM`. Three suites
load the built artifact directly rather than a mock, which is what makes the Markdown parse/serialize
round-trip testable against the real thing: `prosemirrorBundle.test.ts`, `boundHeadingSave.test.ts`
and `livingDocWordPaste.test.ts`.

## Why it is excluded from the hygiene gates

These are third-party-shaped build sources, not fork source: they carry no Microsoft copyright header,
they are JavaScript rather than TypeScript, and their indentation is whatever their tooling produced.
Keeping them outside the repo used to be how that was avoided; the cost of that was losing them. They
are now excluded explicitly instead, in three places:

- `.eslint-ignore` - which also feeds hygiene's `eslintFilter`, so one entry covers both eslint passes
- `indentationFilter` in `build/filters.ts`
- `copyrightFilter` in `build/filters.ts`

Do not remove those exclusions without moving the directory back out of the tree, and do not treat
this directory as a precedent for new JavaScript in the fork.
