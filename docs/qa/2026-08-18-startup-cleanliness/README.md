# Startup cleanliness - capture notes (18 Aug 2026)

Both captures are Chrome DevTools Protocol page screenshots of the renderer, taken against a dev build launched by `.claude/skills/launch-abstract/scripts/launch.sh` on the `living-docs-sample` workspace, with the profile seeded from the packaged app so the instance is signed in.

- `before/01-workbench.png` - pristine `main` at `2bbadf20956`
- `after/01-workbench.png` - this branch

The two files are byte-identical (`md5 73165875941292295cf3032dbc451a06`), and a third capture of the fixed build reproduced the same hash. That identity is the point: this change touches view registration, so the evidence a reviewer needs is that the product UI did not move. The functional before/after is in the renderer log and the views-registry probe quoted in the PR description, not in the pixels, because every view this change recovers is `when`-gated and never rendered in this product today.

No command palette and no Developer Tools screenshot: this fork's workbench does not expose either, so the console could not be captured in-app.
