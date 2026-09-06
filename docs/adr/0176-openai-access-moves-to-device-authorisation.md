---
number: 176
status: "**Decided.** Wave = [plans/51-model-access-device-auth-loop.md](plans/51-model-access-device-auth-loop.md)."
provenance: "founder"
date: 2026-08-03
source: docs/07-decision-log.md
---

# OpenAI access moves to device authorisation

**OpenAI model access moves to the Codex device-authorization flow: the broker's loopback-redirect OAuth is replaced by RFC 8628 device auth (code + verification link + poll), the model catalogue becomes data (live-listed or `~/.abstract/models.json`) so new model ids never need a code edit, the broker selects its backend PER REQUEST (openai-oauth when the bundle is valid, OpenRouter otherwise - closing #120's root cause; `LWD_BACKEND` demotes to a dev override), and every sign-in/serving failure names its real state (broker down / unreachable / upstream status) - the silent-`undefined` catch and "is the model connected?" string retire**

OpenAI's new model set is served behind device auth, so the old flow cannot succeed at all; #120's spawn-time backend fixation is the documented reason sign-in success still didn't serve calls; and the 3 Aug triage found the UI structurally unable to tell the truth about which of three failures occurred. Endpoints/ids are researched from the live Codex CLI source + docs at implementation time, never from model memory. Founder bar: early-beta plain is fine, works-and-never-lies is mandatory.
