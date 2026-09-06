---
number: 162
status: "**Decided.** Issue #121 re-scoped; doc 20 §1e acceptance note added."
provenance: "founder"
date: 2026-07-12
source: docs/07-decision-log.md
---

# The beta targets the desktop build only

**The beta targets the Electron desktop build ONLY; the web build is demoted to a development harness**

X1 - the only severity-1 - is a web-build File System Access artefact; desktop persists correctly (34-verify/x1-desktop-check.md). Scoping the beta to Electron converts the severity-1 into F19 (History rehydration) + desktop atomicity verification, and stops the fix list paying for a surface no beta user touches. The web build keeps a visible "dev harness - writes don't persist" notice so it can't masquerade as the product.
