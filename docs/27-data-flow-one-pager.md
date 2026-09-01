# 27 - What leaves my machine? The data-flow one-pager

**Who this is for:** anyone about to open a folder of real work - salaries, contracts, board
material - in Abstract, asking the one fair question: *what leaves my computer, when, and to whom?*

This page is the plain-words answer. It is the single exemption from the docs moratorium
(decision 163) because it is the trust story at the exact moment a stranger decides whether to open
their real folder. Every line here is checked against the code that actually runs, not the code we
meant to write (the plan-33 honesty rule applies to privacy copy above all).

---

## The short version

- **Abstract sends content only when you ask it to work - or when a built-in agent you have left
  running does its scheduled check.** Three such agents come switched on; you can pause any of them
  (details below).
- When you ask, Abstract sends **the document you are working on and the source files you attached
  to it** to the model that answers you. When an agent checks a document, it sends **the changed
  sentences from that document and the document's attached context files**. That is the content
  that leaves.
- The model is reached through **a small helper that runs on your own computer** (a local proxy).
  Your sign-in and any keys live only in that helper - the app you are looking at never sees them.
- **Files that are not documents, attached sources, or @-mentions - and your edit history - stay
  put.** They are never sent anywhere.
- **Abstract now counts what you do in the app - but only if you say yes, and it never leaves your
  computer yet.** On first run a plain-words moment asks; if you decline, nothing is counted at
  all. If you accept, Abstract records **actions and counts, never your words**, to a file on your
  own machine. Sending any of that to an analytics service is still not built - so today, nothing
  leaves. You can change your choice any time on the Model access screen / in Settings.

---

## What is sent when you chat or run an agent

**When you send a chat message about a document,** Abstract sends the model:

- the text of **that one open document** (with any bound figures filled in),
- the **source and context files you attached** to that document (or the ones you @-mention in the
  message),
- the **conversation so far** in that chat, and
- **your instruction**.

Nothing else about your folder goes with it.

**When you run one instruction across your project** (a fan-out), Abstract sends:

- the **documents you selected** for that run - their text, one by one,
- the **shared sources** attached to the run, and
- your instruction.

A run only ever sees the documents you picked. If a single document is too large to fit, it is
**left out and shown to you as "too large for this run"** - it is never quietly trimmed and sent.

The request is small on purpose: your instruction plus the document, capped so a reply comes back
promptly.

---

## The agents that run on their own

Three built-in agents come **switched on** and can act without you clicking anything at that
moment:

- a **source-change watcher** - runs when a source file changes on disk,
- a **freshness check** - runs every six hours,
- a **weekly refresh** - runs Monday mornings, across all the documents in your project (including
  ones you have not opened in the editor).

When one of these finds that a document's figures need updating, it double-checks the update before
anything lands. That double-check **may send content to the model, through whichever door you
chose**: the changed sentences from the affected document, plus that document's attached context
files. If no model is connected, or nothing changed, nothing is sent.

**To stop this:** open the **Agents** screen, open the agent, and press **Pause**. A paused agent
is skipped by the scheduler and sends nothing (its "Run now" button still works if you press it
yourself). Two further built-in agents exist but only ever run when you export or publish a
document - those are actions you take.

---

## The two doors your model calls go through

You choose how your model calls are paid for on the **Model access** screen. Either way, the request
above is the same; only the destination and who pays differ.

### Door 1 - your own ChatGPT sign-in (the primary door)

Your document and its sources go to **OpenAI's ChatGPT service**, paid for by **your own ChatGPT
subscription**. You sign in once; the sign-in is kept by the helper on your computer, and the app
never sees it.

*Retention:* what OpenAI keeps, and for how long, is **per OpenAI's published policy** (link to be
inserted at founder review - see the note at the end). We do not add any storage of our own on this
path.

### Door 2 - the included model (the fallback)

When you are not signed in, your document and its sources go to **OpenRouter**, which routes them to
a capable mid-tier model we include for free, with a small amount of usage each day. This door is
paid for by us, so it is capped; when the day's usage is spent it **pauses politely and picks up
tomorrow** - it does not fail.

*Retention:* what OpenRouter (and the model it routes to) keeps is **per OpenRouter's published
policy** (link to be inserted at founder review). We do not add any storage of our own on this path.

Signing in itself talks only to **OpenAI's login page** in your browser, and only when you click
"Sign in with ChatGPT".

---

## What the helper keeps on your computer

The helper stores a few things in a hidden folder in your home directory (`~/.abstract/`),
readable only by you (owner-only permissions). **None of these ever contain your document text:**

- **Your ChatGPT sign-in** - the credential that lets your subscription pay for your model calls.
  Stored only here, never sent back to the app.
- **Any API keys** you add for a data source - stored only here, injected by the helper when it
  fetches that source, never handed to the app.
- **A usage log** - one line per included-model call recording the cost, the running daily total,
  and whether the daily cap was hit. It records **money and counts, never words**.
- **A product-events log** - your answers to the three onboarding questions and, **if you have said
  yes to analytics**, a line for each action you take (a change approved, a source synced, a
  document exported - the count and kind, never the words). If you declined, this file gains no
  such lines. Today it **stays on your computer**; nothing forwards it anywhere yet.

Your **documents, their generated `.lock.json` sidecars, and the hidden `.abstract/` project home**
live in your project folder and stay there. The only document content that ever leaves is the
specific text a chat, a run, or an agent's double-check sends to the model, as described above.

---

## Analytics: consent-first, and today nothing leaves your machine

**Abstract now measures how you use the app - consent-first, and entirely on your own computer.**
On first run a plain-words moment asks: *"Help us improve Abstract - we count actions, never your
words."* You choose, and you can change that choice any time (the Model access screen and Settings
both carry the toggle).

- **If you decline, nothing is captured at all** - not one line is written. Declining is total: it
  is not "replay off, counting on"; it is off.
- **If you accept,** Abstract writes one line per action to a **local** file (`~/.abstract/events.log`)
  through the same helper on your computer. Each line carries **counts and kinds only** - which
  feature you used, how many items, how long - and never your document text or bound figures. A
  built-in check refuses to write a line that looks like prose or a file path, so content cannot
  slip in by mistake.

**What still does not exist:** forwarding any of this to an analytics service (PostHog), and session
replay, are **not built yet**. So even when you accept, **no analytics leaves your machine today** -
the events sit in that local file and go no further. When forwarding does ship it will keep the same
consent gate and the same "actions, never words" rule, and any session replay will have document text
masked. Declining will always mean no product analytics is collected.

---

## What is never sent, anywhere

- **Files that are not documents, attached sources, or @-mentions** - a file that no document
  lists as a source, and that you never @-mention in chat, is never read into a request.
  (Documents themselves can be touched by the built-in agents above, even unopened ones - pause
  the agents if you do not want that.)
- **Documents you did not select, for a run you start** - a run only ever sees the documents you
  picked. The built-in agents have their own, wider scope, described above.
- **Your edit history, undo stack, and the `.lock.json` provenance sidecars.**
- **Your sign-in or your API keys** - these stay in the helper on your computer and are never
  returned to the app or written into a request.
- **A folder inventory** - Abstract does not send a list of what is in your folder.

---

## For founder review

- **Provider retention links.** This page deliberately does not state specific retention windows for
  OpenAI/ChatGPT or OpenRouter, because the environment cannot fetch their current policy pages.
  Insert the two links above and confirm the wording matches each provider's published stance before
  this goes in front of a user.
- **Consent-moment link.** This page is meant to be linked from the analytics consent moment. That
  moment now exists (the first-run dialog and the Settings toggle, `abstract.analytics.enabled`); the
  richer onboarding surface still lands with issue #127. Wire this page's link into the consent copy.

---

*Sources for every claim on this page are the actual code paths in
`scripts/lwd-anthropic-proxy.js`, `scripts/lwd-openai-oauth.js`,
`src/vs/workbench/contrib/livingDocs/browser/livingDocsService.ts`, and
`src/vs/workbench/contrib/livingDocs/browser/agentOrchestrator.ts`; see the implementer's report on
issue #135 for the line-by-line map. Related: [18-beta-plan.md](18-beta-plan.md) §2.1/§2.2,
[16-principles.md](16-principles.md) P5, decision 163.*
