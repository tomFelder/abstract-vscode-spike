---
number: 14
status: "Done (PR #11); see [10-model-integration.md](10-model-integration.md)"
source: docs/07-decision-log.md
---

# Model calls go through a localhost proxy

**Model calls go through a localhost OAuth proxy**, not from the renderer

`livingDocsService` runs in the browser; a credential must never be embedded there. The proxy holds the dev's OAuth token (via `ant`) server-side. The sources build sets no `connect-src` CSP, so renderer->proxy works via CORS with zero core changes
