---
number: 44
status: "**Done (v6 iter 1).** `lwd-anthropic-proxy.sh` now defaults `LWD_BACKEND=openrouter` + the `~/.config/lwd-openrouter.key` key file (both overridable). The renderer is unchanged — it always POSTs the Anthropic Messages shape to the proxy `/v1/messages`, which translates to/from OpenAI chat. Tier: **our-surface** (script only; no app code). Verified live: `claude-opus-4-8` request → real `gpt-4o-mini` reply (`ROUNDTRIP_OK`). Fail-soft unchanged + honest (F8)."
provenance: "v6"
source: docs/07-decision-log.md
---

# OpenRouter is the default model backend

**OpenRouter is the default model backend for every call**

The Anthropic Console org (tom@inspacexr.com) has no API credits, so the OAuth path authenticates but 400s on billing ([[living-docs-model-impl]]). The localhost proxy already had OpenRouter as a *test* backend; promote it to the default so chat/agent calls are real.
